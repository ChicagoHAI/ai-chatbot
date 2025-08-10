'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Search, MessageSquare } from 'lucide-react';

interface SemanticScholarToggleProps {
  isSemanticScholarMode: boolean;
  onToggle: (mode: boolean) => void;
}

export function SemanticScholarToggle({ isSemanticScholarMode, onToggle }: SemanticScholarToggleProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Button
        variant={!isSemanticScholarMode ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle(false)}
        className="flex items-center gap-2"
      >
        <MessageSquare className="h-4 w-4" />
        Regular Chat
      </Button>
      <Button
        variant={isSemanticScholarMode ? "default" : "outline"}
        size="sm"
        onClick={() => onToggle(true)}
        className="flex items-center gap-2"
      >
        <Search className="h-4 w-4" />
        Semantic Scholar
      </Button>
    </div>
  );
}
