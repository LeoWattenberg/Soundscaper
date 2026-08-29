/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The canonical JSON the release and payload tooling hashes.
 *
 * These serializers exist so that the same value produces the same bytes, and
 * so the same digest, on every machine that runs the tooling. Ordering keys by
 * host collation breaks exactly that: it compares letters case-insensitively
 * first, so `audioX` precedes `audiob` by code unit and follows it by locale,
 * and a pinned digest computed on one host stops verifying on another.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJsonDocument as releaseCanonicalJson } from '../scripts/lib/canonical-json.mjs';
import { canonicalJson as manifestCanonicalJson } from '../scripts/lib/verified-manifest-helpers.mjs';
import { canonicalJson as hostBuildCanonicalJson } from '../scripts/lib/framescaper-media-host-build.mjs';
import { canonicalJson as provenanceCanonicalJson } from '../scripts/docs-ai/provenance.mjs';

const DIVERGENT = Object.freeze({ audiob: 1, audioX: 2 });

test('host collation and code-unit order genuinely disagree on these keys', () => {
	assert.ok('audioX' < 'audiob');
	assert.equal(Math.sign('audioX'.localeCompare('audiob')), 1,
		'if this ever agrees the hazard is gone, not the requirement');
});

test('every canonical serializer orders object keys by code unit', () => {
	const expected = '{"audioX":2,"audiob":1}';
	assert.equal(releaseCanonicalJson(DIVERGENT).trimEnd(), expected);
	assert.equal(manifestCanonicalJson(DIVERGENT), expected);
	assert.equal(hostBuildCanonicalJson(DIVERGENT), expected);
	assert.equal(provenanceCanonicalJson(DIVERGENT), expected);
});

test('the serializers agree on nested values, arrays and primitives', () => {
	const value = {
		zeta: [1, 'two', null, { bK: true, ba: false }],
		alpha: { nested: { Y: 0, x: -1 } },
		'': 'empty key',
	};
	const expected = manifestCanonicalJson(value);
	assert.equal(releaseCanonicalJson(value).trimEnd(), expected);
	assert.equal(hostBuildCanonicalJson(value), expected);
	assert.equal(provenanceCanonicalJson(value), expected);
	assert.deepEqual(JSON.parse(expected), value, 'canonical bytes must still parse back to the value');
});
