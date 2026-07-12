import { describe, expect, it } from 'vitest';

import {
  getPinyinForms,
  PinyinLruCache,
} from '../../src/domain/pinyin';

describe('getPinyinForms', () => {
  it('reuses the cached result object for the same input', () => {
    const first = getPinyinForms('缓存复用测试');
    const second = getPinyinForms('缓存复用测试');

    expect(first).toEqual({
      full: 'huancunfuyongceshi',
      initials: 'hcfycs',
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toBe(first);
  });

  it('stores a frozen copy so later source changes cannot pollute the cache', () => {
    const cache = new PinyinLruCache(2);
    const source = { full: 'original', initials: 'o' };

    const stored = cache.set('key', source);
    source.full = 'polluted';

    expect(Object.isFrozen(stored)).toBe(true);
    expect(cache.get('key')).toBe(stored);
    expect(cache.get('key')).toEqual({ full: 'original', initials: 'o' });
  });

  it('evicts the least recently used value at its fixed capacity', () => {
    const cache = new PinyinLruCache(2);
    const first = cache.set('first', { full: 'first', initials: 'f' });
    cache.set('second', { full: 'second', initials: 's' });

    expect(cache.get('first')).toBe(first);
    cache.set('third', { full: 'third', initials: 't' });

    expect(cache.size).toBe(2);
    expect(cache.get('first')).toBe(first);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toEqual({ full: 'third', initials: 't' });
  });
});
