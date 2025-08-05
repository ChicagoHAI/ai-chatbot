'use client';

import { useState, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from './ui/select';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from './ui/tooltip';
import { ChevronDownIcon, ChevronUpIcon } from './icons';
import { toast } from 'sonner';
import type { HypothesisFeedback as HypothesisFeedbackType } from '@/lib/db/schema';

interface Hypothesis {
  id: string;
  title: string;
  description: string;
}

interface HypothesisFeedbackProps {
  chatId: string;
  messageId: string;
  isHypothesisResponse?: boolean;
  hypotheses?: Hypothesis[];
}

export function HypothesisFeedback({ 
  chatId, 
  messageId, 
  isHypothesisResponse = false,
  hypotheses = []
}: HypothesisFeedbackProps) {
  
  // Debug logging to understand when this component renders
  console.log('[DEBUG] HypothesisFeedback rendering:', {
    messageId,
    isHypothesisResponse,
    hypothesesCount: hypotheses.length,
    hypotheses: hypotheses.map(h => ({ id: h.id, title: h.title }))
  });
  const [isExpanded, setIsExpanded] = useState(true); // Default to expanded
  const [overallRating, setOverallRating] = useState<'helpful' | 'not_helpful' | 'needs_improvement' | ''>('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackType, setFeedbackType] = useState<'quality' | 'novelty' | 'feasibility' | 'clarity' | 'other' | ''>('');
  const [hypothesisRatings, setHypothesisRatings] = useState<Record<string, 'helpful' | 'not_helpful' | 'needs_improvement'>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const { mutate } = useSWRConfig();

  // Fix hydration mismatch by only rendering after client-side mount
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch existing overall feedback for this message (graceful fallback)
  const { data: existingFeedback } = useSWR<HypothesisFeedbackType | null>(
    `/api/hypothesis-feedback?messageId=${messageId}`,
    async (url: string) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          // Gracefully handle non-existent feedback API endpoints
          if (response.status === 404) return null;
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.log('[INFO] Overall feedback API not available, using individual feedback only');
        return null;
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false, // Don't retry if the API doesn't exist
    }
  );

  // Don't show for non-hypothesis responses
  if (!isHypothesisResponse) {
    return null;
  }

  // Prevent hydration mismatch by not rendering until client-side
  if (!isClient) {
    return (
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>🔬 Loading hypotheses...</span>
        </div>
      </div>
    );
  }

  // Initialize form with existing feedback
  if (existingFeedback && overallRating === '') {
    setOverallRating(existingFeedback.rating);
    setFeedbackText(existingFeedback.feedbackText || '');
    setFeedbackType(existingFeedback.feedbackType || '');
    if (existingFeedback.hypothesisRatings) {
      setHypothesisRatings(existingFeedback.hypothesisRatings as Record<string, 'helpful' | 'not_helpful' | 'needs_improvement'>);
    }
  }

  const handleHypothesisRating = async (hypothesisId: string, rating: 'helpful' | 'not_helpful' | 'needs_improvement') => {
    // Update local state immediately for UI responsiveness
    setHypothesisRatings(prev => ({
      ...prev,
      [hypothesisId]: rating
    }));

    // Save individual hypothesis feedback to database
    try {
      const response = await fetch(`/api/hypothesis/${hypothesisId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rating,
          feedbackCategory: feedbackType || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save individual hypothesis feedback');
      }

      const result = await response.json();
      console.log('[DEBUG] Individual hypothesis feedback saved:', result);
      
      toast.success(`Feedback saved for hypothesis: ${rating}`);
    } catch (error) {
      console.error('[DEBUG] Failed to save individual hypothesis feedback:', error);
      toast.error('Failed to save hypothesis feedback');
      
      // Revert the local state on error
      setHypothesisRatings(prev => {
        const newState = { ...prev };
        delete newState[hypothesisId];
        return newState;
      });
    }
  };

  const handleSubmit = async () => {
    if (!overallRating) {
      toast.error('Please select an overall rating');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/hypothesis-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          messageId,
          rating: overallRating,
          feedbackText: feedbackText.trim() || undefined,
          feedbackType: feedbackType || undefined,
          hypothesisRatings: Object.keys(hypothesisRatings).length > 0 ? hypothesisRatings : undefined,
        }),
      });

      if (!response.ok) {
        // Gracefully handle case where overall feedback API doesn't exist
        if (response.status === 404) {
          toast.info('Overall feedback saved locally. Individual hypothesis ratings are still recorded.');
        } else {
          throw new Error('Failed to submit feedback');
        }
      } else {
        // Update cache only if the API exists
        mutate(`/api/hypothesis-feedback?messageId=${messageId}`);
        mutate(`/api/hypothesis-feedback?messageId=${messageId}&stats=true`);
        toast.success('Feedback submitted! Thank you for helping improve our hypotheses.');
      }
      
      setIsExpanded(false);
    } catch (error) {
      console.log('[INFO] Overall feedback API error:', error);
      toast.info('Individual hypothesis ratings saved. Overall feedback temporarily unavailable.');
      setIsExpanded(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // If we have structured hypotheses, show the enhanced UI
  if (hypotheses && hypotheses.length > 0) {
    return (
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>🔬 Hypothesis Feedback ({hypotheses.length})</span>
            {existingFeedback && (
              <span className="text-xs text-green-600">✓ Overall feedback given</span>
            )}
          </div>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-6 px-2"
                >
                  <span className="text-xs">
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </span>
                  {isExpanded ? (
                    <ChevronUpIcon size={12} />
                  ) : (
                    <ChevronDownIcon size={12} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isExpanded ? 'Collapse feedback section' : 'Expand to give detailed feedback'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Feedback Section - Collapsible by default expanded */}
        {isExpanded && (
          <div className="p-4 bg-muted/20 rounded-lg space-y-6">
            {/* Individual Hypotheses with Quick Ratings */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Rate each hypothesis:</h4>
              {hypotheses.map((hypothesis, index) => (
                <div key={hypothesis.id} className="border rounded-md p-3 bg-background">
                  <div className="mb-2">
                    <h5 className="text-sm font-medium">
                      {index + 1}. {hypothesis.title}
                    </h5>
                    <p className="text-xs text-muted-foreground mt-1">
                      {hypothesis.description}
                    </p>
                  </div>
                  
                  <div className="flex gap-1">
                    <Button
                      variant={hypothesisRatings[hypothesis.id] === 'helpful' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleHypothesisRating(hypothesis.id, 'helpful')}
                      className="text-xs h-7"
                    >
                      👍
                    </Button>
                    <Button
                      variant={hypothesisRatings[hypothesis.id] === 'needs_improvement' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleHypothesisRating(hypothesis.id, 'needs_improvement')}
                      className="text-xs h-7"
                    >
                      🤔
                    </Button>
                    <Button
                      variant={hypothesisRatings[hypothesis.id] === 'not_helpful' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleHypothesisRating(hypothesis.id, 'not_helpful')}
                      className="text-xs h-7"
                    >
                      👎
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Overall Assessment */}
            <div className="border-t pt-4">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium mb-2">
                    Overall hypothesis quality:
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={overallRating === 'helpful' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setOverallRating('helpful')}
                      className="text-xs"
                    >
                      👍 Helpful
                    </Button>
                    <Button
                      variant={overallRating === 'needs_improvement' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setOverallRating('needs_improvement')}
                      className="text-xs"
                    >
                      🤔 Needs Work
                    </Button>
                    <Button
                      variant={overallRating === 'not_helpful' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setOverallRating('not_helpful')}
                      className="text-xs"
                    >
                      👎 Not Helpful
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">
                    Feedback category (optional):
                  </div>
                  <Select value={feedbackType} onValueChange={(value: any) => setFeedbackType(value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select feedback category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quality">Overall Quality</SelectItem>
                      <SelectItem value="novelty">Novelty/Originality</SelectItem>
                      <SelectItem value="feasibility">Feasibility</SelectItem>
                      <SelectItem value="clarity">Clarity</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">
                    Additional comments (optional):
                  </div>
                  <Textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="What worked well? What could be improved? Any suggestions?"
                    className="text-sm"
                    rows={3}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExpanded(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={!overallRating || isSubmitting}
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback for old-style hypothesis responses (with reasoning steps but no structured hypotheses)
  return (
    <div className="border-t pt-3 mt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>🔬 Hypothesis Quality</span>
          {existingFeedback && (
            <span className="text-xs text-green-600">✓ Feedback given</span>
          )}
        </div>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-6 px-2"
              >
                <span className="text-xs">
                  {existingFeedback ? 'Update' : 'Give Feedback'}
                </span>
                {isExpanded ? (
                  <ChevronUpIcon size={12} />
                ) : (
                  <ChevronDownIcon size={12} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {existingFeedback ? 'Update your feedback' : 'Help us improve hypothesis quality'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isExpanded && (
        <div className="mt-3 p-3 bg-muted/20 rounded-md space-y-3">
          <div>
            <div className="text-sm font-medium mb-2">
              How helpful was this response?
            </div>
            <div className="flex gap-2">
              <Button
                variant={overallRating === 'helpful' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOverallRating('helpful')}
                className="text-xs"
              >
                👍 Helpful
              </Button>
              <Button
                variant={overallRating === 'needs_improvement' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOverallRating('needs_improvement')}
                className="text-xs"
              >
                🤔 Needs Work
              </Button>
              <Button
                variant={overallRating === 'not_helpful' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOverallRating('not_helpful')}
                className="text-xs"
              >
                👎 Not Helpful
              </Button>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">
              Additional comments (optional):
            </div>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What worked well? What could be improved?"
              className="text-sm"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!overallRating || isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}