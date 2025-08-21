'use client';

import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import { fetcher, fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import type { Session } from 'next-auth';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage } from '@/lib/types';
import { useDataStream } from './data-stream-provider';
import { SemanticScholarToggle } from './semantic-scholar-toggle';

type ChatMode = 'regular' | 'semantic' | 'regular-plus-semantic';

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session;
  autoResume: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>('');
  const [chatMode, setChatMode] = useState<ChatMode>('regular');

  console.log('[Chat] chatMode:', chatMode);

  // Create separate chat instances for each mode
  const regularChat = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      }
    },
  });

  const semanticScholarChat = useChat<ChatMessage>({
    id, // Use the same ID as regular chat
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/semantic-scholar',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      }
    },
  });

  const regularPlusSemanticChat = useChat<ChatMessage>({
    id, // Use the same ID as regular chat
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/regular-plus-semantic',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      console.log('[REGULAR-PLUS-SEMANTIC] Received data part:', dataPart);
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      console.log('[REGULAR-PLUS-SEMANTIC] Chat finished');
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      console.error('[REGULAR-PLUS-SEMANTIC] Chat error:', error);
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      }
    },
  });

  // Use the appropriate chat instance based on mode
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = chatMode === 'semantic' 
    ? semanticScholarChat 
    : chatMode === 'regular-plus-semantic'
    ? regularPlusSemanticChat
    : regularChat;

  // Debug logging for messages
  console.log('[Chat] Current mode:', chatMode);
  console.log('[Chat] Messages count:', messages.length);
  console.log('[Chat] Status:', status);

  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher,
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const handleModeToggle = (mode: ChatMode) => {
    setChatMode(mode);
    console.log('[Chat] Mode changed to:', mode);
  };

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={id}
          selectedModelId={initialChatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          session={session}
        />

        <div className="flex-1 overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-auto">
              <Messages
                chatId={id}
                status={status}
                votes={votes}
                messages={messages}
                setMessages={setMessages}
                regenerate={regenerate}
                isReadonly={isReadonly}
                isArtifactVisible={isArtifactVisible}
              />
            </div>

            <div className="border-t bg-background p-4">
              <SemanticScholarToggle
                isSemanticScholarMode={chatMode === 'semantic'}
                isRegularPlusSemanticMode={chatMode === 'regular-plus-semantic'}
                onToggle={handleModeToggle}
              />
              
              <MultimodalInput
                chatId={id}
                status={status}
                input={input}
                setInput={setInput}
                sendMessage={sendMessage}
                stop={stop}
                attachments={attachments}
                setAttachments={setAttachments}
                messages={messages}
                setMessages={setMessages}
                isReadonly={isReadonly}
                selectedVisibilityType={visibilityType}
                isSemanticScholarMode={chatMode === 'semantic'}
                isRegularPlusSemanticMode={chatMode === 'regular-plus-semantic'}
              />
              {console.log('[Chat] Passing chatMode to MultimodalInput:', chatMode)}
            </div>
          </div>
        </div>
      </div>

      <Artifact
        chatId={id}
        isVisible={isArtifactVisible}
        attachments={attachments}
        setAttachments={setAttachments}
      />
    </>
  );
}
