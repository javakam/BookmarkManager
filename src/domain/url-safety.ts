const BLOCKED_PROTOCOLS: ReadonlySet<string> = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
]);

// Chromium strips a few ASCII controls while normalizing a URL. Mirror that
// behavior for the conservative fallback used when URL parsing rejects input.
const BLOCKED_PROTOCOL_PATTERN = /^\s*(?:javascript|data|vbscript|blob)\s*:/iu;
const ASCII_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

/**
 * Bookmark URLs are user data, but opening executable URL schemes from an
 * extension page would give the bookmark an unexpected script execution
 * capability. Keep ordinary browser, file and custom non-executable schemes
 * available while rejecting the schemes that can execute page content.
 */
export function isDangerousBookmarkUrl(url: string): boolean {
  try {
    if (BLOCKED_PROTOCOLS.has(new URL(url).protocol.toLowerCase())) {
      return true;
    }
  } catch {
    // Bookmarks may contain custom or otherwise non-standard URLs. Keep the
    // existing permissive behavior for those while still applying the safety
    // fallback below.
  }

  return BLOCKED_PROTOCOL_PATTERN.test(url.replace(ASCII_CONTROL_CHARACTERS, ''));
}

export function validateBookmarkUrl(url: string):
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string } {
  return isDangerousBookmarkUrl(url)
    ? { valid: false, reason: '不支持保存或打开可执行网址协议' }
    : { valid: true };
}
