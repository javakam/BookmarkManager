# 书签工作台 V1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome/Edge Manifest V3 manager-only extension that reads and safely operates on native bookmarks, provides fuzzy search and analysis, supports folder counts and same-level ordering, and stays synchronized with browser changes.

**Architecture:** WXT owns the MV3 build and entrypoints. The browser adapter is the only layer allowed to call the bookmarks API, and `browser.bookmarks` remains the only bookmark data source. React consumes complete native snapshots; browser events are merged before rereading the tree, while a typed operation service performs previewed, revalidated writes and stores only UI preferences and minimal recovery anchors.

**Tech Stack:** WXT 0.20.27, React 19.2.7, TypeScript 7.0.2, `fuse.js` 7.4.2, `pinyin-pro` 3.28.1, `lucide-react` 1.24.0, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1, native `browser.storage.local`.

---

## Task 1: Bootstrap the manager-only extension

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/manager/index.html`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.tsx`
- Create: `entrypoints/manager/main.tsx`

- [ ] **Step 1: Write the failing build smoke test**

Create `tests/build/manifest.test.ts` that reads `.output/chrome-mv3/manifest.json` after a build and asserts `manifest_version === 3`, `permissions` contains `bookmarks`, `storage`, `activeTab`, and `favicon`, `optional_host_permissions` contains both HTTP patterns, and `chrome_url_overrides` is absent.

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `npm test -- tests/build/manifest.test.ts`  
Expected: FAIL because the WXT project and output manifest do not exist.

- [ ] **Step 3: Create the minimal project configuration**

Use this configuration shape:

```ts
// wxt.config.ts
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '书签工作台',
    description: '本地优先的浏览器原生书签管理器',
    permissions: ['bookmarks', 'storage', 'activeTab', 'favicon'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: '打开书签工作台' },
  },
});
```

`entrypoints/background.ts` must only register the browser bookmark event bridge and export no UI state. `manager/index.html` and `popup/index.html` must contain a root element and a local title; both `main.tsx` files render a temporary `<div>Loading</div>` so WXT can build before domain code exists.

Use scripts: `dev`, `build`, `zip`, `test`, `test:watch`, `bench:search`, and `e2e`.

- [ ] **Step 4: Run the build smoke test to verify it passes**

Run: `npm run build && npm test -- tests/build/manifest.test.ts`  
Expected: PASS; generated manifest has no `chrome_url_overrides`.

- [ ] **Step 5: Commit the bootstrap**

Run: `git add package.json tsconfig.json wxt.config.ts vitest.config.ts src entrypoints tests && git commit -m "chore: bootstrap bookmark manager extension"`.  
If the workspace still has no Git repository, record the command as unavailable and continue without initializing one.

## Task 2: Define the bookmark domain and browser adapter

**Files:**
- Create: `src/domain/bookmarks.ts`
- Create: `src/domain/tree.ts`
- Create: `src/platform/browser.ts`
- Create: `src/platform/bookmark-repository.ts`
- Create: `src/test/fixtures/bookmark-tree.ts`
- Test: `tests/domain/tree.test.ts`
- Test: `tests/platform/bookmark-repository.test.ts`

- [ ] **Step 1: Write tree and adapter contract tests**

The fixture must include roots, nested folders, an empty title favicon-only bookmark, a managed read-only node, and an external mutation. Assert that flattening preserves `id`, `parentId`, `index`, `title`, `url`, `path`, `depth`, `isFolder`, `isUnmodifiable`, and `isBookmarkBar`.

The adapter contract is:

```ts
export interface BrowserBookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: BrowserBookmarkNode[];
  unmodifiable?: 'managed' | 'readonly';
}

export type BrowserBookmarkTreeNode = BrowserBookmarkNode;

export interface BookmarkRepository {
  getTree(): Promise<BrowserBookmarkTreeNode[]>;
  createBookmark(input: { parentId: string; index?: number; title: string; url: string }): Promise<BrowserBookmarkNode>;
  createFolder(input: { parentId: string; index?: number; title: string }): Promise<BrowserBookmarkNode>;
  update(id: string, changes: { title?: string; url?: string }): Promise<BrowserBookmarkNode>;
  move(id: string, destination: { parentId: string; index?: number }): Promise<BrowserBookmarkNode>;
  remove(id: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}
```

- [ ] **Step 2: Run the domain tests and verify failure**

Run: `npm test -- tests/domain/tree.test.ts tests/platform/bookmark-repository.test.ts`  
Expected: FAIL because types, flattening, and adapter are not implemented.

- [ ] **Step 3: Implement the domain types and tree flattening**

Use a depth-first traversal that carries the ancestor folder names and sibling index. Treat a node with `url` as a leaf bookmark, a node with `children` and no `url` as a folder, and preserve empty titles exactly. Never synthesize a title in the domain model.

