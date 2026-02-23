import { describe, expect, it } from 'vitest';
import { replaceHostnameOnly } from '../src/db/repositories/manga.js';

describe('Domain migration helpers', () => {
  it('only replaces hostname and keeps path/query intact', () => {
    const oldUrl = 'https://apkomik.cc/manga/apkomik.cc-special?redirect=apkomik.cc#apkomik.cc';
    const newUrl = replaceHostnameOnly(oldUrl, 'apkomik.cc', 'apkomik.id');

    expect(newUrl).toBe('https://apkomik.id/manga/apkomik.cc-special?redirect=apkomik.cc#apkomik.cc');
  });

  it('does not change URL when hostname does not match', () => {
    const oldUrl = 'https://komikcast.fit/series/magic-emperor';
    const newUrl = replaceHostnameOnly(oldUrl, 'apkomik.cc', 'apkomik.id');

    expect(newUrl).toBe(oldUrl);
  });

  it('preserves port and protocol while changing hostname', () => {
    const oldUrl = 'http://apkomik.cc:8080/manga/magic-emperor';
    const newUrl = replaceHostnameOnly(oldUrl, 'apkomik.cc', 'apkomik.id');

    expect(newUrl).toBe('http://apkomik.id:8080/manga/magic-emperor');
  });
});
