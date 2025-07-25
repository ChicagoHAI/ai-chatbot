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
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';

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

// Helper function to get text content from message parts
function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
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
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    // Save the user message to database
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

    // Get the user's message text
    const userMessageText = getTextFromMessage(message);
    console.log('🔍 User message:', userMessageText);
    console.log('🔍 Session user ID:', session.user.id);

    // Connect to your RAG backend
    const backendUrl = 'http://localhost:8080'; // Hard-coded for debugging
    const chatUrl = `${backendUrl}/api/chat/`;
    console.log('🔍 Backend URL:', chatUrl);
    console.log('🔍 ENV BACKEND_URL:', process.env.BACKEND_URL);
    console.log('🔍 ENV NEXT_PUBLIC_BACKEND_URL:', process.env.NEXT_PUBLIC_BACKEND_URL);
    
    // Validate URL format
    try {
      new URL(chatUrl);
      console.log('🔍 URL validation passed');
    } catch (urlError) {
      console.error('🔍 URL validation failed:', urlError);
      throw new Error(`Invalid URL: ${chatUrl}`);
    }

    try {
      // Call your backend API
      const requestBody = {
        user_id: session.user.id,
        message: userMessageText,
        conversation_id: null, // Let backend create new conversations
        stream: true,
        system_prompt: null,
        temperature: 0.7,
        max_tokens: 800,
        show_context: false,
        multifaceted: true,
        top_k_per_facet: 3,
        min_facets: 3,
        max_facets: 6,
      };
      console.log('🔍 Request body:', JSON.stringify(requestBody, null, 2));
      
      console.log('🔍 About to make fetch request to:', chatUrl);
      
      // Try with explicit URL construction to avoid any parsing issues
      const fetchUrl = new URL('/api/chat/', 'http://localhost:8080').toString();
      console.log('🔍 Using explicit URL:', fetchUrl);
      
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }).catch(fetchError => {
        console.error('🔍 Fetch error details:', fetchError);
        console.error('🔍 Fetch error cause:', fetchError.cause);
        console.error('🔍 Fetch error stack:', fetchError.stack);
        throw fetchError;
      });

      console.log('🔍 Backend response status:', response.status);
      console.log('🔍 Backend response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🔍 Backend error response:', errorText);
        throw new Error(`Backend responded with ${response.status}: ${errorText}`);
      }

      // Create a transform stream to convert backend SSE to AI SDK format
      let messageId = generateUUID();
      let accumulatedText = '';
      let buffer = '';
      
      const transformStream = new TransformStream({
        start(controller) {
          // Send initial message structure
          controller.enqueue(`0:{"type":"id","id":"${messageId}"}\n`);
          controller.enqueue(`0:{"type":"message-start","id":"${messageId}","role":"assistant"}\n`);
        },
        transform(chunk, controller) {
          const decoder = new TextDecoder();
          buffer += decoder.decode(chunk, { stream: true });
          
          // Split by double newlines for proper SSE format
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || ''; // Keep incomplete message in buffer
          
          for (const message of messages) {
            if (message.startsWith('data: ')) {
              const tokenData = message.slice(6);
              if (tokenData && tokenData !== '[DONE]') {
                accumulatedText += tokenData;
                
                // Escape quotes and newlines for JSON
                const escapedToken = tokenData.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
                
                // Send text delta in AI SDK format
                controller.enqueue(`0:{"type":"text-delta","textDelta":"${escapedToken}"}\n`);
              }
            }
          }
        },
        flush(controller) {
          // Process any remaining buffer for final SSE message
          if (buffer.trim()) {
            if (buffer.startsWith('data: ')) {
              const tokenData = buffer.slice(6);
              if (tokenData && tokenData !== '[DONE]' && tokenData !== '') {
                accumulatedText += tokenData;
              }
            }
          }
          
          // Escape the accumulated text for JSON
          const escapedText = accumulatedText.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
          
          // Send final message parts
          controller.enqueue(`0:{"type":"message-part","messageId":"${messageId}","part":{"type":"text","text":"${escapedText}"}}\n`);
          controller.enqueue(`0:{"type":"message-end","messageId":"${messageId}"}\n`);
          controller.enqueue(`d:{"type":"finish"}\n`);
          
          // Save the assistant's response to database
          saveMessages({
            messages: [
              {
                id: messageId,
                role: 'assistant',
                parts: [{ type: 'text', text: accumulatedText }],
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              },
            ],
          }).catch(console.error);
        }
      });

      // Forward the streaming response through our transform
      return new Response(response.body?.pipeThrough(transformStream), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });

    } catch (error) {
      console.error('Error connecting to backend:', error);
      
      // Return a simple error response in AI SDK format
      const errorMessageId = generateUUID();
      const errorMessage = 'Sorry, I encountered an error while processing your request. Please make sure the backend is running and try again.';
      
      const errorResponse = [
        `0:{"type":"id","id":"${errorMessageId}"}`,
        `0:{"type":"message-start","id":"${errorMessageId}","role":"assistant"}`,
        `0:{"type":"text-delta","textDelta":"${errorMessage}"}`,
        `0:{"type":"message-part","messageId":"${errorMessageId}","part":{"type":"text","text":"${errorMessage}"}}`,
        `0:{"type":"message-end","messageId":"${errorMessageId}"}`,
        `d:{"type":"finish"}`,
        ''
      ].join('\n');

      return new Response(errorResponse, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    console.error('Unexpected error:', error);
    return new ChatSDKError('bad_request:api').toResponse();
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
