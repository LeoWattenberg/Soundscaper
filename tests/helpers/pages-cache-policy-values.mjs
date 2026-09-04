/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two `Cache-Control` values the deploy audits are written against.
 *
 * Both are what a browser is actually handed rather than what `_headers` asks for, which
 * is the distinction the audits exist to hold: the zone rewrites `no-cache` into its own
 * four-hour Browser Cache TTL, and only a content-addressed asset earns the immutable year.
 */

/** What a content-addressed asset is served with, and nothing else may be. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The `Cache-Control` a browser is handed on soundscaper.org where `_headers`
 * says `no-cache`, because the zone carries a four-hour Browser Cache TTL.
 */
export const ZONE_BROWSER_TTL = 'max-age=14400';
