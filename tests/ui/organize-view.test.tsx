// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeDuplicates } from '../../src/domain/duplicate-analyzer';
import type {
  DuplicateAnalysis,
  DuplicateGroup,
  MirrorFolderSuggestion,
} from '../../src/domain/duplicate-analyzer';
import { analyzeSimilarBookmarks } from '../../src/domain/similarity-analyzer';
import type {
  SimilarityAnalysis,
  SimilarityPair,
  TitleConflictGroup,
} from '../../src/domain/similarity-analyzer';
import type {
  BookmarkRecord,
  BrowserBookmarkNode,
} from '../../src/domain/bookmarks';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';
import {
  useOrganizeAnalysis,
  type OrganizeAnalyzers,
} from '../../src/app/use-organize-analysis';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import { OrganizeView } from '../../src/ui/manager/OrganizeView';

afterEach(cleanup);

function organizeTree(extraTitle = ''): BrowserBookmarkNode[] {
  const mirrorLeaves = (parentId: string) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${parentId}-mirror-${index}`,
      parentId,
      index: index + 2,
      title: `镜像 ${index}`,
      url: `https://mirror.example.test/${index}`,
    }));
  const folder = (
    id: string,
    title: string,
    exactId: string,
  ): BrowserBookmarkNode => ({
    id,
    parentId: id === 'folder-a' ? 'bar' : id === 'folder-b' ? 'other' : 'mobile',
    title,
    children: [
      {
        id: exactId,
        parentId: id,
        index: 0,
        title: `Shared Copy${extraTitle}`,
        url: 'https://same.example.test/full/path?keep=1#section',
      },
      ...mirrorLeaves(id),
    ],
  });

  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: [
            folder('folder-a', 'Folder A', 'copy-a'),
            {
              id: 'conflict-a',
              parentId: 'bar',
              title: 'Project Dashboard',
              url: 'https://one.example.test/a',
            },
          ],
        },
        {
          id: 'other',
          parentId: 'root',
          index: 1,
          title: '其他书签',
          folderType: 'other',
          children: [
            folder('folder-b', 'Folder B', 'copy-b'),
            {
              id: 'conflict-b',
              parentId: 'other',
              title: 'Project Dashboard',
              url: 'https://two.example.test/b',
            },
          ],
        },
        {
          id: 'mobile',
          parentId: 'root',
          index: 2,
          title: '移动书签',
          folderType: 'mobile',
          children: [
            folder('folder-c', 'Folder C', 'copy-c'),
            {
              id: 'conflict-c',
              parentId: 'mobile',
              title: 'Project Dashboard',
              url: 'https://three.example.test/c',
            },
          ],
        },
      ],
    },
  ];
}

