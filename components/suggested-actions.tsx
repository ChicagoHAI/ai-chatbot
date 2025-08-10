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
}

function PureSuggestedActions({
  chatId,
  sendMessage,
  selectedVisibilityType,
  isSemanticScholarMode = false,
}: SuggestedActionsProps) {
  console.log('[SuggestedActions] isSemanticScholarMode:', isSemanticScholarMode);
  
  const regularChatActions = [
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

  const suggestedActions = isSemanticScholarMode ? semanticScholarActions : regularChatActions;
  console.log('[SuggestedActions] Using actions:', suggestedActions.map(a => a.action));

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
            className="text-left border rounded-xl px-4 py-3.5 text-sm flex-1 gap-1 sm:flex-col w-full h-auto justify-start items-start"
          >
            <span className="font-medium">{suggestedAction.title}</span>
            <span className="text-muted-foreground">
              {suggestedAction.label}
            </span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) return false;
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
      return false;
    if (prevProps.isSemanticScholarMode !== nextProps.isSemanticScholarMode)
      return false;

    return true;
  },
);
