'use client';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import { HypothesisFeedback } from './hypothesis-feedback';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { useDataStream } from './data-stream-provider';

// Type narrowing is handled by TypeScript's control flow analysis
// The AI SDK provides proper discriminated unions for tool calls

// Helper function to extract hypotheses from text content
function extractHypothesesFromText(text: string): Array<{id: string, title: string, description: string}> {
  console.log('[DEBUG] Extracting hypotheses from text, length:', text.length);
  console.log('[DEBUG] First 500 chars of text:', text.substring(0, 500));
  
  const hypothesesMatch = text.match(/<!-- HYPOTHESES_START -->([\s\S]*?)<!-- HYPOTHESES_END -->/);
  if (!hypothesesMatch) {
    console.log('[DEBUG] No HYPOTHESES_START/END markers found');
    return [];
  }
  
  const hypothesesText = hypothesesMatch[1];
  console.log('[DEBUG] Extracted hypotheses text:', hypothesesText.substring(0, 200) + '...');
  
  const hypotheses: Array<{id: string, title: string, description: string}> = [];
  
  // Parse each hypothesis using regex - match the actual format from backend
  const hypothesisPattern = /\*\*Hypothesis (\d+):\s*([^*]+?)\*\*\s*\n([^*]+?)(?=\n\*\*Hypothesis|$)/gs;
  let match;
  
  while ((match = hypothesisPattern.exec(hypothesesText)) !== null) {
    const [, num, title, description] = match;
    console.log(`[DEBUG] Found hypothesis ${num}:`, { title: title.trim(), description: description.trim().substring(0, 50) + '...' });
    // Generate unique ID using timestamp and random string to avoid conflicts
    const uniqueId = `hyp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}_${num}`;
    hypotheses.push({
      id: uniqueId,
      title: title.trim(),
      description: description.trim()
    });
  }
  
  console.log('[DEBUG] Total hypotheses extracted:', hypotheses.length);
  return hypotheses;
}

// Helper function to get hypotheses from message text parts
function getHypothesesFromMessage(message: ChatMessage): Array<{id: string, title: string, description: string}> {
  const textParts = message.parts.filter(part => part.type === 'text');
  for (const part of textParts) {
    if (part.text) {
      const hypotheses = extractHypothesesFromText(part.text);
      if (hypotheses.length > 0) {
        console.log('[DEBUG] Found hypotheses in text content:', hypotheses.length);
        return hypotheses;
      }
    }
  }
  return [];
}

// Helper function to save hypotheses to database
async function saveHypothesesToDatabase(messageId: string, hypotheses: Array<{id: string, title: string, description: string}>) {
  if (hypotheses.length === 0) return;
  
  try {
    console.log('[DEBUG] Saving hypotheses to database:', hypotheses.length);
    const hypothesesWithOrder = hypotheses.map((h, index) => ({
      ...h,
      orderIndex: index + 1,
    }));

    const response = await fetch('/api/message/' + messageId + '/hypotheses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hypotheses: hypothesesWithOrder }),
    });

    if (!response.ok) {
      console.error('[DEBUG] Failed to save hypotheses:', response.statusText);
    } else {
      console.log('[DEBUG] Successfully saved hypotheses to database');
    }
  } catch (error) {
    console.error('[DEBUG] Error saving hypotheses:', error);
  }
}


