/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTransientAnalysisPcmAccess,
	type TransientAnalysisPcmSource,
} from '../src/common/editor/controller/transient-analysis-pcm-access.ts';

const DIRECT_SHA256 = 'cd'.repeat(32);

test('canonical PCM digest streams the full immutable source once per project/source authority', async () => {
	const fixture = pcmFixture();
	const access = createTransientAnalysisPcmAccess({ store: fixture.store });

	const [first, shared] = await Promise.all([
		access.resolveSourceSha256('project-a', fixture.source, new AbortController().signal),
		access.resolveSourceSha256('project-a', fixture.source, new AbortController().signal),
	]);
	const memoized = await access.resolveSourceSha256(
		'project-a', fixture.source, new AbortController().signal,
	);
	const otherProject = await access.resolveSourceSha256(
		'project-b', fixture.source, new AbortController().signal,
	);

	assert.match(first, /^[a-f0-9]{64}$/u);
	assert.equal(shared, first);
	assert.equal(memoized, first);
	assert.equal(otherProject, first);
	assert.equal(fixture.streamReads, 2, 'one streaming digest per project/source authority');
	access.dispose();
});

test('verified project digest is a direct fast path without touching PCM storage', async () => {
	const fixture = pcmFixture({ contentSha256: DIRECT_SHA256 });
	const access = createTransientAnalysisPcmAccess({ store: fixture.store });

	assert.equal(await access.resolveSourceSha256(
		'project-a', fixture.source, new AbortController().signal,
	), DIRECT_SHA256);
	assert.equal(fixture.streamReads, 0);
	access.dispose();
});

test('digest rejects storage generation replacement and does not memoize the failure', async () => {
	const fixture = pcmFixture();
	const access = createTransientAnalysisPcmAccess({ store: fixture.store });
	fixture.replaceMetadataAfterStream = true;

	await assert.rejects(
		access.resolveSourceSha256('project-a', fixture.source, new AbortController().signal),
		/source PCM generation changed while its digest was resolved/iu,
	);
	fixture.replaceMetadataAfterStream = false;
	assert.match(await access.resolveSourceSha256(
		'project-a', fixture.source, new AbortController().signal,
	), /^[a-f0-9]{64}$/u);
	assert.equal(fixture.streamReads, 2);
	access.dispose();
});

test('bounded range reading opens only intersecting exact-generation chunks', async () => {
	const fixture = pcmFixture();
	const access = createTransientAnalysisPcmAccess({ store: fixture.store, maximumRangePcmBytes: 64 });

	const channels = await access.readSourceRange(
		fixture.source,
		{ startFrame: 3, endFrame: 7 },
		new AbortController().signal,
	);

	assert.deepEqual(fixture.randomReads, [0, 1]);
	assert.deepEqual([...channels[0]!], [3, 4, 5, 6]);
	assert.deepEqual([...channels[1]!], [103, 104, 105, 106]);
	assert.equal(fixture.sessionReleases, 1);
	assert.equal(fixture.expectedMetadata, fixture.metadata);
	access.dispose();
});

test('range reading fails before opening storage when its exact planar allocation exceeds the bound', async () => {
	const fixture = pcmFixture();
	const access = createTransientAnalysisPcmAccess({ store: fixture.store, maximumRangePcmBytes: 31 });

	await assert.rejects(
		access.readSourceRange(
			fixture.source,
			{ startFrame: 3, endFrame: 7 },
			new AbortController().signal,
		),
		/transient analysis PCM range exceeds the 31-byte bound/iu,
	);
	assert.deepEqual(fixture.randomReads, []);
	assert.equal(fixture.sessionReleases, 0);
	access.dispose();
});

function pcmFixture(overrides: Readonly<{ contentSha256?: string }> = {}) {
	const source = Object.freeze({
		id: 'source-a', storageKey: 'stored-source-a', kind: 'audio',
		frameCount: 10, channelCount: 2, chunkFrames: 4, sampleRate: 48_000,
		...(overrides.contentSha256 ? { contentSha256: overrides.contentSha256 } : {}),
	}) satisfies TransientAnalysisPcmSource;
	const chunks = [
		chunk(0, [0, 1, 2, 3], [100, 101, 102, 103]),
		chunk(1, [4, 5, 6, 7], [104, 105, 106, 107]),
		chunk(2, [8, 9], [108, 109]),
	];
	const fixture = {
		source,
		metadata: Object.freeze({
			id: source.storageKey, storage: 'indexeddb', sourceToken: 'generation-a',
			frameCount: source.frameCount, channelCount: source.channelCount,
			chunkFrames: source.chunkFrames, sampleRate: source.sampleRate,
		}),
		streamReads: 0,
		randomReads: [] as number[],
		sessionReleases: 0,
		expectedMetadata: null as unknown,
		replaceMetadataAfterStream: false,
		store: null as unknown as Parameters<typeof createTransientAnalysisPcmAccess>[0]['store'],
	};
	fixture.store = {
		async getSourceMetadata() {
			if (fixture.replaceMetadataAfterStream && fixture.streamReads > 0) {
				return { ...fixture.metadata, sourceToken: 'generation-b' };
			}
			return fixture.metadata;
		},
		async *readSourceChunks() {
			fixture.streamReads += 1;
			for (const value of chunks) yield value;
		},
		async openSourceReadSession(_storageKey, options) {
			fixture.expectedMetadata = options?.expectedSource;
			return {
				async chunk(index) {
					fixture.randomReads.push(index);
					const value = chunks[index];
					if (!value) throw new RangeError('missing fixture chunk');
					return value;
				},
				async release() { fixture.sessionReleases += 1; },
			};
		},
	};
	return fixture;
}

function chunk(index: number, left: readonly number[], right: readonly number[]) {
	return Object.freeze({
		index,
		frames: left.length,
		channels: Object.freeze([Float32Array.from(left), Float32Array.from(right)]),
	});
}