Implement `createChromeBookmarkRepository()` with `browser.bookmarks.*` calls and map `unmodifiable` to a boolean. Event listeners must be unsubscribable and must not throw when a browser event arrives after a page unmounts.

- [ ] **Step 4: Run the domain tests and verify pass**

Run: `npm test -- tests/domain/tree.test.ts tests/platform/bookmark-repository.test.ts`  
Expected: PASS.

## Task 3: Build the local search index

**Files:**
- Create: `src/domain/search.ts`
- Create: `src/domain/pinyin.ts`
- Create: `src/app/bookmark-index.ts`
- Test: `tests/domain/search.test.ts`
- Test: `tests/app/bookmark-index.test.ts`

- [ ] **Step 1: Write failing search tests**

Cover exact title, title prefix, domain, URL, folder path, Chinese pinyin initials, one-character query protection, empty query, empty-title domain fallback, and result ranking. A result must include `matchReasons`, `score`, and the original node; it must not mutate `title`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/domain/search.test.ts tests/app/bookmark-index.test.ts`  
Expected: FAIL because the index and scorer are missing.

- [ ] **Step 3: Implement indexing and scoring**

Normalize only for search, not for writes. Store title, host, URL, path, full pinyin, initials, and token arrays. Score exact and prefix matches ahead of title fuzzy matches, then path and URL matches. For a one-character query, disable edit-distance matching. Use Fuse.js only after exact/prefix candidates are collected so the common case stays cheap.

`BookmarkIndex.search(query, scope)` returns at most 200 results, keeps duplicate paths separate, and returns a `reason` enum (`title-exact`, `title-prefix`, `domain`, `path`, `url`, `pinyin`). `refresh(nodes)` replaces the immutable snapshot; `upsert` and `remove` update one node after a browser event.

- [ ] **Step 4: Run search tests and a 5000-node benchmark**

Run: `npm test -- tests/domain/search.test.ts tests/app/bookmark-index.test.ts` and `npm run bench:search`.  
Expected: tests PASS; the fixed 20-query 5000-node fixture reports p95 below 100ms after warm-up.

## Task 4: Add duplicate and similarity analysis (read-only)

**Files:**
- Create: `src/domain/url-normalize.ts`
- Create: `src/domain/duplicate-analyzer.ts`
- Create: `src/domain/similarity-analyzer.ts`
- Test: `tests/domain/duplicate-analyzer.test.ts`
- Test: `tests/domain/similarity-analyzer.test.ts`

- [ ] **Step 1: Write failing analysis tests**

Assert four separate classifications: exact URL groups, conservative normalized candidates, query/fragment candidates, and mirror-folder suggestions. Assert that cross-folder exact matches are labeled `multi-location` and that no group contains a preselected deletion item. Similarity tests must explain title, host/path, and folder evidence.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/domain/duplicate-analyzer.test.ts tests/domain/similarity-analyzer.test.ts`  
Expected: FAIL because analyzers are missing.

- [ ] **Step 3: Implement pure analyzers**

Keep URL normalization conservative: remove default ports, normalize `www` only for candidate reporting, trim one trailing slash, and expose removed query parameters rather than discarding them. Preserve fragments in the exact identity. Compute mirror-folder overlap with Jaccard similarity over exact URL identities and require at least five shared leaves before suggesting a mirror.

Use a URL-to-folder inverted index before Jaccard comparison. Exact normalized-title conflicts are immutable groups containing all members, not N×N pairs. Approximate similarity is bounded by per-node top-K and a global pair cap, returns `truncated`, and will be executed through an analysis Worker when the UI integration task begins.

Return immutable groups with `reason`, `confidence`, `members`, and `evidence`. Do not call the browser API from analyzers.

- [ ] **Step 4: Run analysis tests**

Run: `npm test -- tests/domain/duplicate-analyzer.test.ts tests/domain/similarity-analyzer.test.ts`  
Expected: PASS.

## Task 5: Implement safe operation planning, quarantine, and recovery journal

**Files:**
- Create: `src/domain/operation.ts`
- Create: `src/platform/journal.ts`
- Create: `src/app/operation-service.ts`
- Test: `tests/domain/operation.test.ts`
- Test: `tests/platform/journal.test.ts`

- [ ] **Step 1: Write failing operation tests**

