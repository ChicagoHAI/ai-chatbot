'use client';

import { motion } from 'framer-motion';
import { Button } from './ui/button';
import { memo } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { VisibilityType } from './visibility-selector';
import type { ChatMessage } from '@/lib/types';

interface SuggestedActionsProps {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  selectedVisibilityType: VisibilityType;
  isSemanticScholarMode?: boolean;
  isRegularPlusSemanticMode?: boolean;
}

function PureSuggestedActions({
  chatId,
  sendMessage,
  selectedVisibilityType,
  isSemanticScholarMode = false,
  isRegularPlusSemanticMode = false,
}: SuggestedActionsProps) {
  console.log('[SuggestedActions] Mode:', 
    isRegularPlusSemanticMode ? 'Regular + Semantic' : 
    isSemanticScholarMode ? 'Semantic Scholar' : 'Regular Chat'
  );
  
  const vectorDatabaseActions = [
    {
      title: 'Generate hypotheses about',
      label: 'machine learning interpretability',
      action: 'Generate testable hypotheses about improving machine learning model interpretability',
    },
    {
      title: 'What novel approaches could',
      label: 'address climate change?',
      action: 'What novel approaches could address climate change based on recent research?',
    },
    {
      title: 'Suggest hypotheses for',
      label: 'quantum computing applications',
      action: 'Suggest testable hypotheses for practical quantum computing applications',
    },
    {
      title: 'Generate research ideas about',
      label: 'neural network efficiency',
      action: 'Generate research ideas about improving neural network training efficiency',
    },
  ];

  const semanticScholarActions = [
    {
      title: 'Search for papers about',
      label: 'artificial intelligence ethics',
      action: 'artificial intelligence ethics',
    },
    {
      title: 'Find research on',
      label: 'machine learning bias',
      action: 'machine learning bias',
    },
    {
      title: 'Look up papers about',
      label: 'deep learning interpretability',
      action: 'deep learning interpretability',
    },
    {
      title: 'Search for studies on',
      label: 'neural network robustness',
      action: 'neural network robustness',
    },
  ];

  const regularPlusSemanticActions = [
    {
      title: 'Generate hypothesis about',
      label: 'AI ethics',
      action: 'Generate hypothesis about AI ethics',
    },
    {
      title: 'What\'s the weather like',
      label: 'today?',
      action: 'What\'s the weather like today?',
    },
    {
      title: 'Tell me a joke',
      label: '',
      action: 'Tell me a joke',
    },
    {
      title: 'Explain quantum computing',
      label: 'in simple terms',
      action: 'Explain quantum computing in simple terms',
    },
  ];

  // Use different actions based on mode
  let suggestedActions;
  if (isRegularPlusSemanticMode) {
    suggestedActions = regularPlusSemanticActions;
  } else if (isSemanticScholarMode) {
    suggestedActions = semanticScholarActions;
  } else {
    suggestedActions = vectorDatabaseActions;
  }
  
  console.log('[SuggestedActions] Using', 
    isRegularPlusSemanticMode ? 'Regular + Semantic' : 
    isSemanticScholarMode ? 'Semantic Scholar' : 'Vector Database', 
    'actions'
  );

  return (
    <div
      data-testid="suggested-actions"
      className="grid sm:grid-cols-2 gap-2 w-full"
    >
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className={index > 1 ? 'hidden sm:block' : 'block'}
        >
          <Button
            variant="ghost"
            onClick={async () => {
              console.log('[SuggestedActions] Button clicked:', suggestedAction.action);
              window.history.replaceState({}, '', `/chat/${chatId}`);

              sendMessage({
                role: 'user',
                parts: [{ type: 'text', text: suggestedAction.action }],
              });
            }}
            className="h-auto p-3 text-left"
          >
            <div className="flex flex-col gap-1">
              <div className="font-medium text-sm">
                {suggestedAction.title}
              </div>
              <div className="text-xs text-muted-foreground">
                {suggestedAction.label}
              </div>
            </div>
          </Button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(PureSuggestedActions);
