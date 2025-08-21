"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

interface GenerateHypothesesButtonProps {
  query: string;
  papers: any[];
  userId: string;
  conversationId?: string;
  onHypothesisGenerated?: (hypothesis: string) => void;
  setMessages?: any; // Add this to update the chat
}

export function GenerateHypothesesButton({
  query,
  papers,
  userId,
  conversationId,
  onHypothesisGenerated,
  setMessages,
}: GenerateHypothesesButtonProps) {
  console.log('[DEBUG] GenerateHypothesesButton component rendered with props:', { query, papersCount: papers?.length, userId, conversationId });
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateHypotheses = async () => {
    console.log('[DEBUG] handleGenerateHypotheses called');
    console.log('[DEBUG] Query:', query);
    console.log('[DEBUG] Papers count:', papers.length);
    console.log('[DEBUG] User ID:', userId);
    
    setIsGenerating(true);

    try {
      // Call the hypothesis generation endpoint
      const requestBody = {
        query,
        papers: papers || [], // Send empty array if no papers
        userId,
        conversationId,
      };
      
      console.log('[DEBUG] Sending request to backend:', requestBody);
      
      const response = await fetch("/api/semantic-scholar", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[DEBUG] Backend response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DEBUG] Backend error response:', errorText);
        throw new Error(`Backend responded with status: ${response.status} - ${errorText}`);
      }

      // Read the entire response as text
      const responseText = await response.text();
      console.log('[DEBUG] Full response text length:', responseText.length);
      console.log('[DEBUG] Response preview:', responseText.substring(0, 500));

      // Parse the streaming response manually
      let result = "";
      let reasoningContent = "";
      
      console.log('[DEBUG] Response is', responseText.length, 'characters long');
      
      // The response contains concatenated JSON objects without line breaks
      // We need to extract each JSON object from the string
      let currentPos = 0;
      let objectCount = 0;
      
      while (currentPos < responseText.length) {
        // Find the start of the next JSON object
        const braceIndex = responseText.indexOf('{', currentPos);
        if (braceIndex === -1) break;
        
        // Find the matching closing brace
        let braceCount = 0;
        let endPos = braceIndex;
        
        for (let i = braceIndex; i < responseText.length; i++) {
          if (responseText[i] === '{') braceCount++;
          if (responseText[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
        
        if (braceCount === 0) {
          const jsonStr = responseText.substring(braceIndex, endPos);
          objectCount++;
          
          if (objectCount <= 5) {
            console.log('[DEBUG] Object', objectCount, ':', jsonStr.substring(0, 100));
          }
          
          try {
            const json = JSON.parse(jsonStr);
            if (json.type === 'text-delta' && json.delta) {
              result += json.delta;
              console.log('[DEBUG] Added text-delta:', json.delta.substring(0, 50));
            } else if (json.type === 'reasoning-delta' && json.delta) {
              reasoningContent += json.delta;
              console.log('[DEBUG] Added reasoning-delta:', json.delta.substring(0, 50));
            }
          } catch (e) {
            console.log('[DEBUG] Failed to parse JSON object:', e.message);
          }
          
          currentPos = endPos;
        } else {
          // Incomplete JSON object, skip to next
          currentPos = braceIndex + 1;
        }
      }
      
      console.log('[DEBUG] Processed', objectCount, 'JSON objects');

      console.log('[DEBUG] Final result length:', result.length);
      console.log('[DEBUG] Final reasoning length:', reasoningContent.length);
      console.log('[DEBUG] Final result:', result);
      console.log('[DEBUG] Final reasoning:', reasoningContent);

      setIsGenerating(false);
      
      // Combine reasoning and hypothesis content
      const fullContent = reasoningContent + "\n\n" + result;
      console.log('[DEBUG] Full content:', fullContent);
      
      // Add the hypothesis result to the chat
      if (setMessages) {
        const newMessage = {
          id: `hypothesis-${Date.now()}`,
          role: 'assistant' as const,
          content: `## Generated Hypotheses for: ${query}\n\n${fullContent}`,
          parts: [
            {
              type: 'text' as const,
              text: `## Generated Hypotheses for: ${query}\n\n${fullContent}`
            }
          ]
        };
        
        console.log('[DEBUG] Adding new message:', newMessage);
        setMessages((prevMessages: any[]) => [...prevMessages, newMessage]);
      }
      
      if (onHypothesisGenerated) {
        onHypothesisGenerated(fullContent);
      }

      console.log('Hypothesis generation completed successfully!');

    } catch (error) {
      console.error("Error generating hypotheses:", error);
      setIsGenerating(false);
      alert("Failed to generate hypotheses. Please try again.");
    }
  };

  console.log('[DEBUG] Button render state:', { isGenerating, papersLength: papers?.length });
  
  return (
    <div className="mt-4 p-4 border rounded-lg bg-muted/50">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h4 className="font-medium text-sm">Generate Hypotheses</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Use the full hypothesis generation pipeline to analyze the research papers
            {papers.length > 0 && ` (${papers.length} papers found)`}
          </p>
        </div>
        <Button
          onClick={() => {
            console.log('[DEBUG] Button clicked!');
            handleGenerateHypotheses();
          }}
          disabled={isGenerating}
          size="sm"
          className="ml-4"
        >
          {isGenerating ? "Generating..." : "Generate Hypotheses"}
        </Button>
      </div>
    </div>
  );
}
