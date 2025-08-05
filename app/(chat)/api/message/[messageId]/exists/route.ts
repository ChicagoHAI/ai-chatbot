import { auth } from '@/app/(auth)/auth';
import { getMessageById } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  const { messageId } = await params;

  try {
    const messages = await getMessageById({ id: messageId });
    const exists = messages.length > 0;
    
    return Response.json({ 
      exists,
      messageId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to check message existence:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}