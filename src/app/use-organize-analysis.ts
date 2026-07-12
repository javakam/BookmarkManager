import { useEffect, useRef, useState } from 'react';

import {
  analyzeDuplicates,
  type DuplicateAnalysis,
  type MirrorFolderSuggestion,
} from '../domain/duplicate-analyzer';
import type { BookmarkRecord } from '../domain/bookmarks';
import {
  analyzeSimilarBookmarks,
  type SimilarityAnalysis,
} from '../domain/similarity-analyzer';

export interface OrganizeAnalysis {
  readonly duplicates: DuplicateAnalysis;
  readonly similar: SimilarityAnalysis;
  readonly mirrorFolders: {
    readonly suggestions: readonly MirrorFolderSuggestion[];
    readonly truncated: boolean;
  };
}

export interface OrganizeAnalyzers {
  readonly duplicateAnalyzer: typeof analyzeDuplicates;
  readonly similarityAnalyzer: typeof analyzeSimilarBookmarks;
}

export type OrganizeAnalysisState =
  | { readonly status: 'idle' | 'analyzing' }
  | { readonly status: 'ready'; readonly analysis: OrganizeAnalysis }
  | { readonly status: 'error'; readonly error: string };

const DEFAULT_ANALYZERS: OrganizeAnalyzers = {
  duplicateAnalyzer: analyzeDuplicates,
  similarityAnalyzer: analyzeSimilarBookmarks,
};

interface CachedAnalysis {
  readonly revision: number;
  readonly state: Extract<OrganizeAnalysisState, { status: 'ready' | 'error' }>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '整理分析失败';
}

export function useOrganizeAnalysis(
  records: readonly BookmarkRecord[],
  revision: number,
  enabled: boolean,
  analyzers: OrganizeAnalyzers = DEFAULT_ANALYZERS,
): OrganizeAnalysisState {
  const [state, setState] = useState<OrganizeAnalysisState>({ status: 'idle' });
  const cacheRef = useRef<CachedAnalysis | undefined>(undefined);
  const generationRef = useRef(0);
  const { duplicateAnalyzer, similarityAnalyzer } = analyzers;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const cached = cacheRef.current;
    if (cached?.revision === revision) {
      setState(cached.state);
      return;
    }

    setState({ status: 'analyzing' });
    const generation = ++generationRef.current;
    const timer = setTimeout(() => {
      try {
        const duplicates = duplicateAnalyzer(records);
        const analysis: OrganizeAnalysis = {
          duplicates,
          similar: similarityAnalyzer(records),
          mirrorFolders: {
            suggestions: duplicates.mirrorFolders,
            truncated: duplicates.mirrorTruncated,
          },
        };
        if (generationRef.current !== generation) {
          return;
        }
        const nextState = { status: 'ready' as const, analysis };
        cacheRef.current = { revision, state: nextState };
        setState(nextState);
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        const nextState = {
          status: 'error' as const,
          error: getErrorMessage(error),
        };
        cacheRef.current = { revision, state: nextState };
        setState(nextState);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [duplicateAnalyzer, enabled, records, revision, similarityAnalyzer]);

  return state;
}
