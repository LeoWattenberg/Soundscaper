/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createDeterministicAvFixture,
	deterministicAvMedia,
} from './browser/fixtures/deterministic-av-media.js';

test('deterministic A/V browser fixtures are digest-pinned WebM with video and audio tracks', () => {
	assert.deepEqual(deterministicAvMedia.map(({ id }) => id), [
		'av-landscape-webm-v1',
		'av-portrait-webm-v1',
	]);
	for (const fixture of deterministicAvMedia) {
		assert.equal(fixture.file.mimeType, 'video/webm');
		assert.equal(createHash('sha256').update(fixture.file.buffer).digest('hex'), fixture.sourceSha256);
		assert.deepEqual(fixture.file.buffer.subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
		assert.ok(fixture.file.buffer.includes(Buffer.from('V_VP8')), `${fixture.id} must contain VP8 video`);
		assert.ok(fixture.file.buffer.includes(Buffer.from('A_OPUS')), `${fixture.id} must contain Opus audio`);
		assert.equal(fixture.sampleRate, 48_000);
		assert.ok(fixture.durationSeconds >= 2);
	}
	assert.deepEqual(deterministicAvMedia.map(({ display }) => display), [
		{ width: 96, height: 54 },
		{ width: 54, height: 96 },
	]);
});

test('deterministic A/V fixture factory returns isolated upload buffers and preserves the selected geometry', () => {
	const first = createDeterministicAvFixture('first.webm');
	const second = createDeterministicAvFixture('second.webm');
	const portrait = createDeterministicAvFixture('portrait.webm', { variant: 'portrait' });

	assert.deepEqual(Object.keys(first).sort(), ['buffer', 'mimeType', 'name']);
	assert.equal(first.name, 'first.webm');
	assert.equal(portrait.name, 'portrait.webm');
	assert.notStrictEqual(first.buffer, second.buffer);
	assert.deepEqual(first.buffer, second.buffer);
	assert.notDeepEqual(first.buffer, portrait.buffer);
	first.buffer[0] = 0;
	assert.equal(second.buffer[0], 0x1a);
	assert.throws(
		() => createDeterministicAvFixture('unknown.webm', { variant: 'square' }),
		/Unknown deterministic A\/V fixture variant/u,
	);
});
