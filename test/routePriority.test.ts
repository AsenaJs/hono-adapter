import { describe, expect, test } from 'bun:test';
import { compareRoutePriority, segmentScore } from '../lib/utils/routePriority';

describe('segmentScore', () => {
  test('static segment returns 0', () => {
    expect(segmentScore('users')).toBe(0);
    expect(segmentScore('count')).toBe(0);
    expect(segmentScore('api')).toBe(0);
  });

  test('param segment returns 1', () => {
    expect(segmentScore(':id')).toBe(1);
    expect(segmentScore(':name')).toBe(1);
  });

  test('wildcard segment returns 2', () => {
    expect(segmentScore('*')).toBe(2);
  });
});

describe('compareRoutePriority', () => {
  // ── Basic priority: static vs param vs wildcard ──

  test('static before param at same level', () => {
    expect(compareRoutePriority('/users/count', '/users/:id')).toBeLessThan(0);
    expect(compareRoutePriority('/users/:id', '/users/count')).toBeGreaterThan(0);
  });

  test('param before wildcard at same level', () => {
    expect(compareRoutePriority('/static/:file', '/static/*')).toBeLessThan(0);
    expect(compareRoutePriority('/static/*', '/static/:file')).toBeGreaterThan(0);
  });

  test('static before wildcard', () => {
    expect(compareRoutePriority('/api/health', '/api/*')).toBeLessThan(0);
  });

  // ── Same prefix, different endings ──

  test('/api/users/count before /api/users/:id', () => {
    expect(compareRoutePriority('/api/users/count', '/api/users/:id')).toBeLessThan(0);
  });

  test('/api/users/search before /api/users/:id', () => {
    expect(compareRoutePriority('/api/users/search', '/api/users/:id')).toBeLessThan(0);
  });

  test('multiple static routes have equal priority', () => {
    expect(compareRoutePriority('/api/users/count', '/api/users/search')).toBe(0);
  });

  // ── Length-based specificity ──

  test('longer path before shorter when prefixes match', () => {
    expect(compareRoutePriority('/api/users/:id/posts', '/api/users/:id')).toBeLessThan(0);
  });

  test('shorter path after longer', () => {
    expect(compareRoutePriority('/api', '/api/users')).toBeGreaterThan(0);
  });

  // ── Multi-level param comparison ──

  test('segment-by-segment: static segment wins over param at same position', () => {
    // /api/users/:id — 2nd segment static, 3rd param
    // /api/:group/count — 2nd segment param, 3rd static
    // At position 1: "users" (0) vs ":group" (1) → /api/users/:id wins
    expect(compareRoutePriority('/api/users/:id', '/api/:group/count')).toBeLessThan(0);
  });

  // ── Root and edge cases ──

  test('root path / after /api', () => {
    expect(compareRoutePriority('/', '/api')).toBeGreaterThan(0);
  });

  test('identical paths have equal priority', () => {
    expect(compareRoutePriority('/health', '/health')).toBe(0);
    expect(compareRoutePriority('/api/users', '/api/users')).toBe(0);
  });

  test('both param paths have equal priority', () => {
    expect(compareRoutePriority('/users/:id', '/posts/:id')).toBe(0);
  });

  // ── Array.sort() integration ──

  test('sorts mixed routes correctly', () => {
    const paths = [
      '/api/users/:id',
      '/api/users/count',
      '/api/users/search',
      '/api/users',
      '/api/*',
      '/health',
    ];

    const sorted = [...paths].sort(compareRoutePriority);

    // Static and specific routes first, param routes after, wildcard last
    expect(sorted).toEqual([
      '/api/users/count',
      '/api/users/search',
      '/api/users/:id',
      '/api/users',
      '/health',
      '/api/*',
    ]);
  });

  test('sorts DbUserController-like routes correctly', () => {
    const paths = [
      '/api/db-users/',
      '/api/db-users/count',
      '/api/db-users/search',
      '/api/db-users/:id',
      '/api/db-users/bulk',
      '/api/db-users/truncate',
    ];

    const sorted = [...paths].sort(compareRoutePriority);

    // All static routes before /:id
    const idIndex = sorted.indexOf('/api/db-users/:id');
    const countIndex = sorted.indexOf('/api/db-users/count');
    const searchIndex = sorted.indexOf('/api/db-users/search');

    expect(countIndex).toBeLessThan(idIndex);
    expect(searchIndex).toBeLessThan(idIndex);
  });

  test('sorts real-world mixed controller routes', () => {
    const paths = [
      '/api/users/',
      '/api/users/:id',
      '/api/users/count',
      '/api/posts/',
      '/api/posts/:id',
      '/api/posts/trending',
      '/health',
      '/api/*',
    ];

    const sorted = [...paths].sort(compareRoutePriority);

    // /api/* should be last
    expect(sorted[sorted.length - 1]).toBe('/api/*');

    // /count and /trending before their respective /:id
    const usersIdIdx = sorted.indexOf('/api/users/:id');
    const usersCountIdx = sorted.indexOf('/api/users/count');
    const postsIdIdx = sorted.indexOf('/api/posts/:id');
    const postsTrendingIdx = sorted.indexOf('/api/posts/trending');

    expect(usersCountIdx).toBeLessThan(usersIdIdx);
    expect(postsTrendingIdx).toBeLessThan(postsIdIdx);
  });
});