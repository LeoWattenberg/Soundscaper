/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeDesktopAudioStreamFile, encodeDesktopAudioStreamToSink, withDesktopAudioStreamOwnership } from '../src/common/editor/desktop-audio-stream-encoder.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { admitAudioExportBlob } from '../src/common/editor/audio-export-output.ts';

const frames = 40_000; const operationId = `desktop-audio-stream-${'a'.repeat(32)}`;
const encoded = new Uint8Array(Math.ceil(frames / 1152) * 576);
for (let offset = 0; offset < encoded.length; offset += 576) encoded.set([0xff, 0xfd, 0xa4, 0], offset);
const file = new Blob([Uint8Array.from(encodeWav([new Float32Array(frames), new Float32Array(frames)], { sampleRate: 48000, bitDepth: 32, float: true }))]);

test('desktop encoder stages bounded PCM, validates file ranges, and retains spool until explicit cleanup', async () => {
	let offset = 0; let largest = 0; let deletes = 0;
	const result = await encodeDesktopAudioStreamFile({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
	}, (command) => {
		if (command.type === 'begin') return { operationId };
		if (command.type === 'write') { assert.equal(command.offset, offset); largest = Math.max(largest, command.bytes.length); offset += command.bytes.length; return { offset }; }
		if (command.type === 'execute') return { byteLength: encoded.length };
		if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
		if (command.type === 'delete') { deletes++; return true; }
		throw new Error('unexpected command');
	});
	assert.equal(offset, frames * 8); assert.equal(largest, 16384 * 8); assert.equal(result.bytes, null);
	assert.equal(result.blob.size, encoded.length); assert.equal(admitAudioExportBlob(result.blob), result.blob); assert.equal(deletes, 0);
	assert.deepEqual(new Uint8Array(await result.blob.slice(0, 4).arrayBuffer()), encoded.slice(0, 4));
	await result.cleanup(); await result.cleanup(); assert.equal(deletes, 1);
	await assert.rejects(() => result.blob.slice(0, 4).arrayBuffer(), /released/u);
});

test('desktop encoder refuses truncated codec output and deletes owned native spool', async () => {
	let deletes = 0;
	await assert.rejects(() => encodeDesktopAudioStreamFile({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
	}, (command) => {
		if (command.type === 'begin') return { operationId };
		if (command.type === 'write') return { offset: command.offset + command.bytes.length };
		if (command.type === 'execute') return { byteLength: encoded.length - 1 };
		if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
		if (command.type === 'delete') { deletes++; return true; }
		throw new Error('unexpected command');
	}), /truncated/u);
	assert.equal(deletes, 1);
});

test('native stream work remains owned until abort cleanup settles and then leaves the active runtime map', async () => {
	const active = new Map<string, { cancel(reason: unknown): void }>(); const parent = new AbortController();
	let received: AbortSignal | null = null; let finish!: () => void; let settled = false;
	const reason = new Error('desktop codec runtime disposed');
	const operation = withDesktopAudioStreamOwnership({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: { signal: parent.signal },
	}, 'owned-stream', active, async (request) => {
		received = request.settings.signal!;
		await new Promise<void>((resolve) => { finish = resolve; });
		if (received.aborted) throw received.reason; return true;
	});
	void operation.catch(() => { settled = true; });
	assert.equal(active.size, 1); active.get('owned-stream')!.cancel(reason);
	assert.equal(received!.aborted, true); assert.equal(received!.reason, reason); assert.equal(settled, false); assert.equal(active.size, 1);
	finish(); await assert.rejects(operation, (error: unknown) => error === reason); assert.equal(active.size, 0);
});

test('destination failure remains the primary cause when native spool cleanup also fails', async () => {
	const writeError = new Error('destination write failed'); const cleanupError = new Error('native cleanup failed'); let aborts = 0;
	await assert.rejects(() => encodeDesktopAudioStreamToSink({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
	}, (command) => {
		if (command.type === 'begin') return { operationId };
		if (command.type === 'write') return { offset: command.offset + command.bytes.length };
		if (command.type === 'execute') return { byteLength: encoded.length };
		if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
		if (command.type === 'delete') throw cleanupError;
		throw new Error('unexpected command');
	}, { async open() {}, async write() { throw writeError; }, async close() { throw new Error('must not close'); }, async abort() { aborts++; } }),
	(error: unknown) => error instanceof AggregateError && error.cause === writeError
		&& error.errors[0] === writeError && error.errors[1] === cleanupError);
	assert.equal(aborts, 1);
});

test('native spool cleanup can retry after a failed removal and keeps output reads revoked', async () => {
	let deletes = 0;
	const result = await encodeDesktopAudioStreamFile({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
	}, (command) => {
		if (command.type === 'begin') return { operationId };
		if (command.type === 'write') return { offset: command.offset + command.bytes.length };
		if (command.type === 'execute') return { byteLength: encoded.length };
		if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
		if (command.type === 'delete') { deletes++; if (deletes === 1) throw new Error('scratch removal failed'); return true; }
		throw new Error('unexpected command');
	});
	await assert.rejects(() => result.cleanup(), /scratch removal failed/u);
	await assert.rejects(() => result.blob.slice(0, 4).arrayBuffer(), /released/u);
	await result.cleanup(); assert.equal(deletes, 2);
});

test('native sink encoding accepts local progress callbacks and maps the output chunk bound', async () => {
	const progress: number[] = []; let largest = 0; let chunks = 0;
	const result = await encodeDesktopAudioStreamToSink({ file,
		plan: { schemaVersion: 1, frameCount: frames, maximumOutputBytes: encoded.length,
			tuple: { operation: 'audio-encode', format: 'mp2', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg',
		settings: { maximumOutputChunkBytes: 1024, onProgress(value) { progress.push(value); } },
	}, (command) => {
		if (command.type === 'begin') return { operationId };
		if (command.type === 'write') return { offset: command.offset + command.bytes.length };
		if (command.type === 'execute') return { byteLength: encoded.length };
		if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
		if (command.type === 'delete') return true;
		throw new Error('unexpected command');
	}, { async open() {}, async write(chunk) { largest = Math.max(largest, chunk.length); chunks++; }, async close() { return 'saved'; }, async abort() { throw new Error('must not abort'); } });
	assert.equal(result.output, 'saved'); assert.equal(largest, 1024); assert.equal(result.chunkCount, chunks); assert.deepEqual(progress, [1]);
});
