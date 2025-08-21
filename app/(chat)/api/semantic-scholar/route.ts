import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import { postRequestBodySchema, type PostRequestBody } from '../chat/schema';
import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { generateUUID, getTextFromMessage } from '@/lib/utils';

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

  formatPapersForDisplay(papers: any[]) {
    if (!papers.length) {
      return "No relevant papers found.";
    }

    let displayText = "**📚 Retrieved Papers from Semantic Scholar:**\n\n";
    
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      const authors = paper.authors?.map((a: any) => a.name).join(", ") || "Unknown";
      let abstract = paper.abstract || 'No abstract available';
      if (abstract && abstract.length > 300) {
        abstract = abstract.substring(0, 300) + "...";
      }
      
      displayText += `**${i + 1}. ${paper.title || 'No title'}**\n`;
      displayText += `   **Authors:** ${authors}\n`;
      displayText += `   **Year:** ${paper.year || 'Unknown'}\n`;
      displayText += `   **Venue:** ${paper.venue || 'Unknown'}\n`;
      displayText += `   **Citations:** ${paper.citationCount || 0}\n`;
      displayText += `   **Abstract:** ${abstract}\n\n`;
    }
    
    return displayText;
  }

  formatPapersForContext(papers: any[]) {
    if (!papers.length) {
      return "No relevant papers found.";
    }

    let context = "## Retrieved Papers from Semantic Scholar:\n\n";
    
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      const authors = paper.authors?.map((a: any) => a.name).join(", ") || "Unknown";
      let abstract = paper.abstract || 'No abstract available';
      if (abstract && abstract.length > 300) {
        abstract = abstract.substring(0, 300) + "...";
      }
      
      context += `### Paper ${i + 1}: ${paper.title || 'No title'}\n`;
      context += `**Authors:** ${authors}\n`;
      context += `**Year:** ${paper.year || 'Unknown'}\n`;
      context += `**Venue:** ${paper.venue || 'Unknown'}\n`;
      context += `**Citations:** ${paper.citationCount || 0}\n`;
      context += `**Abstract:** ${abstract}\n\n`;
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

    // Initialize service and search for papers
    const ssService = new SemanticScholarService(apiKey);
    const papers = await ssService.searchPapers(textPart.text, 5);
    const papersDisplay = ssService.formatPapersForDisplay(papers);
    const papersContext = ssService.formatPapersForContext(papers);

    console.log('[SEMANTIC-SCHOLAR] Found papers:', papers.length);
    console.log('[SEMANTIC-SCHOLAR] Using papers as context for hypothesis generation');

    // Create AI SDK UI message stream that transforms backend data
    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        // Create a readable stream that transforms the backend response
        const backendStream = new ReadableStream({
          async start(controller) {
            try {
              const backendBaseUrl = process.env.BACKEND_URL ?? 'http://localhost:8080';
              const backendEndpoint = new URL('/api/chat/', backendBaseUrl).toString();

              // Create enhanced query that includes the papers context
              const enhancedQuery = `Based on the following research papers from Semantic Scholar, generate hypotheses about: ${textPart.text}

${papersContext}

Please analyze these papers and generate multiple competing hypotheses that address the research question.`;

              const backendPayload = {
                user_id: session.user.id,
                message: enhancedQuery,
                conversation_id: null,
                stream: true,
                system_prompt: null,
                temperature: 0.7,
                max_tokens: 8000,
                show_context: false,
                multifaceted: true,
                top_k_per_facet: 3,
                min_facets: 3,
                max_facets: 6,
              };

              console.log('[SEMANTIC-SCHOLAR] Calling backend hypothesis generation with papers context');

              const ragResponse = await fetch(backendEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(backendPayload),
              });

              if (!ragResponse.ok || !ragResponse.body) {
                controller.error(new Error(`Backend error (${ragResponse.status})`));
                return;
              }

              const decoder = new TextDecoder();
              const reader = ragResponse.body.getReader();
              
              const textBlockId = generateUUID();
              let buffer = '';
              let textBlockStarted = false;
              let papersDisplayed = false;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';

                for (const part of parts) {
                  if (!part.startsWith('data: ')) continue;
                  const payload = part.slice(6);
                  
                  // Handle completion signal
                  if (payload.trim() === '[DONE]') {
                    if (textBlockStarted) {
                      controller.enqueue({ type: 'text-end', id: textBlockId });
                    }
                    controller.enqueue({ type: 'finish' });
                    controller.close();
                    return;
                  }
                  
                  if (!payload.trim().startsWith('{')) continue;
                  
                  try {
                    const json = JSON.parse(payload);
                    
                    switch (json.type) {
                      case 'reasoning-start':
                        controller.enqueue({ 
                          type: 'reasoning-start', 
                          id: json.id 
                        });
                        break;
                        
                      case 'reasoning-delta':
                        controller.enqueue({ 
                          type: 'reasoning-delta', 
                          id: json.id, 
                          delta: json.delta 
                        });
                        break;
                        
                      case 'reasoning-end':
                        controller.enqueue({ 
                          type: 'reasoning-end', 
                          id: json.id 
                        });
                        break;
                        
                      case 'text-start':
                        if (!textBlockStarted) {
                          textBlockStarted = true;
                          controller.enqueue({ type: 'text-start', id: textBlockId });
                          
                          // Insert papers display at the beginning of the response
                          if (!papersDisplayed) {
                            const papersWords = papersDisplay.split(' ');
                            for (const word of papersWords) {
                              controller.enqueue({ 
                                type: 'text-delta', 
                                id: textBlockId, 
                                delta: word + ' ' 
                              });
                            }
                            papersDisplayed = true;
                          }
                        }
                        break;
                        
                      case 'text-delta':
                        if (!textBlockStarted) {
                          textBlockStarted = true;
                          controller.enqueue({ type: 'text-start', id: textBlockId });
                          
                          // Insert papers display at the beginning of the response
                          if (!papersDisplayed) {
                            const papersWords = papersDisplay.split(' ');
                            for (const word of papersWords) {
                              controller.enqueue({ 
                                type: 'text-delta', 
                                id: textBlockId, 
                                delta: word + ' ' 
                              });
                            }
                            papersDisplayed = true;
                          }
                        }
                        if (typeof json.delta === 'string') {
                          controller.enqueue({ 
                            type: 'text-delta', 
                            id: textBlockId, 
                            delta: json.delta 
                          });
                        }
                        break;
                        
                      case 'text-end':
                        if (textBlockStarted) {
                          controller.enqueue({ type: 'text-end', id: textBlockId });
                          textBlockStarted = false;
                        }
                        break;
                        
                      case 'finish':
                        // Backend finish signal - just pass through
                        // Real completion happens with [DONE] signal
                        controller.enqueue({ type: 'finish' });
                        break;
                    }
                  } catch (e) {
                    console.warn('Failed to parse backend stream JSON:', payload);
                  }
                }
              }
            } catch (error) {
              console.error('Backend stream error:', error);
              controller.error(error);
            }
          }
        });

        // Use merge like the original - let AI SDK manage the stream lifecycle
        dataStream.merge(backendStream);
      },
      generateId: generateUUID,
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()), {
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
