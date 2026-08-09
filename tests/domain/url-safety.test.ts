import { describe, expect, it } from 'vitest';

import {
  isDangerousBookmarkUrl,
  validateBookmarkUrl,
} from '../../src/domain/url-safety';

describe('bookmark URL safety', () => {
  it('rejects executable URL schemes case-insensitively', () => {
    expect(isDangerousBookmarkUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousBookmarkUrl(' DATA:text/html,<script>1</script>')).toBe(
      true,
    );
    expect(isDangerousBookmarkUrl('vbscript:msgbox(1)')).toBe(true);
    expect(isDangerousBookmarkUrl('blob:https://example.test/id')).toBe(true);
  });

  it('rejects executable schemes after Chromium URL normalization', () => {
    for (const url of [
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      'java\rscript:alert(1)',
      'java\u0000script:alert(1)',
      ' data\n:text/html,<script>1</script>',
    ]) {
      expect(isDangerousBookmarkUrl(url)).toBe(true);
    }
  });

  it('keeps ordinary, local and custom bookmark URLs available', () => {
    for (const url of [
      'https://example.test',
      'file:///C:/important.html',
      'http://127.0.0.1:3000',
      'http://[::1]:8080',
      'custom-scheme://resource',
      'custom\u0000-scheme://resource',
      'http://localhost:3000/path',
    ]) {
      expect(validateBookmarkUrl(url)).toEqual({ valid: true });
    }
  });
});
