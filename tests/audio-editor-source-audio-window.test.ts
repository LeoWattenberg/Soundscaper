/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSourceEditorAudioWindow } from '../src/common/editor/controller/effects/internal/source-editor-audio-window.ts';

const source = { id: 'source', storageKey: 'stored', frameCount: 1_000_000, channelCount: 1, sampleRate: 48_000 };

test('source zoom reads only the requested native samples and releases its storage session', async () => {
	const reads: number[] = [];
	let releases = 0;
	const store = {
		getSourceMetadata: async () => ({ chunkFrames: 4 }),
		readSourceChunk: () => { throw new Error('Expected an owned read session.'); },
		openSourceReadSession: async () => ({
			chunk: async (index: number) => { reads.push(index); return { channels: [Float32Array.from({ length: 4 }, (_, offset) => index * 4 + offset)] }; },
			release: async () => { releases += 1; },
		}),
	};
	const result = await loadSourceEditorAudioWindow(source, { startFrame: 9, endFrame: 15 }, { store });
	assert.deepEqual(result, { sourceId: 'source', startFrame: 9, endFrame: 15, channels: [Float32Array.of(9, 10, 11, 12, 13, 14)] });
	assert.deepEqual(reads, [2, 3]);
	assert.equal(releases, 1);
});

test('source zoom clamps media bounds, rejects invalid ranges, and limits PCM allocation', async () => {
	const buffer = { length: 12, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => Float32Array.from({ length: 12 }, (_, index) => index) };
	const result = await loadSourceEditorAudioWindow({ ...source, frameCount: 12 }, { startFrame: 9, endFrame: 12 }, { buffer });
	assert.deepEqual(result?.channels[0], Float32Array.of(9, 10, 11));
	assert.equal(await loadSourceEditorAudioWindow(source, { startFrame: 0, endFrame: source.frameCount }, {}), null);
	await assert.rejects(loadSourceEditorAudioWindow(source, { startFrame: 10, endFrame: 9 }, {}), /range/i);
	await assert.rejects(loadSourceEditorAudioWindow(source, { startFrame: 0, endFrame: Number.NaN }, {}), /range/i);
});

test('cancelled source zoom never starts a read and failed reads release their session', async () => {
	const abort = new AbortController(); abort.abort();
	await assert.rejects(loadSourceEditorAudioWindow(source, { startFrame: 0, endFrame: 5, signal: abort.signal }, {}), { name: 'AbortError' });
	let released = false;
	const store = {
		getSourceMetadata: async () => ({ chunkFrames: 4 }), readSourceChunk: () => null,
		openSourceReadSession: async () => ({ chunk: async () => { throw new Error('Read failed'); }, release: async () => { released = true; } }),
	};
	await assert.rejects(loadSourceEditorAudioWindow(source, { startFrame: 0, endFrame: 5 }, { store }), /Read failed/);
	assert.equal(released, true);
});
