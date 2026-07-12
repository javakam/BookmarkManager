import type { BrowserBookmarkNode } from '../../domain/bookmarks';

export const BOOKMARK_IDS = {
  root: 'root-node',
  bookmarkBar: 'toolbar-node',
  emptyTitle: 'empty-title-leaf',
  workspace: 'workspace-folder',
  engineering: 'engineering-folder',
  reference: 'reference-folder',
  local: 'local-leaf',
  other: 'other-node',
  file: 'file-leaf',
  managed: 'managed-node',
  managedChild: 'managed-child-folder',
  managedLeaf: 'managed-leaf',
  mobile: 'mobile-node',
} as const;

export const bookmarkTreeFixture: BrowserBookmarkNode[] = [
  {
    id: BOOKMARK_IDS.root,
    title: '',
    children: [
      {
        id: BOOKMARK_IDS.bookmarkBar,
        parentId: BOOKMARK_IDS.root,
        index: 0,
        title: 'Bookmarks Bar',
        folderType: 'bookmarks-bar',
        children: [
          {
            id: BOOKMARK_IDS.emptyTitle,
            parentId: BOOKMARK_IDS.bookmarkBar,
            index: 0,
            title: '',
            url: 'https://favicon-only.example/path',
            dateAdded: 1_700_000_000_000,
          },
          {
            id: BOOKMARK_IDS.workspace,
            parentId: BOOKMARK_IDS.bookmarkBar,
            title: 'Workspace',
            children: [
              {
                id: BOOKMARK_IDS.engineering,
                parentId: BOOKMARK_IDS.workspace,
                index: 0,
                title: 'Engineering',
                children: [
                  {
                    id: BOOKMARK_IDS.reference,
                    parentId: BOOKMARK_IDS.engineering,
                    title: 'Reference',
                    children: [
                      {
                        id: BOOKMARK_IDS.local,
                        parentId: BOOKMARK_IDS.reference,
                        title: 'Local Dashboard',
                        url: 'http://localhost:4173/dashboard',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: BOOKMARK_IDS.other,
        parentId: BOOKMARK_IDS.root,
        title: 'Other Bookmarks',
        folderType: 'other',
        children: [
          {
            id: BOOKMARK_IDS.file,
            parentId: BOOKMARK_IDS.other,
            title: 'Local Notes',
            url: 'file:///C:/Users/example/notes.html',
          },
        ],
      },
      {
        id: BOOKMARK_IDS.managed,
        parentId: BOOKMARK_IDS.root,
        index: 2,
        title: 'Managed Bookmarks',
        folderType: 'managed',
        unmodifiable: 'managed',
        children: [
          {
            id: BOOKMARK_IDS.managedChild,
            parentId: BOOKMARK_IDS.managed,
            title: 'Company',
            children: [
              {
                id: BOOKMARK_IDS.managedLeaf,
                parentId: BOOKMARK_IDS.managedChild,
                title: 'Company Portal',
                url: 'https://intranet.example.test',
              },
            ],
          },
        ],
      },
      {
        id: BOOKMARK_IDS.mobile,
        parentId: BOOKMARK_IDS.root,
        index: 3,
        title: 'Mobile Bookmarks',
        folderType: 'mobile',
        children: [],
      },
    ],
  },
];
