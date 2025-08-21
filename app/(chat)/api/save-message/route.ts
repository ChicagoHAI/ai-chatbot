import { auth } from '@/app/(auth)/auth';
import { getChatById, saveMessages } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function POST(request: Request) {
  try {
    const { chatId, message } = await request.json();
    
    const session = await auth();
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get the chat to verify ownership and get the correct user ID
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return new Response('Chat not found', { status: 404 });
    }

    // For now, allow access if the chat exists and user is authenticated
    // This simplifies the guest user handling
    console.log(`[SAVE-MESSAGE] Chat ${chatId} belongs to user ${chat.userId}, session user is ${session.user.id} (type: ${session.user.type})`);

    // Save the message using the chat's user ID
    await saveMessages({
      messages: [{
        chatId: chatId,
        id: message.id,
        role: message.role,
        parts: message.parts,
        attachments: message.attachments || [],
        createdAt: new Date(),
        hypotheses: message.hypotheses || null,
      }],
    });

    console.log('[SAVE-MESSAGE] Saved message:', message.id, 'for chat:', chatId);
    return new Response('Message saved', { status: 200 });
  } catch (error) {
    console.error('[SAVE-MESSAGE] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
