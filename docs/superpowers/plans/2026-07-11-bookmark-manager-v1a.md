# 书签工作台 V1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome/Edge Manifest V3 manager-only extension that reads native bookmarks, provides local fuzzy search and folder browsing, shows duplicate/similar groups, and safely isolates/restores leaf bookmarks with conflict-aware operation records.

**Architecture:** WXT owns the MV3 build and entrypoints. A browser adapter is the only layer allowed to call the bookmarks API; pure domain modules transform a bookmark tree into indexed records, analysis groups, and write plans. React pages consume a typed application store and never mutate browser nodes directly. V1a ships the manager build without `chrome_url_overrides.newtab`; V1b will add link checking and a separate new-tab build after V1a verification.

**Tech Stack:** WXT 0.20.27, React 19.2.7, TypeScript 7.0.2, `fuse.js` 7.4.2, `pinyin-pro` 3.28.1, `lucide-react` 1.24.0, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1, `idb` 8.0.3, `fake-indexeddb` 6.2.5.

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

## V1b follow-up plan boundary

After V1a is installed and exercised, create a second plan for the independent link-checking subsystem and new-tab build. It must add redirect-hop exclusion, credentials omission, optional host permission states, IndexedDB checkpoints, two-check confirmation, and a static `chrome_url_overrides.newtab` variant. Do not add these capabilities by weakening V1a's operation contracts.
