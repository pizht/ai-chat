import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { checkRateLimit, checkDailyLimit } from '@/lib/rate-limit';
import { logChatRequest, logRateLimited, logDailyLimited, logRequestRejected } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_TOTAL_LENGTH = 50000;

function validateMessages(messages: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(messages)) {
    return { valid: false, error: 'Messages must be an array' };
  }

  if (messages.length === 0) {
    return { valid: false, error: 'Messages cannot be empty' };
  }

  if (messages.length > MAX_MESSAGES) {
    return { valid: false, error: `Too many messages. Maximum is ${MAX_MESSAGES}` };
  }

  let totalLength = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: `Invalid message at index ${i}` };
    }

    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
      return { valid: false, error: `Invalid role at index ${i}. Must be 'user', 'assistant', or 'system'` };
    }

    if (typeof msg.content !== 'string') {
      return { valid: false, error: `Invalid content at index ${i}. Must be a string` };
    }

    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: `Message at index ${i} exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
    }

    totalLength += msg.content.length;
  }

  if (totalLength > MAX_TOTAL_LENGTH) {
    return { valid: false, error: `Total message length exceeds maximum of ${MAX_TOTAL_LENGTH} characters` };
  }

  return { valid: true };
}

function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dailyLimitResult = checkDailyLimit(user.id);
    if (!dailyLimitResult.allowed) {
      logDailyLimited(user.id, { dailyCount: dailyLimitResult.count });
      return NextResponse.json(
        { error: 'Daily limit exceeded. Please try again tomorrow.' },
        {
          status: 429,
          headers: {
            'X-DailyLimit-Limit': dailyLimitResult.limit.toString(),
            'X-DailyLimit-Remaining': '0',
            'X-DailyLimit-Used': dailyLimitResult.count.toString(),
          },
        }
      );
    }

    const rateLimitResult = checkRateLimit(user.id);
    if (!rateLimitResult.allowed) {
      logRateLimited(user.id, { remainingTime: rateLimitResult.resetTime - Date.now() });
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
          },
        }
      );
    }

    const body = await request.json();
    const { messages, conversationId } = body;

    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const validation = validateMessages(messages);
    if (!validation.valid) {
      logRequestRejected(user.id, { reason: 'validation_failed', error: validation.error || '' });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const totalChars = (messages as Array<{ content: string }>).reduce(
      (sum: number, msg) => sum + msg.content.length,
      0
    );
    const estimatedTokens = estimateTokens(totalChars);

    logChatRequest(user.id, {
      messageCount: (messages as unknown[]).length,
      totalChars,
      estimatedTokens,
    });

    const lastUserMessage = (messages as Array<{ role: string; content: string }>)
      .filter((msg) => msg.role === 'user')
      .pop();

    if (lastUserMessage) {
      await prisma.message.create({
        data: {
          conversationId,
          role: 'user',
          content: lastUserMessage.content,
        },
      });

      if (!conversation.title) {
        try {
          const titleResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'deepseek-chat',
              messages: [
                {
                  role: 'system',
                  content: '你是一个标题生成助手。请根据用户的对话内容生成一个简短的标题（不超过20个字符）。只返回标题，不要包含其他内容。',
                },
                {
                  role: 'user',
                  content: `请为以下对话生成一个简短标题：\n\n${lastUserMessage.content}`,
                },
              ],
              max_tokens: 30,
            }),
          });

          if (titleResponse.ok) {
            const titleData = await titleResponse.json();
            const generatedTitle = titleData.choices?.[0]?.message?.content?.trim().slice(0, 30);
            if (generatedTitle) {
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { title: generatedTitle },
              });
            }
          }
        } catch (error) {
          console.error('Generate title error:', error);
        }
      }
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const encoder = new TextEncoder();
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('No reader available');
    }

    let assistantContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              if (assistantContent) {
                await prisma.message.create({
                  data: {
                    conversationId,
                    role: 'assistant',
                    content: assistantContent,
                  },
                });
              }
              controller.close();
              break;
            }

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n').filter((line) => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);

                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;

                  if (content) {
                    assistantContent += content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
        'X-DailyLimit-Limit': dailyLimitResult.limit.toString(),
        'X-DailyLimit-Remaining': dailyLimitResult.remaining.toString(),
        'X-DailyLimit-Used': dailyLimitResult.count.toString(),
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process chat request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
