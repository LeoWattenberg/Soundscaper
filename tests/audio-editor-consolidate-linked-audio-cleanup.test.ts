/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { consolidateLinkedAudioCache, type ConsolidateAudioCacheStore } from '../src/common/editor/controller/document/internal/native-project/consolidate-linked-audio-cache.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const source = Object.freeze({ id: 'linked', storageKey: 'cache', frameCount: 4, chunkFrames: 2, channelCount: 1, sampleRate: 48_000 });
const samples = Float32Array.of(0.25, -0.5, 0.125, 0);
const original = new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true, dither: false })).buffer]);

test('linked audio write and abort failures retain the primary failure and attempted cleanup', async () => {
	const primary = new Error('Linked PCM write failed.'), cleanup = new Error('Linked PCM abort failed.');
	const events: string[] = [];
	const store: ConsolidateAudioCacheStore = { beginSourceWrite: async () => ({
		write: async () => { events.push('write'); throw primary; },
		commit: async () => { events.push('commit'); },
		abort: async () => { events.push('abort'); throw cleanup; },
	}) };
	await assert.rejects(consolidateLinkedAudioCache(store, source, original), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [primary, cleanup]);
		assert.strictEqual(error.cause, primary);
		return true;
	});
	assert.deepEqual(events, ['write', 'abort']);
});

test('linked audio commit failure keeps its identity when abort succeeds', async () => {
	const primary = new Error('Linked PCM commit failed.'); let aborted = 0;
	const store: ConsolidateAudioCacheStore = { beginSourceWrite: async () => ({
		write: async () => {}, commit: async () => { throw primary; }, abort: async () => { aborted += 1; },
	}) };
	await assert.rejects(consolidateLinkedAudioCache(store, source, original), (error: unknown) => error === primary);
	assert.equal(aborted, 1);
});

test('successful linked PCM consolidation commits exact chunks as required WavPack without aborting', async () => {
	const received: number[] = []; let commits = 0; let aborts = 0;
	const store: ConsolidateAudioCacheStore = { beginSourceWrite: async (id, settings) => {
		assert.equal(id, 'cache'); assert.equal(settings.pcmEncodingPolicy, 'wavpack-required');
		return { write: async (channels) => { received.push(...channels[0]!); },
			commit: async (metadata) => { assert.strictEqual(metadata, source); commits += 1; }, abort: async () => { aborts += 1; } };
	} };
	await consolidateLinkedAudioCache(store, source, original);
	assert.deepEqual(received, [...samples]); assert.equal(commits, 1); assert.equal(aborts, 0);
});