const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === 'file',
  );

  const { dataStream } = useDataStream();
  
  // Streaming debug info - remove after testing
  useEffect(() => {
    if (message.role === 'assistant' && process.env.NODE_ENV === 'development') {
      console.log(`[STREAMING] Message ${message.id} parts:`, message.parts?.length, 'isLoading:', isLoading);
    }
  }, [message.parts, isLoading, message.id, message.role]);

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div
            className={cn('flex flex-col gap-4 w-full', {
              'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            })}
          >
            {attachmentsFromMessage.length > 0 && (
              <div
                data-testid={`message-attachments`}
                className="flex flex-row justify-end gap-2"
              >
                {attachmentsFromMessage.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={{
                      name: attachment.filename ?? 'file',
                      contentType: attachment.mediaType,
                      url: attachment.url,
                    }}
                  />
                ))}
              </div>
            )}

            {(() => {
              console.log('[DEBUG] Rendering message parts for message:', message.id, 'Parts count:', message.parts?.length || 0);
              return null;
            })()}
            {message.parts?.map((part, index) => {
              const { type } = part;
              
              // Debug logging for all parts
              if (message.role === 'assistant') {
                console.log('[DEBUG] Message part:', { 
                  messageId: message.id,
                  type, 
                  index, 
                  hasData: 'data' in part,
                  partKeys: Object.keys(part),
                  data: 'data' in part ? part.data : 'no data'
                });
              }
              
              const key = `message-${message.id}-part-${index}`;

              if (type === 'reasoning' && part.text?.trim().length > 0) {
                return (
                  <MessageReasoning
                    key={key}
                    isLoading={isLoading}
                    reasoning={part.text}
                  />
                );
              }

              if (type === 'text') {
                if (mode === 'view') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      {message.role === 'user' && !isReadonly && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid="message-edit-button"
                              variant="ghost"
                              className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                              onClick={() => {
                                setMode('edit');
                              }}
                            >
                              <PencilEditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit message</TooltipContent>
                        </Tooltip>
                      )}

                      <div
                        data-testid="message-content"
                        className={cn('flex flex-col gap-4', {
                          'bg-primary text-primary-foreground px-3 py-2 rounded-xl':
                            message.role === 'user',
                        })}
                      >
                        <Markdown>{sanitizeText(part.text)}</Markdown>
                      </div>
                    </div>
                  );
                }

                if (mode === 'edit') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      <div className="size-8" />

                      <MessageEditor
                        key={message.id}
                        message={message}
                        setMode={setMode}
                        setMessages={setMessages}
                        regenerate={regenerate}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-getWeather') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  return (
                    <div key={toolCallId} className="skeleton">
                      <Weather />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;
                  return (
                    <div key={toolCallId}>
                      <Weather weatherAtLocation={output} />
                    </div>
                  );
                }
              }

              if (type === 'tool-createDocument') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;
                  return (
                    <div key={toolCallId}>
                      <DocumentPreview isReadonly={isReadonly} args={input} />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={toolCallId}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={toolCallId}>
                      <DocumentPreview
                        isReadonly={isReadonly}
                        result={output}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-updateDocument') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;

                  return (
                    <div key={toolCallId}>
                      <DocumentToolCall
                        type="update"
                        args={input}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={toolCallId}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={toolCallId}>
                      <DocumentToolResult
                        type="update"
                        result={output}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-requestSuggestions') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;
                  return (
                    <div key={toolCallId}>
                      <DocumentToolCall
                        type="request-suggestions"
                        args={input}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={toolCallId}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={toolCallId}>
                      <DocumentToolResult
                        type="request-suggestions"
                        result={output}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }
              }

              if (type === 'data-hypotheses') {
                const { id, data } = part;
                console.log('[DEBUG] Rendering hypotheses data part:', data);
                // Type assertion - check what we actually get
                const hypothesesData = data as any;
                return (
                  <div key={id} className="mt-4">
                    <HypothesisFeedback
                      chatId={chatId}
                      messageId={message.id}
                      isHypothesisResponse={true}
                      hypotheses={hypothesesData.hypotheses || hypothesesData || []}
                    />
                  </div>
                );
              }
            })}

            {!isReadonly && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                vote={vote}
                isLoading={isLoading}
              />
            )}

            {/* Hypothesis feedback for assistant messages - parse from text content */}
            {!isReadonly && !isLoading && message.role === 'assistant' && (() => {
              console.log('[DEBUG] Checking for hypotheses, isLoading:', isLoading);
              const hypotheses = getHypothesesFromMessage(message);
              if (hypotheses.length > 0) {
                console.log('[DEBUG] Rendering HypothesisFeedback with text-parsed hypotheses:', hypotheses.length);
                
                // Delay hypothesis saving to ensure message is persisted first
                setTimeout(() => {
                  saveHypothesesToDatabase(message.id, hypotheses).catch(console.error);
                }, 2000);
                
                return (
                  <HypothesisFeedback
                    key={`feedback-${message.id}`}
                    chatId={chatId}
                    messageId={message.id}
                    isHypothesisResponse={true}
                    hypotheses={hypotheses}
                  />
                );
              }
              return null;
            })()}

          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;

    return false; // Return false to allow re-renders for streaming updates
  },
);

export const ThinkingMessage = () => {
  const role = 'assistant';

  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-4 group/message min-h-96"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role={role}
    >
      <div
        className={cx(
          'flex gap-4 group-data-[role=user]/message:px-3 w-full group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl group-data-[role=user]/message:py-2 rounded-xl',
          {
            'group-data-[role=user]/message:bg-muted': true,
          },
        )}
      >
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            Hmm...
          </div>
        </div>
      </div>
    </motion.div>
  );
};