function repositoryStub(
  getTree: BookmarkRepository['getTree'],
): BookmarkRepository & { emitChanged: () => void } {
  let listener:
    | ((change: BookmarkRepositoryChange) => void)
    | undefined;
  return {
    getTree,
    createBookmark: vi.fn(),
    createFolder: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    onChanged(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    emitChanged() {
      listener?.('changed');
    },
  };
}

function bookmark(id: string, title = id): BookmarkRecord {
  return {
    id,
    parentId: 'folder',
    index: 0,
    title,
    url: `https://example.test/${id}`,
    path: ['书签栏', 'Folder'],
    depth: 2,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

function folder(id: string): BookmarkRecord {
  return {
    ...bookmark(id, `Folder ${id}`),
    parentId: 'root',
    url: undefined,
    path: ['书签栏'],
    depth: 1,
    isFolder: true,
  };
}

const emptyDuplicates: DuplicateAnalysis = {
  groups: [],
  mirrorFolders: [],
  mirrorCandidatePairs: 0,
  mirrorIndexedFolders: 0,
  mirrorSharedUpdates: 0,
  mirrorTruncated: false,
};

const emptySimilar: SimilarityAnalysis = {
  titleConflictGroups: [],
  pairs: [],
  candidateComparisons: 0,
  truncated: false,
};

function duplicateGroup(index: number): DuplicateGroup {
  return {
    id: `duplicate-${index}`,
    classification: 'exact',
    confidence: 'certain',
    reason: 'same-folder',
    evidence: [{ type: 'exact-url', detail: 'English detail must stay hidden' }],
    members: [
      bookmark(`duplicate-${index}-a`, `Duplicate ${index}`),
      bookmark(`duplicate-${index}-b`, `Duplicate ${index}`),
    ],
  };
}

function similarityPair(index: number): SimilarityPair {
  return {
    id: `similar-${index}`,
    confidence: 'possible',
    score: 0.72,
    reason: 'title-similarity',
    evidence: [{ type: 'title', detail: 'English detail must stay hidden', score: 0.72 }],
    members: [
      bookmark(`similar-${index}-a`, `Similar ${index} A`),
      bookmark(`similar-${index}-b`, `Similar ${index} B`),
    ],
  };
}

function mirrorSuggestion(index: number): MirrorFolderSuggestion {
  return {
    id: `mirror-${index}`,
    confidence: 'high',
    reason: 'mirror-folder-overlap',
    folders: [folder(`mirror-${index}-a`), folder(`mirror-${index}-b`)],
    shared: ['a', 'b', 'c', 'd', 'e'],
    leftOnly: [],
    rightOnly: [],
    evidence: [{
      type: 'mirror-overlap',
      detail: 'English detail must stay hidden',
      sharedCount: 5,
      unionCount: 5,
      jaccard: 1,
    }],
  };
}

function AnalysisStatus({
  analyzers,
  records,
  revision,
}: {
  readonly analyzers: OrganizeAnalyzers;
  readonly records: readonly BookmarkRecord[];
  readonly revision: number;
}) {
  const state = useOrganizeAnalysis(records, revision, true, analyzers);
  return <span>{state.status}</span>;
}

describe('OrganizeView through ManagerApp', () => {
  it('shows real exact duplicates with Chinese evidence and actionable selection controls', async () => {
    const repository = repositoryStub(vi.fn().mockResolvedValue(organizeTree()));
    render(<ManagerApp openUrl={vi.fn()} repository={repository} />);
    await screen.findByRole('heading', { name: '书签栏' });

    fireEvent.click(screen.getByRole('button', { name: '整理' }));

    expect(await screen.findAllByText('确定重复')).not.toHaveLength(0);
    expect(screen.getAllByText('多处收藏')).not.toHaveLength(0);
    expect(screen.getAllByText('书签栏 / Folder A')).not.toHaveLength(0);
    expect(screen.getAllByText('其他书签 / Folder B')).not.toHaveLength(0);
    expect(screen.getAllByText('https://same.example.test/full/path?keep=1#section')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole('button', { name: '移动选中项' })).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: '选中项移到待删除' })).not.toHaveLength(0);
    expect(screen.queryByText('English detail must stay hidden')).toBeNull();
  });

  it('opens the existing move and quarantine confirmation flows for selected duplicate members', async () => {
    const repository = repositoryStub(vi.fn().mockResolvedValue(organizeTree()));
    render(<ManagerApp openUrl={vi.fn()} repository={repository} />);
    await screen.findByRole('heading', { name: '书签栏' });
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');

    const selected = screen.getAllByRole('checkbox', { name: '选择 Shared Copy' })[0];
    const duplicateGroup = selected.closest('.organize-group') as HTMLElement;
    fireEvent.click(selected);
    fireEvent.click(within(duplicateGroup).getByRole('button', { name: '移动选中项' }));
    expect(await screen.findByRole('dialog', { name: '移动到' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(within(duplicateGroup).getByRole('button', { name: '选中项移到待删除' }));
    expect(await screen.findByRole('dialog', { name: '确认操作' })).toBeTruthy();
    expect(screen.getByText('将移到待删除 1 项')).toBeTruthy();
  });

  it('keeps three-member title conflicts and three-folder mirrors as complete groups', async () => {
    const repository = repositoryStub(vi.fn().mockResolvedValue(organizeTree()));
    render(<ManagerApp openUrl={vi.fn()} repository={repository} />);
    await screen.findByRole('heading', { name: '书签栏' });
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');

    fireEvent.click(screen.getByRole('tab', { name: /相似项/ }));
    expect(await screen.findAllByText('Project Dashboard')).toHaveLength(3);
    expect(screen.getByText('标题相同但网址不同')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /镜像目录/ }));
    expect(await screen.findByRole('button', { name: '定位 Folder A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位 Folder B' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位 Folder C' })).toBeTruthy();
    expect(screen.getByText(/共享 6 项/)).toBeTruthy();
    expect(screen.getByText(/重合度 100%/)).toBeTruthy();
  });

  it('opens in place and locates a member back in browse with a highlight', async () => {
    const openUrl = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const repository = repositoryStub(vi.fn().mockResolvedValue(organizeTree()));
    render(<ManagerApp openUrl={openUrl} repository={repository} />);
    await screen.findByRole('heading', { name: '书签栏' });
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');

    fireEvent.click(screen.getAllByRole('button', { name: '打开 Shared Copy' })[0]);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://same.example.test/full/path?keep=1#section'));
    expect(screen.getByRole('tab', { name: /重复项/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getAllByRole('button', { name: '定位 Shared Copy' })[1]);
    expect(await screen.findByRole('heading', { name: 'Folder B' })).toBeTruthy();
    expect(document.querySelector('[data-highlighted="true"]')?.textContent).toContain('Shared Copy');
  });

  it('searching from organize returns to browse and preserves the active folder', async () => {
    const repository = repositoryStub(vi.fn().mockResolvedValue(organizeTree()));
    render(<ManagerApp openUrl={vi.fn()} repository={repository} />);
    await screen.findByRole('heading', { name: '书签栏' });
    fireEvent.click(screen.getByRole('button', { name: '进入文件夹 Folder A' }));
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');

    fireEvent.change(screen.getByPlaceholderText('搜索书签、网址、域名或文件夹'), {
      target: { value: 'Project Dashboard' },
    });
    expect(await screen.findByRole('heading', { name: '搜索结果' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Folder A' })).toBeTruthy();
  });
});

describe('OrganizeView pagination', () => {
  it('moves tab selection and focus with arrow, Home, and End keys', () => {
    render(
      <OrganizeView
        analysis={{
          duplicates: emptyDuplicates,
          similar: emptySimilar,
          mirrorFolders: { suggestions: [], truncated: false },
        }}
        onLocateBookmark={vi.fn()}
        onLocateFolder={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('shows each approximate reason only once within its group header', () => {
    const titlePair = similarityPair(0);
    const hostPathPair: SimilarityPair = {
      ...similarityPair(1),
      reason: 'host-path-similarity',
      evidence: [{
        type: 'host-path',
        detail: 'English detail must stay hidden',
        score: 0.8,
      }],
    };
    render(
      <OrganizeView
        analysis={{
          duplicates: emptyDuplicates,
          similar: {
            ...emptySimilar,
            pairs: [titlePair, hostPathPair],
          },
          mirrorFolders: { suggestions: [], truncated: false },
        }}
        onLocateBookmark={vi.fn()}
        onLocateFolder={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /相似项/ }));

    const titleGroup = screen.getByText('Similar 0 A').closest('.organize-group');
    const hostPathGroup = screen.getByText('Similar 1 A').closest('.organize-group');
    expect(titleGroup).not.toBeNull();
    expect(hostPathGroup).not.toBeNull();
    expect(within(titleGroup as HTMLElement).getAllByText('标题相似')).toHaveLength(1);
    expect(within(hostPathGroup as HTMLElement).getAllByText('网址结构相似')).toHaveLength(1);
  });

  it('renders at most 50 members per duplicate, conflict, and mirror group', () => {
    const largeDuplicate: DuplicateGroup = {
      ...duplicateGroup(0),
      members: Array.from({ length: 51 }, (_, index) =>
        bookmark(`large-duplicate-${index}`, `Large Duplicate ${index}`),
      ),
    };
    const largeConflict: TitleConflictGroup = {
      id: 'large-conflict',
      confidence: 'high',
      reason: 'title-conflict',
      evidence: [{
        type: 'title-conflict',
        detail: 'English detail must stay hidden',
        score: 1,
      }],
      members: Array.from({ length: 51 }, (_, index) =>
        bookmark(`large-conflict-${index}`, `Large Conflict ${index}`),
      ),
    };
    const largeMirror: MirrorFolderSuggestion = {
      ...mirrorSuggestion(0),
      folders: Array.from({ length: 51 }, (_, index) =>
        folder(`large-mirror-${index}`),
      ),
    };
    render(
      <OrganizeView
        analysis={{
          duplicates: { ...emptyDuplicates, groups: [largeDuplicate] },
          similar: { ...emptySimilar, titleConflictGroups: [largeConflict] },
          mirrorFolders: { suggestions: [largeMirror], truncated: false },
        }}
        onLocateBookmark={vi.fn()}
        onLocateFolder={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText('Large Duplicate 50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示更多成员' }));
    expect(screen.getByText('Large Duplicate 50')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /相似项/ }));
    expect(screen.queryByText('Large Conflict 50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示更多成员' }));
    expect(screen.getByText('Large Conflict 50')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /镜像目录/ }));
    expect(screen.queryByText('Folder large-mirror-50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示更多成员' }));
    expect(screen.getByText('Folder large-mirror-50')).toBeTruthy();
  });

  it('renders 50 groups at a time and reports truncated similarity and mirror results', () => {
    render(
      <OrganizeView
        analysis={{
          duplicates: {
            ...emptyDuplicates,
            groups: Array.from({ length: 51 }, (_, index) => duplicateGroup(index)),
          },
          similar: {
            ...emptySimilar,
            pairs: Array.from({ length: 51 }, (_, index) => similarityPair(index)),
            truncated: true,
          },
          mirrorFolders: {
            suggestions: Array.from({ length: 51 }, (_, index) => mirrorSuggestion(index)),
            truncated: true,
          },
        }}
        onLocateBookmark={vi.fn()}
        onLocateFolder={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText('Duplicate 50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(screen.getAllByText('Duplicate 50')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: /相似项/ }));
    expect(screen.getByText('结果较多，仅显示最相关项目')).toBeTruthy();
    expect(screen.queryByText('Similar 50 A')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(screen.getByText('Similar 50 A')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /镜像目录/ }));
    expect(screen.getByText('结果较多，仅显示最相关项目')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '定位 Folder mirror-50-a' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(screen.getByRole('button', { name: '定位 Folder mirror-50-a' })).toBeTruthy();
  });
});

describe('organize analysis lifecycle', () => {
  it('yields an analyzing frame before running synchronous analyzers', async () => {
    vi.useFakeTimers();
    try {
      const duplicateAnalyzer = vi.fn(() => emptyDuplicates);
      const similarityAnalyzer = vi.fn(() => emptySimilar);
      render(
        <AnalysisStatus
          analyzers={{ duplicateAnalyzer, similarityAnalyzer }}
          records={[bookmark('scheduled')]}
          revision={1}
        />,
      );

      expect(screen.getByText('analyzing')).toBeTruthy();
      expect(duplicateAnalyzer).not.toHaveBeenCalled();
      expect(similarityAnalyzer).not.toHaveBeenCalled();

      await act(async () => vi.runOnlyPendingTimers());
      expect(duplicateAnalyzer).toHaveBeenCalledTimes(1);
      expect(similarityAnalyzer).toHaveBeenCalledTimes(1);
      expect(screen.getByText('ready')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calculates only on first entry for a revision and recalculates after records change', async () => {
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockResolvedValueOnce(organizeTree())
      .mockResolvedValueOnce(organizeTree(' Updated'));
    const repository = repositoryStub(getTree);
    const duplicateAnalyzer = vi.fn(analyzeDuplicates);
    const similarityAnalyzer = vi.fn(analyzeSimilarBookmarks);
    render(
      <ManagerApp
        openUrl={vi.fn()}
        organizeAnalyzers={{ duplicateAnalyzer, similarityAnalyzer }}
        repository={repository}
      />,
    );
    await screen.findByRole('heading', { name: '书签栏' });
    expect(duplicateAnalyzer).not.toHaveBeenCalled();
    expect(similarityAnalyzer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');
    expect(duplicateAnalyzer).toHaveBeenCalledTimes(1);
    expect(similarityAnalyzer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: /相似项/ }));
    fireEvent.click(screen.getByRole('button', { name: '浏览' }));
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('确定重复');
    expect(duplicateAnalyzer).toHaveBeenCalledTimes(1);
    expect(similarityAnalyzer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '浏览' }));
    fireEvent.click(screen.getByRole('button', { name: '进入文件夹 Folder A' }));
    act(() => repository.emitChanged());
    await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    await screen.findByText('Shared Copy Updated');
    fireEvent.click(screen.getByRole('button', { name: '整理' }));
    await screen.findAllByText('Shared Copy Updated');
    expect(duplicateAnalyzer).toHaveBeenCalledTimes(2);
    expect(similarityAnalyzer).toHaveBeenCalledTimes(2);
  });
});
