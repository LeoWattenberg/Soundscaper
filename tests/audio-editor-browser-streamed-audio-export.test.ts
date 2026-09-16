/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBrowserAudioFileStreamed } from '../src/common/editor/browser-audio-streamed-encode.ts';
import { createMediaExportCapabilities } from '../src/common/editor/media-export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import type { BrowserAudioEncodeStreamSession } from '../src/common/editor/browser-audio-encode-stream-client.ts';
import type { TemporaryFileSink } from '../src/common/editor/controller/export/temporary-export.ts';

test('streamed compressed export awaits packets, patches its prefix and retains cleanup until publication', async () => {
	const frames = 50_123;
	const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(frames), new Float32Array(frames)], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	const accepted: number[] = [];
	const progress: number[] = [];
	const sink = sinkFixture();
	let closed = false;
	let writing = false;
	const session: BrowserAudioEncodeStreamSession = {
		async write(bytes, count) {
			assert.equal(writing, false);
			writing = true;
			assert.equal(bytes.byteLength, count * 8);
			assert.ok(count <= 16_384);
			await Promise.resolve();
			accepted.push(count);
			writing = false;
			return Uint8Array.of(accepted.length);
		},
		async finish() { return { bytes: Uint8Array.of(9), prefixPatch: Uint8Array.of(7) }; },
		close() { closed = true; },
	};
	const result = await encodeBrowserAudioFileStreamed(wav, 'mp3', { onProgress: (value) => { progress.push(value); } }, createMediaExportCapabilities(), {
		openSession: async () => session, createSink: async () => sink, validateOutput: async () => undefined,
	});
	assert.equal(accepted.reduce((sum, count) => sum + count, 0), frames);
	assert.equal(closed, true);
	assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), Uint8Array.of(7, 2, 3, 4, 9));
	assert.equal(progress[0], 0);
	assert.equal(progress.at(-1), 1);
	assert.equal(sink.removed, false);
	await result.cleanup();
	assert.equal(sink.removed, true);
});

test('cancellation between compressed PCM packets aborts staging and closes the persistent encoder', async () => {
	const abort = new AbortController();
	const frames = 40_000;
	const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(frames)], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	const sink = sinkFixture();
	let closed = false;
	let writes = 0;
	await assert.rejects(encodeBrowserAudioFileStreamed(wav, 'flac', { signal: abort.signal }, createMediaExportCapabilities(), {
		createSink: async () => sink,
		openSession: async () => ({
			async write() { writes++; abort.abort(new DOMException('Cancelled', 'AbortError')); return Uint8Array.of(1); },
			async finish() { throw new Error('Finish must not run after cancellation.'); },
			close() { closed = true; },
		}),
	}), { name: 'AbortError' });
	assert.equal(writes, 1);
	assert.equal(closed, true);
	assert.equal(sink.aborted, true);
});

test('encoded file-byte limits stop staging before the over-budget packet is written', async () => {
	const sink = sinkFixture();
	const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(20_000)], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	await assert.rejects(encodeBrowserAudioFileStreamed(wav, 'mp3', { maximumOutputBytes: 1 }, createMediaExportCapabilities(), {
		createSink: async () => sink,
		openSession: async () => ({
			async write() { return Uint8Array.of(1, 2); },
			async finish() { throw new Error('Finish must not run after refusal.'); },
			close() {},
		}),
	}), /file-byte limit/u);
	assert.equal(sink.parts.length, 0);
	assert.equal(sink.aborted, true);
});

test('a closed but malformed encoded file is refused before publication and staging is removed', async () => {
	const sink = sinkFixture();
	const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(10)], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	await assert.rejects(encodeBrowserAudioFileStreamed(wav, 'mp3', {}, createMediaExportCapabilities(), {
		createSink: async () => sink,
		openSession: async () => ({
			async write() { return Uint8Array.of(1, 2, 3, 4); },
			async finish() { return { bytes: new Uint8Array(), prefixPatch: new Uint8Array() }; }, close() {},
		}),
	}));
	assert.equal(sink.aborted, true);
});

test('cleanup failure preserves the encoder failure as the aggregate cause', async () => {
	const sink = sinkFixture();
	const primary = new Error('Encoder failed.');
	const cleanup = new Error('Removal failed.');
	sink.abort = async () => { throw cleanup; };
	const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(10)], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	await assert.rejects(encodeBrowserAudioFileStreamed(wav, 'mp3', {}, createMediaExportCapabilities(), {
		createSink: async () => sink,
		openSession: async () => { throw primary; },
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});

function sinkFixture(): TemporaryFileSink & { parts: Uint8Array<ArrayBuffer>[]; removed: boolean; aborted: boolean } {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	return {
		persistent: true, parts, removed: false, aborted: false,
		async write(bytes) { parts.push(Uint8Array.from(bytes as Uint8Array)); },
		async writeAt(position, bytes) { assert.equal(position, 0); parts[0]!.set(bytes as Uint8Array); },
		async close(type) { return new Blob(parts, { type }); },
		async remove() { this.removed = true; },
		async abort() { this.aborted = true; },
	};
}
