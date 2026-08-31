/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeFramescaperVideoProxyBodyIdentitySequence as normalizeBody,
	normalizeFramescaperVideoProxyOriginalIdentitySequence as normalizeOriginal,
	sameFramescaperVideoProxyBodyIdentitySequence as sameBody,
	sameFramescaperVideoProxyOriginalIdentitySequence as sameOriginal,
} from '../src/framescaper/editor-video-proxy-revalidation-contract-sequence.ts';

type Data = Record<string, unknown>;

const PROXY: Data = Object.freeze({
	role: 'proxy', kind: 'video-proxy', encoding: 'video-proxy-v1',
	storageKey: `video-proxy-sha256:${'ab'.repeat(32)}`,
	mimeType: 'video/mp4', byteLength: 1_024,
	sha256: 'ab'.repeat(32), generationToken: 'generation-1',
});

const TIMING: Data = Object.freeze({
	role: 'timing', kind: 'video-timing', encoding: 'soundscaper-video-timing-v1',
	storageKey: `video-timing-sha256:${'cd'.repeat(32)}`,
	mimeType: 'application/vnd.soundscaper.video-timing', byteLength: 112,
	sha256: 'cd'.repeat(32), generationToken: 'generation-1',
	frameCount: 10, timescale: 1_000, finalFrameDurationTicks: '100',
});

const ORIGINAL: Data = Object.freeze({
	authority: 'owned', projectId: 'project-1', sourceId: 'video-source',
	storageKey: `media-sha256:${'ef'.repeat(32)}`,
	mimeType: 'video/mp4', byteLength: 4_096,
	sha256: 'ef'.repeat(32), generationToken: 'generation-1',
});

test('a proxy body identity normalizes to its closed proxy field set', () => {
	assert.deepEqual(
		Object.keys(normalizeBody(PROXY)),
		['role', 'kind', 'encoding', 'storageKey', 'mimeType', 'byteLength', 'sha256', 'generationToken'],
	);
});

test('a timing body identity carries its own timing fields as well', () => {
	assert.deepEqual(
		Object.keys(normalizeBody(TIMING)),
		[
			'role', 'kind', 'encoding', 'storageKey', 'mimeType', 'byteLength', 'sha256',
			'generationToken', 'frameCount', 'timescale', 'finalFrameDurationTicks',
		],
	);
});

test('a proxy body must declare a video kind, encoding and media type', () => {
	assert.throws(() => normalizeBody({ ...PROXY, kind: 'video-timing' }), TypeError);
	assert.throws(() => normalizeBody({ ...PROXY, encoding: 'video-proxy-v2' }), TypeError);
	assert.throws(() => normalizeBody({ ...PROXY, mimeType: 'text/plain' }), TypeError);
});

test('a timing body is bound to the exact timing encoding and media type', () => {
	assert.throws(() => normalizeBody({ ...TIMING, mimeType: 'video/mp4' }), TypeError);
	assert.throws(() => normalizeBody({ ...TIMING, encoding: 'video-proxy-v1' }), TypeError);
});

test('a body identity refuses a non-positive length or a malformed digest', () => {
	assert.throws(() => normalizeBody({ ...PROXY, byteLength: 0 }), /byteLength must be positive/u);
	assert.throws(() => normalizeBody({ ...PROXY, sha256: 'zz' }), /lowercase SHA-256 digest/u);
});

test('a body identity outside its two known roles is refused', () => {
	assert.throws(() => normalizeBody({ ...PROXY, role: 'something-else' }), TypeError);
});

test('an original identity admits only owned or linked authority', () => {
	assert.equal(normalizeOriginal(ORIGINAL).authority, 'owned');
	assert.equal(normalizeOriginal({ ...ORIGINAL, authority: 'linked' }).authority, 'linked');
	assert.throws(
		() => normalizeOriginal({ ...ORIGINAL, authority: 'inherited' }),
		/original authority is invalid/u,
	);
});

test('identity comparison holds for equal values and separates any difference', () => {
	assert.equal(sameBody(PROXY, { ...PROXY }), true);
	assert.equal(sameBody(PROXY, TIMING), false);
	assert.equal(sameBody(PROXY, { ...PROXY, generationToken: 'generation-2' }), false);
	assert.equal(sameOriginal(ORIGINAL, { ...ORIGINAL }), true);
	assert.equal(sameOriginal(ORIGINAL, { ...ORIGINAL, authority: 'linked' }), false);
});

test('comparing against a value that cannot be normalized is false, never a throw', () => {
	assert.equal(sameBody(PROXY, null), false);
	assert.equal(sameBody(PROXY, { role: 'proxy' }), false);
	assert.equal(sameOriginal(ORIGINAL, null), false);
	assert.equal(sameOriginal(ORIGINAL, 'owned'), false);
});
