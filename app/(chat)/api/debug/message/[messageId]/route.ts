import { auth } from '@/app/(auth)/auth';
import { getMessageById } from '@/lib/db/queries';
import { unauthorized } from '@/lib/errors';

// Helper function to extract hypotheses from text content (same as frontend)
function extractHypothesesFromText(text: string): Array<{id: string, title: string, description: string}> {
  console.log('[DEBUG API] Extracting hypotheses from text, length:', text.length);
  console.log('[DEBUG API] First 500 chars of text:', text.substring(0, 500));
  
  const hypothesesMatch = text.match(/<!-- HYPOTHESES_START -->([\s\S]*?)<!-- HYPOTHESES_END -->/);
  if (!hypothesesMatch) {
    console.log('[DEBUG API] No HYPOTHESES_START/END markers found');
    return [];
  }
  
  const hypothesesText = hypothesesMatch[1];
  console.log('[DEBUG API] Extracted hypotheses text:', hypothesesText.substring(0, 300) + '...');
  
  const hypotheses: Array<{id: string, title: string, description: string}> = [];
  
  // Parse each hypothesis using regex - match the actual format from backend
  const hypothesisPattern = /\*\*Hypothesis (\d+):\s*([^*]+?)\*\*\s*\n([^*]+?)(?=\n\*\*Hypothesis|$)/gs;
  let match;
  
  while ((match = hypothesisPattern.exec(hypothesesText)) !== null) {
    const [, num, title, description] = match;
    console.log(`[DEBUG API] Found hypothesis ${num}:`, { title: title.trim(), description: description.trim().substring(0, 50) + '...' });
    hypotheses.push({
      id: `hyp_${num}`,
      title: title.trim(),
      description: description.trim()
    });
  }
  
  console.log('[DEBUG API] Total hypotheses extracted:', hypotheses.length);
  return hypotheses;
}

// GET /api/debug/message/[messageId] - Debug hypothesis extraction
export async function GET(
  request: Request,
  { params }: { params: { messageId: string } }
) {
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    return unauthorized();
  }

  const { messageId } = params;

  try {
    // This would need a getMessageById function - let me create a simple version
    // For now, let's use a direct database query
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = await import('postgres');
    const { message } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    
    // biome-ignore lint: Forbidden non-null assertion.
    const client = postgres(process.env.POSTGRES_URL!);
    const db = drizzle(client);

    const messages = await db
      .select()
      .from(message)
      .where(eq(message.id, messageId))
      .limit(1);

    if (messages.length === 0) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    const messageData = messages[0];
    const parts = messageData.parts as any[];
    
    let allText = '';
    let textParts = [];
    
    for (const part of parts) {
      if (part.type === 'text' && part.text) {
        allText += part.text;
        textParts.push({
          text: part.text.substring(0, 200) + '...',
          hasMarkers: part.text.includes('<!-- HYPOTHESES_START -->')
        });
      }
    }

    const hypotheses = extractHypothesesFromText(allText);

    return Response.json({
      messageId,
      messageRole: messageData.role,
      totalTextLength: allText.length,
      textParts,
      hypothesesFound: hypotheses.length,
      hypotheses,
      debugInfo: {
        hasStartMarker: allText.includes('<!-- HYPOTHESES_START -->'),
        hasEndMarker: allText.includes('<!-- HYPOTHESES_END -->'),
        markerSection: allText.match(/<!-- HYPOTHESES_START -->([\s\S]*?)<!-- HYPOTHESES_END -->/)?.[1]?.substring(0, 200) + '...'
      }
    });
  } catch (error) {
    console.error('Failed to debug message:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}