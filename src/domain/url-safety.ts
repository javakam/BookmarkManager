const BLOCKED_PROTOCOL_PATTERN = /^\s*(?:javascript|data|vbscript|blob)\s*:/iu;

/**
 * Bookmark URLs are user data, but opening executable URL schemes from an
 * extension page would give the bookmark an unexpected script execution
 * capability. Keep ordinary browser, file and custom non-executable schemes
 * available while rejecting the schemes that can execute page content.
 */
export function isDangerousBookmarkUrl(url: string): boolean {
  return BLOCKED_PROTOCOL_PATTERN.test(url);
}

export function validateBookmarkUrl(url: string):
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string } {
  return isDangerousBookmarkUrl(url)
    ? { valid: false, reason: '不支持保存或打开可执行网址协议' }
    : { valid: true };
}
