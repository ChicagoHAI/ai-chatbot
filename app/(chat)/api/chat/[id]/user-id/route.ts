import { auth } from '@/app/(auth)/auth';
import { getChatById } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const chat = await getChatById({ id: params.id });
    if (!chat) {
      return new Response('Chat not found', { status: 404 });
    }

    // For now, allow access if the chat exists and user is authenticated
    // This simplifies the guest user handling
    console.log(`[USER-ID] Chat ${params.id} belongs to user ${chat.userId}, session user is ${session.user.id} (type: ${session.user.type})`);

    return new Response(JSON.stringify({ userId: chat.userId }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[GET_CHAT_USER_ID] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