Cover leaf-only quarantine, preview output, parent/neighbor anchors, managed-node rejection, stale fingerprint conflict, per-item failure, and restoration when anchors exist or are missing. Assert that folders cannot enter a quarantine plan.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/domain/operation.test.ts tests/platform/journal.test.ts`  
Expected: FAIL because the planner and IndexedDB journal are missing.

- [ ] **Step 3: Define the immutable operation contracts**

Use these core types:

```ts
export type NodeFingerprint = { id: string; parentId?: string; index: number; title: string; url?: string };
export type RecoveryAnchor = { parentId?: string; parentPath: string[]; previousId?: string; nextId?: string; originalIndex: number };
export type OperationItem = { node: NodeFingerprint; anchor: RecoveryAnchor; action: 'quarantine' | 'move' | 'restore'; reason: string };
export type OperationPlan = { id: string; createdAt: number; items: OperationItem[]; targetFolderId?: string };
```

`planQuarantine()` rejects folders, roots, unmodifiable nodes, duplicate IDs, and missing URLs. `executePlan()` performs a fresh fingerprint check immediately before each browser API call, recomputes index from anchors, writes one result per item, and never converts a conflict into a success. `restoreItem()` previews candidate parents when the original parent or anchors are missing.

Use `idb` with a database named `bookmark-workbench`, object stores `operations` and `recovery`. Recovery rows for items still in the quarantine folder cannot be removed by “clear history”.

- [ ] **Step 4: Run operation tests**

Run: `npm test -- tests/domain/operation.test.ts tests/platform/journal.test.ts`  
Expected: PASS.

## Task 6: Build the React manager shell and browse/search views

**Files:**
- Create: `src/app/app-store.ts`
- Create: `src/app/use-bookmarks.ts`
- Create: `src/ui/layout/AppShell.tsx`
- Create: `src/ui/layout/Sidebar.tsx`
- Create: `src/ui/layout/CommandSearch.tsx`
- Create: `src/ui/views/OverviewView.tsx`
- Create: `src/ui/views/BrowseView.tsx`
- Create: `src/ui/views/SearchResultsView.tsx`
- Create: `src/ui/components/BookmarkRow.tsx`
- Create: `src/ui/components/FolderColumns.tsx`
- Create: `src/ui/components/EmptyState.tsx`
- Create: `src/ui/styles/tokens.css`
- Create: `src/ui/styles/app.css`
- Modify: `entrypoints/manager/main.tsx`
- Test: `tests/ui/search-results.test.tsx`
- Test: `tests/ui/browse-view.test.tsx`

- [ ] **Step 1: Write failing component tests**

Test empty state, search result match reason, icon-only domain fallback, folder path navigation, zero results, read-only node action disabling, and preservation of query while opening a result.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- tests/ui/search-results.test.tsx tests/ui/browse-view.test.tsx`  
Expected: FAIL because the React shell is missing.

- [ ] **Step 3: Implement the store and shell**

The store owns only UI state (`view`, `query`, `scope`, `selectedIds`, `activePath`, `status`). Repository events call `refreshSnapshot()` and preserve the current query if possible. Components call typed service methods; no component imports `browser.bookmarks`.

The manager shell must implement:

- Overview, Browse, Organize, and Activity tabs.
- Search field with keyboard focus, query clear, result selection, and zero-result state.
- Column navigation with full breadcrumb and current-folder contents.
- Compact rows that preserve empty titles and show host as a read-only helper.
- Batch toolbar only after selection.
- Inline conflict and partial-result banners.

Use Lucide icons with `aria-label` and tooltips. Use CSS variables for neutral surfaces and restrained status colors; do not use a permanent details column or decorative card dashboard.

- [ ] **Step 4: Run component tests and visual smoke test**

Run: `npm test -- tests/ui/search-results.test.tsx tests/ui/browse-view.test.tsx` and `npm run dev -- --browser chrome`.  
Expected: tests PASS; manager page is readable at 1366×768 with no horizontal overlap.

## Task 7: Add organize views and operation confirmation UI

**Files:**
- Create: `src/ui/views/OrganizeView.tsx`
- Create: `src/ui/views/ActivityView.tsx`
- Create: `src/ui/components/IssueGroup.tsx`
- Create: `src/ui/components/OperationPreviewDialog.tsx`
- Create: `src/ui/components/OperationResultPanel.tsx`
- Modify: `src/app/app-store.ts`
- Test: `tests/ui/organize-view.test.tsx`
- Test: `tests/ui/operation-dialog.test.tsx`

- [ ] **Step 1: Write failing organize tests**

