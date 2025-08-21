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
import { getHypothesesFromMessage } from '@/lib/hypothesis-utils';
import { useSession } from 'next-auth/react';

// Type narrowing is handled by TypeScript's control flow analysis
// The AI SDK provides proper discriminated unions for tool calls


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
  const { data: session } = useSession();
  
  // State to track if hypothesis generation has been triggered

  
  // Extract query and papers from Semantic Scholar message
  const extractSemanticScholarData = (text: string) => {
    const queryMatch = text.match(/Found \d+ papers for query: (.+?)\n/);
    const query = queryMatch ? queryMatch[1] : '';
    
    console.log('[DEBUG] Extracting from text:', text.substring(0, 200) + '...');
    
    // Extract papers from the message content
    const papers: any[] = [];
    
    // Look for paper patterns in the text - updated to match actual format
    const paperMatches = text.matchAll(/### Paper (\d+): (.+?)\n\*\*Authors:\*\* (.+?)\n\*\*Year:\*\* (.+?)\n\*\*Venue:\*\* (.+?)\n\*\*Citations:\*\* (\d+)\n\*\*Abstract:\*\* (.+?)(?=\n\n### Paper|\n\n---|\n\n\*\*Want to generate|\n\n$)/gs);
    
    console.log('[DEBUG] Paper matches found:', Array.from(paperMatches).length);
    
    // Reset the iterator since we used it above
    const paperMatches2 = text.matchAll(/### Paper (\d+): (.+?)\n\*\*Authors:\*\* (.+?)\n\*\*Year:\*\* (.+?)\n\*\*Venue:\*\* (.+?)\n\*\*Citations:\*\* (\d+)\n\*\*Abstract:\*\* (.+?)(?=\n\n### Paper|\n\n---|\n\n\*\*Want to generate|\n\n$)/gs);
    
    for (const match of paperMatches2) {
      const [, number, title, authors, year, venue, citations, abstract] = match;
      papers.push({
        title: title.trim(),
        authors: authors.split(',').map(a => ({ name: a.trim() })),
        year: parseInt(year) || 'Unknown',
        venue: venue.trim(),
        citationCount: parseInt(citations) || 0,
        abstract: abstract.trim(),
        paperId: `paper-${number}`,
      });
    }
    
    console.log('[DEBUG] Extracted papers:', papers.length, papers);
    return { query, papers };
  };


  
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
                        
                        {/* Show Generate Hypotheses button for Semantic Scholar messages */}
                        {message.role === 'assistant' && 
                         (part.text.includes('Want to generate hypotheses from these papers?') || 
                          part.text.includes('## Retrieved Papers')) && (
                          <div className="mt-4">
                            {(() => {
                              console.log('[DEBUG] RENDERING BUTTON - Message text for button:', part.text.substring(0, 500) + '...');
                              const { query, papers } = extractSemanticScholarData(part.text);
                              console.log('[DEBUG] RENDERING BUTTON - Button papers extraction:', { query, papersCount: papers.length, papers });
                              console.log('[DEBUG] RENDERING BUTTON - About to render GenerateHypothesesButton');
                              console.log('[DEBUG] RENDERING BUTTON - GenerateHypothesesButton rendered');
                              
                              // Auto-generation removed - hypotheses are now generated directly in the POST response
                              return null;
                            })()}
                          </div>
                        )}
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
              console.log('[DEBUG] Checking for hypotheses, isLoading:', isLoading, 'messageId:', message.id);
              
              // Check if this message contains Semantic Scholar paper data
              const textContent = message.parts.find(part => part.type === 'text')?.text || '';
              const isSemanticScholarResponse = textContent.includes('## Retrieved Papers') || 
                (textContent.includes('Found') && textContent.includes('papers for query')) ||
                textContent.includes('Want to generate hypotheses from these papers') ||
                textContent.includes('## Generated Hypotheses');
              
              console.log('[DEBUG] Message text preview:', textContent.substring(0, 100) + '...');
              console.log('[DEBUG] Is Semantic Scholar response:', isSemanticScholarResponse);
              
              // Only extract hypotheses if this is NOT a Semantic Scholar response
              // (Semantic Scholar responses should use the "Generate Hypotheses" button instead)
              if (!isSemanticScholarResponse) {
                // IMPORTANT: Extract hypotheses with the UI message ID, not the database ID
                // This ensures the hypothesis IDs match what the user sees
                const hypotheses = getHypothesesFromMessage(message, chatId);
                
                if (hypotheses.length > 0) {
                  console.log('[DEBUG] Rendering HypothesisFeedback with text-parsed hypotheses:', hypotheses.length, 'messageId:', message.id);
                  console.log('[DEBUG] First hypothesis ID:', hypotheses[0]?.id);
                  console.log('[DEBUG] Message ID in UI:', message.id);
                  
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
              } else {
                console.log('[DEBUG] Skipping hypothesis extraction for Semantic Scholar response');
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
