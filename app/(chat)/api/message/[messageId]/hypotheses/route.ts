import { auth } from '@/app/(auth)/auth';
import { getHypothesesByMessageId, saveHypotheses } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

// GET /api/message/[messageId]/hypotheses
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  const { messageId } = await params;

  try {
    const hypotheses = await getHypothesesByMessageId({ messageId });

    if (hypotheses.length === 0) {
      return Response.json({ hypotheses: [] });
    }

    return Response.json({ hypotheses });
  } catch (error) {
    console.error('Failed to get hypotheses:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// POST /api/message/[messageId]/hypotheses
export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:api').toResponse();
  }

  const { messageId } = await params;

  try {
    const body = await request.json();
    const { hypotheses } = body;

    if (!Array.isArray(hypotheses)) {
      return new Response('Invalid hypotheses data', { status: 400 });
    }

    // Validate hypothesis structure
    for (const hyp of hypotheses) {
      if (!hyp.id || !hyp.title || !hyp.description || typeof hyp.orderIndex !== 'number') {
        return new Response('Invalid hypothesis structure', { status: 400 });
      }
    }

    const savedHypotheses = await saveHypotheses({ messageId, hypotheses });

    return Response.json({ hypotheses: savedHypotheses });
  } catch (error) {
    console.error('Failed to save hypotheses:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}