Assert that duplicate groups show every original path, cross-folder matches are labeled multi-location, similarity evidence is visible, nothing is preselected, folders cannot be quarantined, and confirmation shows counts plus original/target paths.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/ui/organize-view.test.tsx tests/ui/operation-dialog.test.tsx`  
Expected: FAIL because organize components are missing.

- [ ] **Step 3: Implement group and confirmation views**

Use tabs for `重复项`, `相似项`, and `镜像目录`. Each group supports `定位`, `暂不处理`, and explicit item checkboxes. The confirmation dialog lists only the checked leaf bookmarks, their current paths, the quarantine target, and the conflict behavior. After execution, show per-item success/failure/conflict and a restore action for successful quarantine items.

- [ ] **Step 4: Run organize tests**

Run: `npm test -- tests/ui/organize-view.test.tsx tests/ui/operation-dialog.test.tsx`  
Expected: PASS.

## Task 8: Wire popup and package the manager build

**Files:**
- Create: `src/ui/popup/Popup.tsx`
- Modify: `entrypoints/popup/main.tsx`
- Modify: `entrypoints/popup/index.html`
- Modify: `wxt.config.ts`
- Test: `tests/ui/popup.test.tsx`

- [ ] **Step 1: Write failing popup tests**

Cover opening the manager, active-tab permission failure, saving a current page with missing title, and disabling save for browser-internal URLs.

- [ ] **Step 2: Implement popup actions**

Use `browser.tabs.query({ active: true, currentWindow: true })` only after the user clicks save; with `activeTab`, read URL/title and create a leaf bookmark in the selected folder. For `chrome://`, `edge://`, extension pages, or missing URL, explain why save is unavailable. The popup must never call bulk operations.

- [ ] **Step 3: Run tests and build both browsers**

Run: `npm test -- tests/ui/popup.test.tsx`, `npm run build -- --browser chrome`, and `npm run build -- --browser edge`.  
Expected: tests PASS; both output manifests are MV3, manager-only, and contain no new-tab override.

## Task 9: End-to-end and visual verification

**Files:**
- Create: `tests/e2e/manager.spec.ts`
- Create: `playwright.config.ts`
- Create: `tests/fixtures/fixture-bookmarks.json`
- Create: `scripts/verify-build.mjs`

- [ ] **Step 1: Add deterministic fixture and browser mock bridge**

Load a 5000-node fixture through the repository mock in test mode. The fixture must include the 881-node sample shape, empty titles, duplicate groups, managed nodes, local URLs, IP URLs, and deep folders.

- [ ] **Step 2: Write the failing E2E flows**

Cover install/load, search and open, locate from search, browse into depth four, select a duplicate group, preview quarantine, inject an external mutation before execution, observe a conflict, quarantine a leaf, and restore it.

- [ ] **Step 3: Run E2E and visual checks**

Run: `npm run e2e` and `node scripts/verify-build.mjs`. Capture 1366×768, 1440×900, and 1920×1080 screenshots at 100%, 125%, and 150% emulated scale.  
Expected: all flows pass; no critical text, toolbar, dialog, or keyboard-focus overlap.

- [ ] **Step 4: Run the full verification suite**

Run: `npm test`, `npm run build -- --browser chrome`, `npm run build -- --browser edge`, and `npm run e2e`.  
Expected: all tests pass, both builds succeed, and `verify-build.mjs` confirms the required permissions and absence of `chrome_url_overrides`.

## 2026-07-12 V1a.1 execution baseline

Tasks 1-4, the read-only parts of Tasks 6-8, and the initial browser validation are already implemented. Tasks 10-16 below are the executable plan for the approved native operations, folder counts, settings, same-level sorting, and browser-change synchronization. They replace the unimplemented write portions of Tasks 5, 7, and 9 without changing the link-checking boundary.

## Task 10: Coalesce native bookmark refreshes

**Files:**
- Modify: `src/platform/browser.ts`
- Modify: `src/platform/bookmark-repository.ts`
- Modify: `src/app/use-bookmarks.ts`
- Modify: `tests/platform/bookmark-repository.test.ts`
- Modify: `tests/app/use-bookmarks.test.tsx`

- [ ] **Step 1: Write failing repository event tests**

Add `BookmarkRepositoryChange = 'changed' | 'import-began' | 'import-ended'`. Test that normal events emit `changed`, `onImportBegan` emits `import-began`, `onImportEnded` emits `import-ended`, and unsubscribe removes every listener.

```ts
const changes: BookmarkRepositoryChange[] = [];
const unsubscribe = repository.onChanged((change) => changes.push(change));
api.onCreated.fire();
api.onImportBegan.fire();
api.onImportEnded.fire();
expect(changes).toEqual(['changed', 'import-began', 'import-ended']);
unsubscribe();
expect(api.onImportBegan.size).toBe(0);
```

- [ ] **Step 2: Write failing refresh lifecycle tests**

Use fake timers and deferred `getTree()` promises to prove these behaviors independently:

```ts
repository.emitChanged('changed');
repository.emitChanged('changed');
repository.emitChanged('changed');
await act(async () => vi.advanceTimersByTime(199));
expect(getTree).toHaveBeenCalledTimes(1);
await act(async () => vi.advanceTimersByTime(1));
expect(getTree).toHaveBeenCalledTimes(2);
```

