import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import { postRequestBodySchema, type PostRequestBody } from '../chat/schema';
import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { generateUUID, getTextFromMessage } from '@/lib/utils';

export const maxDuration = 60;

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    console.log('[REGULAR-PLUS-SEMANTIC] Received request body:', JSON.stringify(json, null, 2));
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    console.error('[REGULAR-PLUS-SEMANTIC] Request parsing error:', error);
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
      message: any;
      selectedChatModel: string;
      selectedVisibilityType: string;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    // Extract the text from the message parts
    const textPart = message.parts.find((part: any) => part.type === 'text');
    if (!textPart) {
      return new ChatSDKError('bad_request:api', 'No text message found').toResponse();
    }

    const userMessage = getTextFromMessage(message);
    console.log('[REGULAR-PLUS-SEMANTIC] User message:', userMessage);

    // Create AI SDK UI message stream that transforms backend data
    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        // Create a readable stream that transforms the backend response
        const backendStream = new ReadableStream({
          async start(controller) {
            try {
              const backendBaseUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
              const backendEndpoint = new URL('/api/v1/regular-plus-semantic/conversation', backendBaseUrl).toString();

              const backendPayload = {
                user_id: session.user.id,
                message: userMessage,
                conversation_id: id,
                stream: false, // Try non-streaming first
              };

              console.log('[REGULAR-PLUS-SEMANTIC] Calling Python backend with LangGraph');
              console.log('[REGULAR-PLUS-SEMANTIC] Backend endpoint:', backendEndpoint);

              const ragResponse = await fetch(backendEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(backendPayload),
              });

              console.log('[REGULAR-PLUS-SEMANTIC] Backend response status:', ragResponse.status);
              console.log('[REGULAR-PLUS-SEMANTIC] Backend response ok:', ragResponse.ok);

              if (!ragResponse.ok) {
                console.error('[REGULAR-PLUS-SEMANTIC] Backend error details:', {
                  status: ragResponse.status,
                  statusText: ragResponse.statusText,
                });
                controller.error(new Error(`Backend error (${ragResponse.status})`));
                return;
              }

              // Handle non-streaming response from backend
              const responseData = await ragResponse.json();
              console.log('[REGULAR-PLUS-SEMANTIC] Backend response data:', responseData);
              
              // Create a simple streaming response for the frontend
              const textBlockId = generateUUID();
              
              // Send start-step
              controller.enqueue({ type: 'start-step' });
              
              // Send text-start
              controller.enqueue({ type: 'text-start', id: textBlockId });
              
              // Send the response content word by word
              const words = responseData.content.split(' ');
              console.log('[REGULAR-PLUS-SEMANTIC] Sending', words.length, 'words');
              for (const word of words) {
                const chunk = { type: 'text-delta', id: textBlockId, delta: word + ' ' };
                console.log('[REGULAR-PLUS-SEMANTIC] Sending chunk:', chunk);
                controller.enqueue(chunk);
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for streaming effect
              }
              
              // Send text-end
              controller.enqueue({ type: 'text-end', id: textBlockId });
              
              // Send finish
              controller.enqueue({ type: 'finish' });
              controller.enqueue({ type: 'finish-step' });
              
              controller.close();
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
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'x-vercel-ai-data-stream': 'v1',
      },
    });

  } catch (error) {
    console.error('Regular Plus Semantic API error:', error);
    return new ChatSDKError('bad_request:api').toResponse();
  }
}
