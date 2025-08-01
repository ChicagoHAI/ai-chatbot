import { auth } from '@/app/(auth)/auth';
import { 
  getChatById, 
  getHypothesisFeedbackByMessageId,
  saveHypothesisFeedback,
  getHypothesisFeedbackStats 
} from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get('messageId');
  const getStats = searchParams.get('stats') === 'true';

  if (!messageId) {
    return new ChatSDKError(
      'bad_request:api',
      'Parameter messageId is required.',
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  try {
    if (getStats) {
      // Return feedback statistics for the message
      const stats = await getHypothesisFeedbackStats({ messageId });
      return Response.json(stats, { status: 200 });
    } else {
      // Return user's feedback for the message
      const feedback = await getHypothesisFeedbackByMessageId({
        messageId,
        userId: session.user.id,
      });
      return Response.json(feedback, { status: 200 });
    }
  } catch (error) {
    return new ChatSDKError(
      'bad_request:database',
      'Failed to get hypothesis feedback',
    ).toResponse();
  }
}

export async function POST(request: Request) {
  const {
    chatId,
    messageId,
    rating,
    feedbackText,
    feedbackType,
    hypothesisRatings,
  }: {
    chatId: string;
    messageId: string;
    rating: 'helpful' | 'not_helpful' | 'needs_improvement';
    feedbackText?: string;
    feedbackType?: 'quality' | 'novelty' | 'feasibility' | 'clarity' | 'other';
    hypothesisRatings?: Record<string, 'helpful' | 'not_helpful' | 'needs_improvement'>;
  } = await request.json();

  if (!chatId || !messageId || !rating) {
    return new ChatSDKError(
      'bad_request:api',
      'Parameters chatId, messageId, and rating are required.',
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  // Verify user has access to this chat
  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:api').toResponse();
  }

  try {
    const feedback = await saveHypothesisFeedback({
      chatId,
      messageId,
      userId: session.user.id,
      rating,
      feedbackText,
      feedbackType,
      hypothesisRatings,
    });

    return Response.json(feedback, { status: 200 });
  } catch (error) {
    return new ChatSDKError(
      'bad_request:database',
      'Failed to save hypothesis feedback',
    ).toResponse();
  }
}