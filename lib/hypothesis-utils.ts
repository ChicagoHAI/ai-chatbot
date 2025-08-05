export interface HypothesisData {
  id: string;
  title: string;
  description: string;
}

// Helper function to extract hypotheses from text content
export function extractHypothesesFromText(text: string, chatId: string, messageId: string): Array<HypothesisData> {
  console.log('[DEBUG] Extracting hypotheses from text, length:', text.length);
  console.log('[DEBUG] First 500 chars of text:', text.substring(0, 500));
  
  const hypothesesMatch = text.match(/<!-- HYPOTHESES_START -->([\s\S]*?)<!-- HYPOTHESES_END -->/);
  if (!hypothesesMatch) {
    console.log('[DEBUG] No HYPOTHESES_START/END markers found');
    return [];
  }
  
  const hypothesesText = hypothesesMatch[1];
  console.log('[DEBUG] Found hypotheses text:', hypothesesText.substring(0, 300));
  
  // Match individual hypotheses using regex
  const hypothesisRegex = /\*\*Hypothesis (\d+): ([^*]+)\*\*\n([\s\S]*?)(?=\n\*\*Hypothesis \d+:|$)/g;
  const hypotheses: Array<HypothesisData> = [];
  
  let match: RegExpExecArray | null = hypothesisRegex.exec(hypothesesText);
  while (match !== null) {
    const [, number, title, description] = match;
    const id = `hyp_${chatId}_${messageId}_${number}`;
    
    hypotheses.push({
      id,
      title: title.trim(),
      description: description.trim(),
    });
    
    console.log('[DEBUG] Extracted hypothesis:', { id, title: title.trim(), description: description.trim().substring(0, 100) });
    
    match = hypothesisRegex.exec(hypothesesText);
  }
  
  console.log('[DEBUG] Total hypotheses extracted:', hypotheses.length);
  return hypotheses;
}

// Helper function to get hypotheses from message parts
export function getHypothesesFromMessage(message: { id: string; parts: Array<{ type: string; text?: string }> }, chatId: string): Array<HypothesisData> {
  const textParts = message.parts.filter(part => part.type === 'text');
  for (const part of textParts) {
    if (part.text) {
      const hypotheses = extractHypothesesFromText(part.text, chatId, message.id);
      if (hypotheses.length > 0) {
        console.log('[DEBUG] Found hypotheses in text content:', hypotheses.length);
        return hypotheses;
      }
    }
  }
  return [];
}