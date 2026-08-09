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

const ANALYSIS_CACHE_TTL_MS = 30_000;

interface ScheduledAnalysisTask {
  readonly cancel: () => void;
}

function scheduleAnalysisTask(callback: () => void): ScheduledAnalysisTask {
  const idleApi = globalThis as typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { readonly timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleApi.requestIdleCallback && idleApi.cancelIdleCallback) {
    const handle = idleApi.requestIdleCallback(callback, { timeout: 250 });
    return { cancel: () => idleApi.cancelIdleCallback?.(handle) };
  }

  const handle = globalThis.setTimeout(callback, 0);
  return { cancel: () => globalThis.clearTimeout(handle) };
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
      // Keep a short-lived cache for quick tab switches, then release large
      // analysis graphs so leaving the organize view does not retain them.
      setState((current) =>
        current.status === 'idle' ? current : { status: 'idle' },
      );
      const evictionTimer = globalThis.setTimeout(() => {
        cacheRef.current = undefined;
      }, ANALYSIS_CACHE_TTL_MS);
      return () => globalThis.clearTimeout(evictionTimer);
    }

    const cached = cacheRef.current;
    if (cached?.revision === revision) {
      setState(cached.state);
      return;
    }

    cacheRef.current = undefined;

    setState({ status: 'analyzing' });
    const generation = ++generationRef.current;
    let similarityTask: ScheduledAnalysisTask | undefined;

    const publishError = (error: unknown) => {
      if (generationRef.current !== generation) {
        return;
      }
      const nextState = {
        status: 'error' as const,
        error: getErrorMessage(error),
      };
      cacheRef.current = { revision, state: nextState };
      setState(nextState);
    };

    const duplicateTask = scheduleAnalysisTask(() => {
      let duplicates: DuplicateAnalysis;
      try {
        duplicates = duplicateAnalyzer(records);
      } catch (error) {
        publishError(error);
        return;
      }
      if (generationRef.current !== generation) {
        return;
      }

      // Let the browser paint after the duplicate pass before running the
      // more allocation-heavy similarity pass.
      similarityTask = scheduleAnalysisTask(() => {
        try {
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
          publishError(error);
        }
      });
    });

    return () => {
      duplicateTask.cancel();
      similarityTask?.cancel();
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [duplicateAnalyzer, enabled, records, revision, similarityAnalyzer]);

  return state;
}
