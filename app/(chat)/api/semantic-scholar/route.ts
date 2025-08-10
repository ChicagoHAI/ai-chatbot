import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import { postRequestBodySchema, type PostRequestBody } from '../chat/schema';

export const maxDuration = 60;

// Direct Semantic Scholar API integration
class SemanticScholarService {
  private apiKey: string;
  private baseUrl = "https://api.semanticscholar.org/graph/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchPapers(query: string, limit: number = 5) {
    const url = `${this.baseUrl}/paper/search`;
    const params = new URLSearchParams({
      query: query,
      limit: limit.toString(),
      fields: "title,abstract,authors,year,venue,url,paperId,citationCount,influentialCitationCount"
    });

    const response = await fetch(`${url}?${params}`, {
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  }

  formatPapers(papers: any[]) {
    if (!papers.length) {
      return "No relevant papers found.";
    }

    let context = "## Retrieved Papers\n\n";
    
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      const authors = paper.authors?.map((a: any) => a.name).join(", ") || "Unknown";
      
      context += `### Paper ${i + 1}: ${paper.title || 'No title'}\n`;
      context += `**Authors:** ${authors}\n`;
      context += `**Year:** ${paper.year || 'Unknown'}\n`;
      context += `**Venue:** ${paper.venue || 'Unknown'}\n`;
      context += `**Citations:** ${paper.citationCount || 0}\n`;
      context += `**Abstract:** ${paper.abstract || 'No abstract available'}\n\n`;
    }
    
    return context;
  }
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    console.log('[SEMANTIC-SCHOLAR] Received request body:', JSON.stringify(json, null, 2));
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    console.error('[SEMANTIC-SCHOLAR] Request parsing error:', error);
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
      message: any;
      selectedChatModel: string;
      selectedVisibilityType: string;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    // Extract the text from the message parts
    const textPart = message.parts.find((part: any) => part.type === 'text');
    if (!textPart) {
      return new ChatSDKError('bad_request:api', 'No text message found').toResponse();
    }

    // Get API key from environment
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (!apiKey) {
      throw new Error('Semantic Scholar API key not configured');
    }

    // Initialize service and search
    const ssService = new SemanticScholarService(apiKey);
    const papers = await ssService.searchPapers(textPart.text, 5);
    const context = ssService.formatPapers(papers);

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // Send start step
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'start-step'})}\n\n`));
        
        // Send reasoning start
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'reasoning-start', id: 'reasoning_retrieval'})}\n\n`));
        
        // Send retrieval results
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'reasoning-delta', id: 'reasoning_retrieval', delta: 'Retrieving papers from Semantic Scholar...'})}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'reasoning-delta', id: 'reasoning_retrieval', delta: `Found ${papers.length} papers for query: ${textPart.text}`})}\n\n`));
        
        // Send context
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'reasoning-delta', id: 'reasoning_retrieval', delta: context})}\n\n`));
        
        // Send reasoning end
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'reasoning-end', id: 'reasoning_retrieval'})}\n\n`));
        
        // Send finish step
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'finish-step'})}\n\n`));
        
        // Send start of response
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'start', messageId: 'msg_semantic_scholar'})}\n\n`));
        
        // Generate response text
        let responseText = `Based on the ${papers.length} papers retrieved from Semantic Scholar for the query '${textPart.text}', here are some potential hypotheses:\n\n`;
        
        if (papers.length > 0) {
          responseText += "**📚 Retrieved Papers from Semantic Scholar:**\n\n";
          
          for (let i = 0; i < papers.length; i++) {
            const paper = papers[i];
            const authors = paper.authors?.map((a: any) => a.name).join(", ") || "Unknown";
            let abstract = paper.abstract || 'No abstract available';
            if (abstract && abstract.length > 300) {
              abstract = abstract.substring(0, 300) + "...";
            }
            
            responseText += `**${i + 1}. ${paper.title || 'No title'}**\n`;
            responseText += `   **Authors:** ${authors}\n`;
            responseText += `   **Year:** ${paper.year || 'Unknown'}\n`;
            responseText += `   **Venue:** ${paper.venue || 'Unknown'}\n`;
            responseText += `   **Citations:** ${paper.citationCount || 0}\n`;
            responseText += `   **Abstract:** ${abstract}\n\n`;
          }
          
          responseText += "**🔬 Generated Hypotheses Based on Literature:**\n\n";
          responseText += "1. **Hypothesis 1:** The findings suggest that [specific pattern/relationship] based on the literature review.\n\n";
          responseText += "2. **Hypothesis 2:** There may be a correlation between [factor A] and [factor B] as indicated by recent studies.\n\n";
          responseText += "3. **Hypothesis 3:** The literature points to potential gaps in understanding [specific area] that warrant further investigation.\n\n";
        } else {
          responseText += "No relevant papers were found for this query. Consider:\n";
          responseText += "- Broadening your search terms\n";
          responseText += "- Using different keywords\n";
          responseText += "- Checking spelling and terminology\n\n";
        }
        
        // Send response as text deltas
        const words = responseText.split(' ');
        for (const word of words) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'text-delta', id: 'block_msg_semantic_scholar', delta: word + ' '})}\n\n`));
        }
        
        // Send text end
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'text-end', id: 'block_msg_semantic_scholar'})}\n\n`));
        
        // Send finish
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'finish'})}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'finish-step'})}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'x-vercel-ai-data-stream': 'v1',
      },
    });

  } catch (error) {
    console.error('Semantic Scholar API error:', error);
    return new ChatSDKError('internal_error').toResponse();
  }
}
