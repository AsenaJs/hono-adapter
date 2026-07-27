/**
 * Route priority sorting for Hono adapter.
 *
 * Hono matches routes in registration order — the first matching route wins.
 * This utility sorts routes so that more specific (static) paths are registered
 * before less specific (param, wildcard) paths, following the industry-standard
 * priority hierarchy used by Fastify's find-my-way radix tree router.
 *
 * Priority hierarchy (highest to lowest):
 * 1. Static segments (/count, /search)
 * 2. Parametric segments (/:id, /:name)
 * 3. Wildcard segments (/*, /**)
 * 4. Longer (more specific) paths before shorter ones
 *
 * @see https://github.com/delvedor/find-my-way — Fastify's router priority algorithm
 */

/**
 * Returns a priority score for a single path segment.
 *
 * @param segment - A single path segment (between slashes)
 * @returns 0 for static, 1 for param, 2 for wildcard
 */
export function segmentScore(segment: string): number {
  if (segment === '*' || segment.includes('*')) return 2;

  if (segment.startsWith(':')) return 1;

  return 0;
}

/**
 * Compares two route paths for registration priority.
 *
 * Returns negative if `a` should be registered before `b` (higher priority),
 * positive if `b` should be registered before `a`,
 * 0 if they have equal priority.
 *
 * @param pathA - First route path
 * @param pathB - Second route path
 * @returns Comparison result for Array.sort()
 *
 * @example
 * ```typescript
 * routes.sort((a, b) => compareRoutePriority(a.path, b.path));
 * ```
 */
export function compareRoutePriority(pathA: string, pathB: string): number {
  const segA = pathA.split('/').filter(Boolean);
  const segB = pathB.split('/').filter(Boolean);

  // Wildcard paths always go last — a path containing * is less specific than any non-wildcard path
  const aHasWildcard = segA.some((s) => s === '*' || s.includes('*'));
  const bHasWildcard = segB.some((s) => s === '*' || s.includes('*'));

  if (aHasWildcard && !bHasWildcard) return 1;
  if (!aHasWildcard && bHasWildcard) return -1;

  // Segment-by-segment comparison
  const maxLen = Math.max(segA.length, segB.length);

  for (let i = 0; i < maxLen; i++) {
    const a = segA[i];
    const b = segB[i];

    // One path ran out of segments — longer path is more specific, goes first
    if (!a && b) return 1;
    if (a && !b) return -1;

    const scoreA = segmentScore(a);
    const scoreB = segmentScore(b);

    // Different segment types at this position — lower score wins
    if (scoreA !== scoreB) return scoreA - scoreB;
  }

  // Identical priority — maintain original order (stable sort)
  return 0;
}