Also assert: events during an in-flight read produce exactly one trailing read; import events suppress intermediate reads; import end forces one read; focus/visibility schedules a read; stale reads never overwrite a newer snapshot; and the last successful refresh time is exposed.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/platform/bookmark-repository.test.ts tests/app/use-bookmarks.test.tsx`

Expected: FAIL because `onImportBegan`, typed change events, coalescing, import state, and `lastUpdatedAt` do not exist.

- [ ] **Step 4: Implement the minimal single-flight refresh policy**

Extend the repository contract as follows:

```ts
export type BookmarkRepositoryChange =
  | 'changed'
  | 'import-began'
  | 'import-ended';

onChanged(
  listener: (change: BookmarkRepositoryChange) => void,
): () => void;
```

Subscribe before the initial read. In `useBookmarks`, keep refs for `inFlight`, `dirty`, `isImporting`, the 200ms timer, request sequence, and disposal. Ordinary changes schedule one trailing refresh. An event received while reading sets `dirty`; completion schedules only one more read. Import begin invalidates intermediate reads and clears the timer; import end performs one full refresh. Add `visibilitychange` and `focus` listeners that use the same scheduler. Preserve the last good records on error.

Extend `BookmarkDataState` with:

```ts
readonly lastUpdatedAt?: number;
readonly isImporting: boolean;
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/platform/bookmark-repository.test.ts tests/app/use-bookmarks.test.tsx`

Expected: both files PASS with no unhandled timer or promise warnings.

```bash
git add src/platform/browser.ts src/platform/bookmark-repository.ts src/app/use-bookmarks.ts tests/platform/bookmark-repository.test.ts tests/app/use-bookmarks.test.tsx
git commit -m "feat: synchronize native bookmark changes"
```

## Task 11: Add folder counts and focused settings

**Files:**
- Create: `src/platform/manager-settings-repository.ts`
- Create: `src/app/use-manager-settings.ts`
- Create: `src/ui/manager/SettingsView.tsx`
- Create: `tests/platform/manager-settings-repository.test.ts`
- Create: `tests/app/use-manager-settings.test.tsx`
- Create: `tests/ui/settings-view.test.tsx`
- Modify: `src/app/bookmark-view-model.ts`
- Modify: `src/ui/manager/FolderTree.tsx`
- Modify: `src/ui/manager/ManagerApp.tsx`
- Modify: `src/ui/manager/app.css`
- Modify: `entrypoints/manager/main.tsx`
- Modify: `tests/app/bookmark-view-model.test.ts`
- Modify: `tests/ui/manager-app.test.tsx`

- [ ] **Step 1: Write failing count tests**

Add a fixture where a folder has two direct bookmarks and a child folder with three bookmarks. Assert the maps are calculated once from the snapshot:

```ts
expect(model.directBookmarkCountByFolderId.get('parent')).toBe(2);
expect(model.totalBookmarkCountByFolderId.get('parent')).toBe(5);
expect(model.directBookmarkCountByFolderId.get('child')).toBe(3);
expect(model.totalBookmarkCountByFolderId.get('child')).toBe(3);
```

The total count excludes folders and synthetic roots and runs in `O(records)` using a bottom-up accumulation, not recursive work per rendered node.

- [ ] **Step 2: Write failing settings tests**

Define the only editable V1a.1 setting:

```ts
export interface ManagerSettings {
  readonly showFolderCounts: boolean;
}

export const DEFAULT_MANAGER_SETTINGS: ManagerSettings = {
  showFolderCounts: true,
};
```

Test default loading, merging a stored partial value, saving under one namespaced `storage.local` key, and falling back to defaults after a storage failure. Do not store bookmark nodes, titles, URLs, paths, counts, or search results.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/app/bookmark-view-model.test.ts tests/platform/manager-settings-repository.test.ts tests/app/use-manager-settings.test.tsx tests/ui/settings-view.test.tsx`

Expected: FAIL because count maps, settings repository/hook, and settings view are absent.

- [ ] **Step 4: Implement count rendering and settings view**

Add `settings` to `ManagerView` and a left navigation button using the Lucide `Settings` icon. Render a real toggle labeled `显示目录书签数量`. Each folder row gets a separate right-aligned count element:

```tsx
<span
  aria-label={`直属 ${directCount}，合计 ${totalCount}`}
  className="folder-tree__counts"
  title={`直属 ${directCount} | 合计 ${totalCount}`}
>
  <span>{directCount}</span>
  <span aria-hidden="true">/</span>
  <span>{totalCount}</span>
</span>
```

