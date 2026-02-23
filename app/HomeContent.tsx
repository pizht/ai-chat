'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

type Message = { role: 'user' | 'assistant'; content: string };
type Conversation = { id: string; title: string | null; updatedAt: string };

export default function HomeContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('c');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversation');
      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error('Load conversations error:', error);
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/conversation/${id}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.conversation.messages || []);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error('Load messages error:', error);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      loadConversations();
    }
  }, [status, loadConversations]);

  useEffect(() => {
    if (conversationId && status === 'authenticated') {
      loadMessages(conversationId);
    } else if (!conversationId) {
      setMessages([]);
    }
  }, [conversationId, status, loadMessages]);

  const createNewConversation = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/conversation', {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        loadConversations();
        return data.conversationId;
      }
    } catch (error) {
      console.error('Create conversation error:', error);
    }
    return null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    let currentConversationId = conversationId;

    if (!currentConversationId) {
      const newId = await createNewConversation();
      if (!newId) {
        console.error('Failed to create conversation');
        return;
      }
      router.push(`/?c=${newId}`);
      currentConversationId = newId;
    }

    const newMessages: Message[] = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');

    const messagesWithAssistant: Message[] = [...newMessages, { role: 'assistant', content: '' }];
    setMessages(messagesWithAssistant);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, conversationId: currentConversationId }),
      });

      if (!response.ok) throw new Error('API request failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                assistantContent += parsed.content;
                setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      loadConversations();
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([...newMessages, { role: 'assistant', content: 'Error: Failed to get response' }]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const handleNewChat = async () => {
    try {
      const response = await fetch('/api/conversation', {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        loadConversations();
        router.push(`/?c=${data.conversationId}`);
      }
    } catch (error) {
      console.error('Create conversation error:', error);
    }
  };

  const handleSelectConversation = (id: string) => {
    router.push(`/?c=${id}`);
  };

  const handleDeleteConversation = async (id: string) => {
    const confirmed = window.confirm('确定要删除这个会话吗？');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/conversation/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadConversations();
        if (conversationId === id) {
          handleNewChat();
        }
      }
    } catch (error) {
      console.error('Delete conversation error:', error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="text-zinc-600 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="flex h-screen bg-zinc-50 font-sans dark:bg-black">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } flex-shrink-0 border-r border-zinc-200 bg-white transition-all duration-300 overflow-hidden dark:border-zinc-800 dark:bg-zinc-900 md:relative fixed inset-y-0 left-0 z-30`}
      >
        <div className="flex h-full flex-col w-64">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold text-zinc-900 dark:text-white">会话列表</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 md:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* New Chat Button */}
          <div className="p-3">
            <button
              onClick={handleNewChat}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建对话
            </button>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                    conversationId === conv.id
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <button
                    onClick={() => handleSelectConversation(conv.id)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="flex-1 truncate">
                      {conv.title || '新对话'}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {formatDate(conv.updatedAt)}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-opacity"
                    title="删除会话"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  暂无会话记录
                </p>
              )}
            </div>
          </div>

          {/* User Info */}
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {session?.user?.name || session?.user?.email}
              </span>
              <button
                onClick={handleSignOut}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Deepseek Chatting Tool
            </h1>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-zinc-600 dark:text-zinc-400">Loading messages...</div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        message.role === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                      }`}
                    >
                      {message.role === 'user' ? (
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-code:text-pink-500 prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-4 prose-headings:mb-2">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeHighlight]}
                            components={{
                              pre: ({ children }) => (
                                <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-sm">
                                  {children}
                                </pre>
                              ),
                              code: ({ className, children, ...props }) => {
                                const isInline = !className;
                                if (isInline) {
                                  return (
                                    <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-sm text-pink-500 dark:bg-zinc-700" {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                                return <code className={className} {...props}>{children}</code>;
                              },
                              h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-base font-bold mt-2 mb-1">{children}</h3>,
                              ul: ({ children }) => <ul className="list-disc list-inside my-2">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside my-2">{children}</ol>,
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-4 border-zinc-400 pl-4 italic text-zinc-600 dark:text-zinc-400">
                                  {children}
                                </blockquote>
                              ),
                              table: ({ children }) => (
                                <div className="overflow-x-auto my-4">
                                  <table className="min-w-full border border-zinc-300 dark:border-zinc-600">
                                    {children}
                                  </table>
                                </div>
                              ),
                              th: ({ children }) => (
                                <th className="border border-zinc-300 bg-zinc-100 px-3 py-2 text-left font-semibold dark:border-zinc-600 dark:bg-zinc-700">
                                  {children}
                                </th>
                              ),
                              td: ({ children }) => (
                                <td className="border border-zinc-300 px-3 py-2 dark:border-zinc-600">
                                  {children}
                                </td>
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input */}
        <footer className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              disabled={isLoading}
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <button
              onClick={handleSend}
              disabled={isLoading}
              className="rounded-lg bg-blue-500 px-4 py-2 font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
            >
              Send
            </button>
          </div>
        </footer>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
