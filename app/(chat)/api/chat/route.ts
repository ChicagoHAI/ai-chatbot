// AI SDK utilities are no longer required here because we proxy the
// FastAPI backend directly instead of using the built-in language model
// helpers.
import { auth, type UserType } from '@/app/(auth)/auth';
// system prompt utilities removed
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
// Removed resumable-stream imports because we no longer rely on them.
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
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

    // Create a streamId so the /stream resume endpoint can succeed and avoid
    // duplicate reasoning / 404 errors.
    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    // ────────────────────────────────────────────────────────────
    // STEP 1:  Call the RAG backend (FastAPI) and obtain an SSE
    //          stream with plain text tokens ("data: TOKEN\n\n").
    //
    // IMPORTANT: the backend URL can be configured through the
    //            BACKEND_URL env-var so that it works both locally
    //            and in production.  A sensible default is the
    //            docker-compose development address.
    // ────────────────────────────────────────────────────────────
    const backendBaseUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
    const backendEndpoint = new URL('/api/chat/', backendBaseUrl).toString();

    // Build the request payload expected by the FastAPI endpoint.
    const backendPayload = {
      user_id: session.user.id,
      message: getTextFromMessage(message),
      conversation_id: null,
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

    const ragResponse = await fetch(backendEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backendPayload),
    });

    if (!ragResponse.ok || !ragResponse.body) {
      throw new Error(`Backend error (${ragResponse.status}) while fetching ${backendEndpoint}`);
    }

    // ────────────────────────────────────────────────────────────
    // STEP 2:  Convert the backend SSE stream into the AI-SDK UI
    //          message stream protocol expected by the template.
    // ────────────────────────────────────────────────────────────
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const assistantMessageId = generateUUID();
    const textBlockId = generateUUID();
    let accumulatedText = '';
    let buffer = '';

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      start() {},
      transform(chunk, controller) {
        // Forward chunk directly to client
        controller.enqueue(chunk);

        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const payload = part.slice(6);
          if (!payload.trim().startsWith('{')) continue;
          try {
            const json = JSON.parse(payload);
            if (
              (json.type === 'text-delta' || json.type === 'textStart' || json.type === 'text-delta') &&
              typeof json.delta === 'string'
            ) {
              accumulatedText += json.delta;
            }
          } catch (_) {}
        }
      },
      flush() {
        saveMessages({
          messages: [
            {
              id: assistantMessageId,
              role: 'assistant',
              parts: [{ type: 'text', text: accumulatedText }],
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            },
          ],
        }).catch(console.error);
      },
    });

    const proxyStream = ragResponse.body.pipeThrough(transformStream);

    return new Response(proxyStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
    });
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