Do not concatenate counts into the folder label. At the narrow sidebar breakpoint hide the direct number and separator while retaining the total number. `SettingsView` also displays the read-only source `当前浏览器原生书签`, automatic update status, formatted `lastUpdatedAt`, and a manual refresh button.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/app/bookmark-view-model.test.ts tests/platform/manager-settings-repository.test.ts tests/app/use-manager-settings.test.tsx tests/ui/settings-view.test.tsx tests/ui/manager-app.test.tsx`

Expected: all focused tests PASS; folder labels remain unchanged and empty bookmark titles remain untouched.

```bash
git add src/platform/manager-settings-repository.ts src/app/use-manager-settings.ts src/ui/manager/SettingsView.tsx src/app/bookmark-view-model.ts src/ui/manager/FolderTree.tsx src/ui/manager/ManagerApp.tsx src/ui/manager/app.css entrypoints/manager/main.tsx tests/platform/manager-settings-repository.test.ts tests/app/use-manager-settings.test.tsx tests/ui/settings-view.test.tsx tests/app/bookmark-view-model.test.ts tests/ui/manager-app.test.tsx
git commit -m "feat: add folder counts and settings"
```

## Task 12: Build the revalidated operation service

**Files:**
- Create: `src/domain/bookmark-operations.ts`
- Create: `src/platform/bookmark-operation-storage.ts`
- Create: `src/app/bookmark-operation-service.ts`
- Create: `tests/domain/bookmark-operations.test.ts`
- Create: `tests/platform/bookmark-operation-storage.test.ts`
- Create: `tests/app/bookmark-operation-service.test.ts`

- [ ] **Step 1: Write failing fingerprint and ordering tests**

Define a fingerprint containing exactly `id`, `parentId`, `index`, `title`, `url`, `isFolder`, and `isUnmodifiable`. Tests must prove that a title, URL, parent, or index change produces a conflict; roots and managed nodes are rejected; a folder cannot move into itself or a descendant; and batch order follows the original browser order.

```ts
expect(compareBookmarkFingerprint(expected, changedTitle)).toBe(false);
expect(validateMoveTarget(tree, folder, descendant.id)).toEqual({
  valid: false,
  reason: '不能移动到自身或子文件夹',
});
```

- [ ] **Step 2: Write failing storage and service tests**

Persist only recovery anchors and the native quarantine folder ID:

```ts
export interface BookmarkRecoveryEntry {
  readonly nodeId: string;
  readonly originalParentId: string;
  readonly originalIndex: number;
  readonly previousSiblingId?: string;
  readonly nextSiblingId?: string;
  readonly quarantinedAt: number;
}
```

Test create bookmark/folder, edit, move, same-parent reorder, quarantine, restore, partial batch failure, and external mutation between preview and execute. Assert the service calls `repository.getTree()` immediately before every execution and never calls `repository.remove()` for quarantine.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/domain/bookmark-operations.test.ts tests/platform/bookmark-operation-storage.test.ts tests/app/bookmark-operation-service.test.ts`

Expected: FAIL because the operation plan, recovery storage, and service are absent.

- [ ] **Step 4: Implement immutable plans and per-item results**

Use these public contracts:

```ts
export type BookmarkOperationKind =
  | 'create-bookmark'
  | 'create-folder'
  | 'update'
  | 'move'
  | 'reorder'
  | 'quarantine'
  | 'restore';

export interface BookmarkOperationResult {
  readonly id: string;
  readonly status: 'success' | 'conflict' | 'failure';
  readonly message: string;
}

export interface BookmarkOperationExecution {
  readonly kind: BookmarkOperationKind;
  readonly results: readonly BookmarkOperationResult[];
}
```

Plans capture source fingerprints, target folder fingerprint, complete target path, and affected count for preview. Execution rereads the native tree and skips only conflicting items. Move and quarantine preserve source order and report every item. The service validates the stored quarantine ID; if absent, it reuses an exact folder under the browser's `other` root or creates `待删除（书签工作台）` there, then stores only its ID. Restore uses sibling anchors first, then the saved index; if the original parent is absent, return a conflict requiring an explicitly selected fallback folder.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/domain/bookmark-operations.test.ts tests/platform/bookmark-operation-storage.test.ts tests/app/bookmark-operation-service.test.ts`

Expected: all focused tests PASS, including mixed success/conflict/failure results.

```bash
git add src/domain/bookmark-operations.ts src/platform/bookmark-operation-storage.ts src/app/bookmark-operation-service.ts tests/domain/bookmark-operations.test.ts tests/platform/bookmark-operation-storage.test.ts tests/app/bookmark-operation-service.test.ts
git commit -m "feat: add safe native bookmark operations"
```

## Task 13: Expose single-item create, edit, move, and quarantine

**Files:**
- Create: `src/ui/manager/BookmarkEditorDialog.tsx`
- Create: `src/ui/manager/MoveBookmarkDialog.tsx`
- Create: `src/ui/manager/ConfirmOperationDialog.tsx`
- Create: `src/ui/manager/OperationResultDialog.tsx`
- Create: `tests/ui/bookmark-operation-dialogs.test.tsx`
- Modify: `src/ui/manager/BookmarkRow.tsx`
- Modify: `src/ui/manager/BrowseView.tsx`
- Modify: `src/ui/manager/ManagerApp.tsx`
- Modify: `src/ui/manager/app.css`
- Modify: `entrypoints/manager/main.tsx`
- Modify: `tests/ui/manager-app.test.tsx`

