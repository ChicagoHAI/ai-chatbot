import { auth } from '@/app/(auth)/auth';
import { createGuestUser, getChatById, saveChat, saveMessages } from '@/lib/db/queries';
import { getTextFromMessage } from '@/lib/utils';
import { ChatSDKError } from '@/lib/errors';
import { postRequestBodySchema, type PostRequestBody } from '../chat/schema';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[SIMPLE-CHAT] Received request body:', JSON.stringify(body, null, 2));
    
    // Handle different request formats
    let messages, id;
    
    if (body.messages && Array.isArray(body.messages)) {
      // Format from useChat hook
      messages = body.messages;
      id = body.id;
    } else if (body.message) {
      // Alternative format
      messages = [body.message];
      id = body.id;
    } else {
      return new Response('Invalid request format: missing messages', { status: 400 });
    }

    if (!messages || messages.length === 0) {
      return new Response('No messages found', { status: 400 });
    }

    const message = messages[messages.length - 1];

    if (!message?.parts?.length) {
      return new Response('No message content', { status: 400 });
    }

    const textPart = message.parts.find((part: any) => part.type === 'text');
    if (!textPart) {
      return new Response('No text content found', { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Use the simple chat backend endpoint
    const backendBaseUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
    const backendEndpoint = new URL('/api/simple-chat/', backendBaseUrl).toString();

    const backendPayload = {
      user_id: session.user.id,
      message: getTextFromMessage(message),
      conversation_id: id,
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log('[SIMPLE-CHAT] Sending to backend:', backendPayload);

    const backendResponse = await fetch(backendEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backendPayload),
    });

    if (!backendResponse.ok) {
      console.error('[SIMPLE-CHAT] Backend error:', backendResponse.status, backendResponse.statusText);
      throw new Error(`Backend error: ${backendResponse.status}`);
    }

    // Return the streaming response from backend
    return new Response(backendResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'x-vercel-ai-data-stream': 'v1',
      },
    });
  } catch (error) {
    console.error('[SIMPLE-CHAT] Error processing request:', error);
    return new Response(`Error processing request: ${error}`, { status: 500 });
  }
}
