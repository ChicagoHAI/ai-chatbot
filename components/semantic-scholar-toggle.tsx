'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Search, MessageSquare, Zap } from 'lucide-react';

interface SemanticScholarToggleProps {
  isSemanticScholarMode: boolean;
  isRegularPlusSemanticMode: boolean;
  onToggle: (mode: 'regular' | 'semantic' | 'regular-plus-semantic') => void;
}

export function SemanticScholarToggle({ 
  isSemanticScholarMode, 
  isRegularPlusSemanticMode, 
  onToggle 
}: SemanticScholarToggleProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Button
        variant={!isSemanticScholarMode && !isRegularPlusSemanticMode ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle('regular')}
        className="flex items-center gap-2"
      >
        <MessageSquare className="h-4 w-4" />
        Regular Chat
      </Button>
      <Button
        variant={isSemanticScholarMode ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle('semantic')}
        className="flex items-center gap-2"
      >
        <Search className="h-4 w-4" />
        Semantic Scholar
      </Button>
      <Button
        variant={isRegularPlusSemanticMode ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle('regular-plus-semantic')}
        className="flex items-center gap-2"
      >
        <Zap className="h-4 w-4" />
        Regular + Semantic
      </Button>
    </div>
  );
}