- [ ] **Step 1: Write failing dialog and manager flow tests**

Test these user-visible flows:

- `新建书签` accepts an empty title and a non-empty URL without restricting local, IP, `file://`, or browser-internal schemes.
- `新建文件夹` targets the currently displayed folder.
- `编辑` preserves an empty title and previews the changed fields.
- `移动到……` excludes the node itself and descendants from folder choices and displays the complete target path.
- `移到待删除` says it is recoverable and never says permanent delete.
- managed/root nodes have no enabled write controls.
- cancel performs no repository call; execute shows real success, conflict, or failure.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- tests/ui/bookmark-operation-dialogs.test.tsx tests/ui/manager-app.test.tsx`

Expected: FAIL because the dialogs and action controls do not exist.

- [ ] **Step 3: Implement focused dialogs and row actions**

Use native accessible dialogs with explicit headings, Cancel, and Confirm buttons. Add `新建书签` and `新建文件夹` commands to the current-folder heading. Add one `更多操作` icon menu per writable row with `编辑/重命名`, `移动到……`, and `移到待删除`; keep the existing open command. Search and organize results remain read-only and retain `定位`, so write behavior is not duplicated across views.

The UI must call `plan...()` first, render source/target/affected count, and call `execute()` only after confirmation. After execution, request the shared native refresh and show the exact per-item result. Disable all write commands while one execution is active.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/ui/bookmark-operation-dialogs.test.tsx tests/ui/manager-app.test.tsx tests/ui/organize-view.test.tsx`

Expected: all focused tests PASS; organize remains read-only and favicon-only titles remain empty.

```bash
git add src/ui/manager/BookmarkEditorDialog.tsx src/ui/manager/MoveBookmarkDialog.tsx src/ui/manager/ConfirmOperationDialog.tsx src/ui/manager/OperationResultDialog.tsx src/ui/manager/BookmarkRow.tsx src/ui/manager/BrowseView.tsx src/ui/manager/ManagerApp.tsx src/ui/manager/app.css entrypoints/manager/main.tsx tests/ui/bookmark-operation-dialogs.test.tsx tests/ui/manager-app.test.tsx tests/ui/organize-view.test.tsx
git commit -m "feat: add bookmark management dialogs"
```

## Task 14: Add safe same-level folder ordering

**Files:**
- Create: `src/domain/folder-reorder.ts`
- Create: `tests/domain/folder-reorder.test.ts`
- Modify: `src/ui/manager/FolderTree.tsx`
- Modify: `src/ui/manager/ManagerApp.tsx`
- Modify: `src/ui/manager/app.css`
- Modify: `tests/ui/manager-app.test.tsx`

- [ ] **Step 1: Write failing index calculation tests**

Cover moving before and after, moving upward and downward, no-op drops, source/anchor parent mismatch, and ordinary bookmarks between folders:

```ts
const siblings = [folderA, bookmarkX, folderB, bookmarkY, folderC];
expect(calculateFolderMove(siblings, 'folder-c', 'folder-a', 'after')).toEqual({
  parentId: 'parent',
  index: 1,
});
```

The returned index is the source node's position in the final complete sibling list after removing it, not the index in a filtered folder list.

- [ ] **Step 2: Write failing drag interaction tests**

Assert only the grip is draggable; cross-parent drops are rejected; before/after insertion state is announced; the drop opens a preview instead of writing immediately; a changed `data.revision` cancels confirmation; special and managed top-level folders are not draggable; and `上移/下移` commands call the same reorder plan.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/domain/folder-reorder.test.ts tests/ui/manager-app.test.tsx`

Expected: FAIL because the ordering helper, grip, insertion state, and preview do not exist.

- [ ] **Step 4: Implement native desktop drag and keyboard equivalents**

Use HTML Drag and Drop on a Lucide `GripVertical` button only. Store `{ sourceId, parentId, revision }` at drag start. Render one insertion line before or after the hovered same-parent folder. On drop, calculate against `model.childrenByParentId.get(parentId)` including bookmarks, then open the shared confirmation dialog. Execute through the operation service and refresh from the browser result; never reorder only local React state.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/domain/folder-reorder.test.ts tests/ui/manager-app.test.tsx`

Expected: focused tests PASS and no drag operation can change a folder's parent.

```bash
git add src/domain/folder-reorder.ts src/ui/manager/FolderTree.tsx src/ui/manager/ManagerApp.tsx src/ui/manager/app.css tests/domain/folder-reorder.test.ts tests/ui/manager-app.test.tsx
git commit -m "feat: add same-level folder ordering"
```

