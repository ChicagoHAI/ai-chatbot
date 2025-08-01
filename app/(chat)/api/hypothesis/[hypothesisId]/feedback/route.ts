import { auth } from '@/app/(auth)/auth';
import {
  saveIndividualHypothesisFeedback,
  getIndividualHypothesisFeedback,
  getIndividualHypothesisFeedbackStats,
} from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

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

    // Save feedback
    const feedback = await saveIndividualHypothesisFeedback({
      hypothesisId,
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
    return new Response('Internal Server Error', { status: 500 });
  }
}