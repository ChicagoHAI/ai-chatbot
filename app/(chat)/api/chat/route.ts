// Import AI SDK utilities for proper streaming
import {
  createUIMessageStream,
  JsonToSseTransformStream,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTextFromMessage } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
import { getHypothesesFromMessage } from '@/lib/hypothesis-utils';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    // ────────────────────────────────────────────────────────────
    // Create AI SDK UI message stream that transforms backend data
    // ────────────────────────────────────────────────────────────

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        // Create a readable stream that transforms the backend response
        const backendStream = new ReadableStream({
          async start(controller) {
            try {
              const backendBaseUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
              const backendEndpoint = new URL('/api/chat/', backendBaseUrl).toString();

              const backendPayload = {
                user_id: session.user.id,
                message: getTextFromMessage(message),
                conversation_id: null,
                stream: true,
                system_prompt: null,
                temperature: 0.7,
                max_tokens: 8000,
                show_context: false,
                multifaceted: true,
                top_k_per_facet: 3,
                min_facets: 3,
                max_facets: 6,
              };

              const ragResponse = await fetch(backendEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(backendPayload),
              });

              if (!ragResponse.ok || !ragResponse.body) {
                controller.error(new Error(`Backend error (${ragResponse.status})`));
                return;
              }

              const decoder = new TextDecoder();
              const reader = ragResponse.body.getReader();
              
              const textBlockId = generateUUID();
              let buffer = '';
              let textBlockStarted = false;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';

                for (const part of parts) {
                  if (!part.startsWith('data: ')) continue;
                  const payload = part.slice(6);
                  
                  // Handle completion signal
                  if (payload.trim() === '[DONE]') {
                    if (textBlockStarted) {
                      controller.enqueue({ type: 'text-end', id: textBlockId });
                    }
                    controller.enqueue({ type: 'finish' });
                    controller.close();
                    return;
                  }
                  
                  if (!payload.trim().startsWith('{')) continue;
                  
                  try {
                    const json = JSON.parse(payload);
                    
                    switch (json.type) {
                      case 'reasoning-start':
                        controller.enqueue({ 
                          type: 'reasoning-start', 
                          id: json.id 
                        });
                        break;
                        
                      case 'reasoning-delta':
                        controller.enqueue({ 
                          type: 'reasoning-delta', 
                          id: json.id, 
                          delta: json.delta 
                        });
                        break;
                        
                      case 'reasoning-end':
                        controller.enqueue({ 
                          type: 'reasoning-end', 
                          id: json.id 
                        });
                        break;
                        
                      case 'text-start':
                        if (!textBlockStarted) {
                          textBlockStarted = true;
                          controller.enqueue({ type: 'text-start', id: textBlockId });
                        }
                        break;
                        
                      case 'text-delta':
                        if (!textBlockStarted) {
                          textBlockStarted = true;
                          controller.enqueue({ type: 'text-start', id: textBlockId });
                        }
                        if (typeof json.delta === 'string') {
                          controller.enqueue({ 
                            type: 'text-delta', 
                            id: textBlockId, 
                            delta: json.delta 
                          });
                        }
                        break;
                        
                      case 'text-end':
                        if (textBlockStarted) {
                          controller.enqueue({ type: 'text-end', id: textBlockId });
                          textBlockStarted = false;
                        }
                        break;
                        
                      case 'finish':
                        // Backend finish signal - just pass through
                        // Real completion happens with [DONE] signal
                        controller.enqueue({ type: 'finish' });
                        break;
                    }
                  } catch (e) {
                    console.warn('Failed to parse backend stream JSON:', payload);
                  }
                }
              }
            } catch (error) {
              console.error('Backend stream error:', error);
              controller.error(error);
            }
          }
        });

        // Use merge like the original - let AI SDK manage the stream lifecycle
        dataStream.merge(backendStream);
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        // Debug: Log all messages received in onFinish
        console.log(`[onFinish] Received ${messages.length} messages total`);
        messages.forEach((msg, idx) => {
          console.log(`[onFinish] Message ${idx}: role=${msg.role}, id=${msg.id}`);
        });
        
        // Only save the assistant messages - user message was already saved above
        const assistantMessages = messages.filter(m => m.role === 'assistant');
        
        console.log(`[onFinish] Saving ${assistantMessages.length} assistant messages`);
        
        if (assistantMessages.length === 0) {
          console.log('[onFinish] No assistant messages to save');
          return;
        }
        
        await saveMessages({
          messages: assistantMessages.map((message) => {
            let hypotheses = null;
            
            // Extract hypotheses from assistant messages
            const extractedHypotheses = getHypothesesFromMessage(message, id);
            if (extractedHypotheses.length > 0) {
              hypotheses = extractedHypotheses;
              console.log(`[onFinish] Extracted ${extractedHypotheses.length} hypotheses for message ${message.id}`);
              console.log(`[onFinish] First hypothesis ID: ${extractedHypotheses[0]?.id}`);
            }
            
            return {
              id: message.id,
              role: message.role,
              parts: message.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
              hypotheses,
            };
          }),
        });
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
