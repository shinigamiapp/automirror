import { describe, expect, it } from 'vitest';
import { ScraperHostPool } from '../src/services/scraper.js';

describe('ScraperHostPool', () => {
  it('round-robins through healthy hosts', () => {
    const pool = new ScraperHostPool(
      ['https://id-1.scraper.shinigami.io', 'https://id-2.scraper.shinigami.io'],
      'round_robin',
      3,
    );

    const first = pool.getRequestOrder()[0].url;
    const second = pool.getRequestOrder()[0].url;

    expect(first).toBe('https://id-1.scraper.shinigami.io');
    expect(second).toBe('https://id-2.scraper.shinigami.io');
  });

  it('marks host unhealthy after configured failures', () => {
    const pool = new ScraperHostPool(['https://id-1.scraper.shinigami.io'], 'round_robin', 3);

    pool.markFailure('https://id-1.scraper.shinigami.io');
    pool.markFailure('https://id-1.scraper.shinigami.io');
    pool.markFailure('https://id-1.scraper.shinigami.io');

    const host = pool.snapshot()[0];
    expect(host.isHealthy).toBe(false);
    expect(host.failures).toBe(3);
  });

  it('fails over to next host when one is unhealthy', () => {
    const pool = new ScraperHostPool(
      ['https://id-1.scraper.shinigami.io', 'https://id-2.scraper.shinigami.io'],
      'round_robin',
      1,
    );

    pool.markFailure('https://id-1.scraper.shinigami.io');
    const order = pool.getRequestOrder().map((host) => host.url);

    expect(order[0]).toBe('https://id-2.scraper.shinigami.io');
  });

  it('resets all hosts when every host is unhealthy', () => {
    const pool = new ScraperHostPool(
      ['https://id-1.scraper.shinigami.io', 'https://id-2.scraper.shinigami.io'],
      'round_robin',
      1,
    );

    pool.markFailure('https://id-1.scraper.shinigami.io');
    pool.markFailure('https://id-2.scraper.shinigami.io');

    const order = pool.getRequestOrder().map((host) => host.url);
    const state = pool.snapshot();

    expect(order).toEqual([
      'https://id-1.scraper.shinigami.io',
      'https://id-2.scraper.shinigami.io',
    ]);
    expect(state.every((host) => host.isHealthy)).toBe(true);
  });
});
