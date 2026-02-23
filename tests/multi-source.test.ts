import { describe, expect, it } from 'vitest';
import { createMangaSchema, updateMangaSchema } from '../src/schemas/manga.js';
import { extractDomainAndSlug, normalizeSourceUrls } from '../src/db/repositories/manga.js';

describe('Multi-source manga schema', () => {
  it('accepts 1-3 source URLs on create', () => {
    const parsed = createMangaSchema.parse({
      manga_id: 'magic-emperor',
      source_urls: [
        'https://apkomik.cc/manga/magic-emperor',
        'https://komikcast.fit/series/magic-emperor',
      ],
      series_title: 'Magic Emperor',
    });

    expect(parsed.source_urls).toHaveLength(2);
  });

  it('rejects more than 3 source URLs on create', () => {
    expect(() => createMangaSchema.parse({
      manga_id: 'magic-emperor',
      source_urls: [
        'https://a.example/manga/1',
        'https://b.example/manga/1',
        'https://c.example/manga/1',
        'https://d.example/manga/1',
      ],
      series_title: 'Magic Emperor',
    })).toThrow();
  });

  it('allows replacing source URLs on update', () => {
    const parsed = updateMangaSchema.parse({
      source_urls: ['https://apkomik.cc/manga/magic-emperor'],
    });

    expect(parsed.source_urls).toEqual(['https://apkomik.cc/manga/magic-emperor']);
  });
});

describe('Multi-source helpers', () => {
  it('deduplicates identical source URLs', () => {
    const normalized = normalizeSourceUrls([
      'https://apkomik.cc/manga/magic-emperor',
      'https://apkomik.cc/manga/magic-emperor',
      'https://komikcast.fit/series/magic-emperor',
    ]);

    expect(normalized).toHaveLength(2);
  });

  it('extracts domain and slug correctly', () => {
    const parsedA = extractDomainAndSlug('https://apkomik.cc/manga/magic-emperor/');
    const parsedB = extractDomainAndSlug('https://komikcast.fit/series/magic-emperor');

    expect(parsedA).toEqual({ domain: 'apkomik.cc', slug: 'magic-emperor' });
    expect(parsedB).toEqual({ domain: 'komikcast.fit', slug: 'magic-emperor' });
  });
});
