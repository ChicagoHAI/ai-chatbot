import { auth } from '@/app/(auth)/auth';
import {
  saveIndividualHypothesisFeedback,
  getIndividualHypothesisFeedback,
  getIndividualHypothesisFeedbackStats,
  upsertHypothesis,
  getMessageById,
} from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import type { HypothesisData } from '@/lib/hypothesis-utils';

// GET /api/hypothesis/[hypothesisId]/feedback
export async function GET(
  request: Request,
  { params }: { params: Promise<{ hypothesisId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  const { hypothesisId } = await params;
  const { searchParams } = new URL(request.url);
  const includeStats = searchParams.get('includeStats') === 'true';

  try {
    // Get user's feedback for this hypothesis
    const userFeedback = await getIndividualHypothesisFeedback({
      hypothesisId,
      userId: session.user.id,
    });

    const response: any = {
      userFeedback: userFeedback || null,
    };

    // Optionally include aggregate stats
    if (includeStats) {
      const stats = await getIndividualHypothesisFeedbackStats({ hypothesisId });
      response.stats = stats;
    }

    return Response.json(response);
  } catch (error) {
    console.error('Failed to get hypothesis feedback:', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new Response('Internal Server Error', { status: 500 });
  }
}

// POST /api/hypothesis/[hypothesisId]/feedback
export async function POST(
  request: Request,
  { params }: { params: Promise<{ hypothesisId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  const { hypothesisId } = await params;

  try {
    const body = await request.json();
    const { rating, feedbackText, feedbackCategory } = body;

    // Validate rating
    if (!rating || !['helpful', 'not_helpful', 'needs_improvement'].includes(rating)) {
      return new Response('Invalid rating', { status: 400 });
    }

    // Validate category if provided
    if (feedbackCategory && 
        !['quality', 'novelty', 'feasibility', 'clarity', 'other'].includes(feedbackCategory)) {
      return new Response('Invalid feedback category', { status: 400 });
    }

    // Parse hypothesis ID to get chatId, messageId, hypothesisNumber
    const hypothesisIdParts = hypothesisId.split('_');
    if (hypothesisIdParts.length !== 4 || hypothesisIdParts[0] !== 'hyp') {
      return new Response('Invalid hypothesis ID format', { status: 400 });
    }

    const [, chatId, messageId, hypothesisNumStr] = hypothesisIdParts;
    const hypothesisNumber = Number.parseInt(hypothesisNumStr, 10);

    // Get message with hypotheses JSON
    let messages = await getMessageById({ id: messageId });
    
    // If message not found by ID, try to find the assistant message in this chat
    // This handles the case where UI message IDs don't match database IDs
    if (!messages || messages.length === 0) {
      console.log(`[Feedback API] Message ${messageId} not found, trying to find assistant message in chat ${chatId}`);
      
      // Get all messages in the chat
      const { getMessagesByChatId } = await import('@/lib/db/queries');
      const chatMessages = await getMessagesByChatId({ id: chatId });
      
      // Find assistant messages with hypotheses
      const assistantMessages = chatMessages.filter(m => 
        m.role === 'assistant' && 
        m.hypotheses && 
        (m.hypotheses as any[]).length > 0
      );
      
      if (assistantMessages.length > 0) {
        // Use the most recent assistant message with hypotheses
        const message = assistantMessages[assistantMessages.length - 1];
        console.log(`[Feedback API] Found assistant message ${message.id} with hypotheses in chat`);
        messages = [message];
      } else {
        return new Response('Message not found and no assistant messages with hypotheses in chat', { status: 404 });
      }
    }

    const message = messages[0];
    const hypotheses = (message.hypotheses as HypothesisData[]) || [];
    
    // Find the specific hypothesis
    // First try exact match
    let hypothesis = hypotheses.find(h => h.id === hypothesisId);
    
    // If not found, try matching by hypothesis number (in case message ID is different)
    if (!hypothesis && hypotheses.length >= hypothesisNumber) {
      hypothesis = hypotheses[hypothesisNumber - 1];
      console.log(`[Feedback API] Using hypothesis by index: ${hypothesisNumber}, actual ID: ${hypothesis?.id}`);
    }
    
    if (!hypothesis) {
      return new Response('Hypothesis not found in message', { status: 404 });
    }
    
    // Use the correct hypothesis ID from the database
    const correctHypothesisId = hypothesis.id;

    // Create individual hypothesis record if it doesn't exist
    // Use the correct hypothesis ID from the database
    await upsertHypothesis({
      id: correctHypothesisId,
      messageId: message.id,  // Use the actual message ID from database
      title: hypothesis.title,
      description: hypothesis.description,
      orderIndex: hypothesisNumber,
    });

    // Save feedback with the correct hypothesis ID
    const feedback = await saveIndividualHypothesisFeedback({
      hypothesisId: correctHypothesisId,
      userId: session.user.id,
      rating,
      feedbackText: feedbackText || undefined,
      feedbackCategory: feedbackCategory || undefined,
    });

    // Get updated stats
    const stats = await getIndividualHypothesisFeedbackStats({ hypothesisId });

    return Response.json({
      feedback,
      stats,
    });
  } catch (error) {
    console.error('Failed to save hypothesis feedback:', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new Response('Internal Server Error', { status: 500 });
  }
}