## Task 15: Add multi-select, batch move, quarantine, and restore

**Files:**
- Create: `src/ui/manager/BatchActionBar.tsx`
- Create: `tests/ui/batch-bookmark-operations.test.tsx`
- Modify: `src/ui/manager/BookmarkRow.tsx`
- Modify: `src/ui/manager/BrowseView.tsx`
- Modify: `src/ui/manager/ManagerApp.tsx`
- Modify: `src/ui/manager/app.css`
- Modify: `tests/ui/manager-app.test.tsx`

- [ ] **Step 1: Write failing selection and batch tests**

Test that checkboxes appear only for writable direct children in Browse; select-all excludes managed nodes and the quarantine folder; changing folders clears selection; a data refresh removes IDs that no longer exist; the batch bar appears only when selection is non-empty; and no checkboxes are added to Organize.

For batch execution, assert the preview lists every selected item and target path, source order is preserved, successful IDs clear while conflict/failure IDs remain selected, and the result dialog reports exact totals. A folder target that is a selected node or descendant is disabled.

- [ ] **Step 2: Write failing recovery tests**

When browsing `待删除（书签工作台）`, items with recovery anchors expose `恢复`. Test automatic restore to a valid original parent, anchor-based ordering, and the fallback-folder chooser when the original parent was externally deleted. No fallback is selected silently.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm test -- tests/ui/batch-bookmark-operations.test.tsx tests/ui/manager-app.test.tsx tests/ui/organize-view.test.tsx`

Expected: FAIL because selection, batch controls, and recovery UI are absent.

- [ ] **Step 4: Implement batch controls through the shared service**

Add stable-size checkbox cells to bookmark rows and a compact action bar with `移动到……`, `移到待删除`, `恢复`, and `取消选择`. Use the same move/confirm/result dialogs and the same operation plans as single-item actions. Do not add auto-selection based on duplicate or similarity analysis. Disable conflicting commands during execution and preserve the current folder unless that folder was externally removed.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/ui/batch-bookmark-operations.test.tsx tests/ui/manager-app.test.tsx tests/ui/organize-view.test.tsx`

Expected: all focused tests PASS, including partial failures and missing original folders.

```bash
git add src/ui/manager/BatchActionBar.tsx src/ui/manager/BookmarkRow.tsx src/ui/manager/BrowseView.tsx src/ui/manager/ManagerApp.tsx src/ui/manager/app.css tests/ui/batch-bookmark-operations.test.tsx tests/ui/manager-app.test.tsx tests/ui/organize-view.test.tsx
git commit -m "feat: add batch bookmark operations"
```

## Task 16: Verify, version, and package V1a.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `release/bookmark-manager-v0.1.0.crx` by replacing it with `release/bookmark-manager-v0.2.0.crx`
- Modify: `tests/e2e/bootstrap.spec.ts`
- Modify: `tests/build/manifest.test.ts`

- [ ] **Step 1: Add integration assertions before the final build**

Extend the real-extension flow to cover folder counts, settings persistence, an externally created bookmark, single edit, confirmed move, same-level reorder with a bookmark between folders, batch quarantine, restore, and a partial conflict. Assert no console errors and no horizontal overflow at 900px and 1440px widths.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm run e2e`.

Expected: every test passes, TypeScript exits 0, Chrome MV3 build succeeds, and browser flows complete without console errors or layout overlap.

- [ ] **Step 3: Set version 0.2.0 and rebuild**

Run: `npm version 0.2.0 --no-git-tag-version`, then `npm test` and `npm run build` again.

Expected: `package.json`, `package-lock.json`, and `.output/chrome-mv3/manifest.json` all report `0.2.0`; all tests still pass.

- [ ] **Step 4: Re-sign CRX3 with the existing private key**

Use Chrome's packer with `.signing/bookmark-manager.pem`, never generating or committing a new key. Verify the CRX header is `Cr24`, version is `3`, the embedded manifest is MV3 version `0.2.0`, and record its SHA256. Remove only the old public CRX artifact after the new one validates; `.signing/` stays ignored.

- [ ] **Step 5: Commit the verified release**

```bash
git add package.json package-lock.json release/bookmark-manager-v0.1.0.crx release/bookmark-manager-v0.2.0.crx tests/e2e/bootstrap.spec.ts tests/build/manifest.test.ts
git commit -m "release: package bookmark manager v0.2.0"
```

## V1b follow-up plan boundary

After V1a is installed and exercised, create a second plan for the independent link-checking subsystem and new-tab build. It must add redirect-hop exclusion, credentials omission, optional host permission states, IndexedDB checkpoints, two-check confirmation, and a static `chrome_url_overrides.newtab` variant. Do not add these capabilities by weakening V1a's operation contracts.
