import { pinyin } from 'pinyin-pro';

export interface PinyinForms {
  readonly full: string;
  readonly initials: string;
}

export class PinyinLruCache {
  private readonly values = new Map<string, PinyinForms>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Pinyin cache capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.values.size;
  }

  get(key: string): PinyinForms | undefined {
    const value = this.values.get(key);
    if (!value) {
      return undefined;
    }

    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: PinyinForms): PinyinForms {
    const stored = Object.freeze({
      full: value.full,
      initials: value.initials,
    });

    this.values.delete(key);
    this.values.set(key, stored);
    if (this.values.size > this.capacity) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey !== undefined) {
        this.values.delete(oldestKey);
      }
    }
    return stored;
  }
}

const PINYIN_CACHE_CAPACITY = 4_096;
const EMPTY_FORMS: PinyinForms = Object.freeze({ full: '', initials: '' });
const HAN_CHARACTER = /\p{Script=Han}/u;
const pinyinCache = new PinyinLruCache(PINYIN_CACHE_CAPACITY);

function compact(value: readonly string[]): string {
  return value
    .join('')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '');
}

export function getPinyinForms(value: string): PinyinForms {
  const cacheKey = value.normalize('NFKC');
  if (!HAN_CHARACTER.test(cacheKey)) {
    return EMPTY_FORMS;
  }

  const cached = pinyinCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const forms = {
    full: compact(
      pinyin(cacheKey, {
        toneType: 'none',
        type: 'array',
      }),
    ),
    initials: compact(
      pinyin(cacheKey, {
        pattern: 'first',
        toneType: 'none',
        type: 'array',
      }),
    ),
  };

  return pinyinCache.set(cacheKey, forms);
}
