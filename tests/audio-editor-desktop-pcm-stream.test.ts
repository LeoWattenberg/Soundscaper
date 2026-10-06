/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudioCodecRuntime } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { encodeDesktopAudioStreamFile } from '../src/common/editor/desktop-audio-stream-encoder.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { DesktopAudioStreamCommand } from '../desktop/desktop-audio-stream-contract.ts';

const frames = 40_000;
const operationId = `desktop-audio-stream-${'c'.repeat(32)}`;
const encoded = new Uint8Array(Math.ceil(frames / 1152) * 576);
for (let offset = 0; offset < encoded.length; offset += 576) encoded.set([0xff, 0xfd, 0xa4, 0], offset);
const plan = { schemaVersion: 1 as const, frameCount: frames, maximumOutputBytes: encoded.length,
	tuple: { operation: 'audio-encode' as const, format: 'mp2' as const, sampleRate: 48000,
		channelCount: 2, settings: { bitrateKbps: 192 } } };
const settings = { sampleRate: 48000, inputChannelCount: 2, channelCount: 2, channelMapping: 'preserve', bitRate: 192 };
function bridge(writes: Uint8Array[], afterWrite: () => void = () => undefined) {
	let offset = 0; let deletes = 0; let executing = 0;
	return {
		get deletes() { return deletes; }, get executing() { return executing; },
		async stream(command: DesktopAudioStreamCommand): Promise<unknown> {
			if (command.type === 'begin') return { operationId };
			if (command.type === 'write') { assert.equal(command.offset, offset); writes.push(command.bytes.slice()); offset += command.bytes.length; afterWrite(); return { offset }; }
			if (command.type === 'execute') { executing++; return { byteLength: encoded.length }; }
			if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
			if (command.type === 'delete') { deletes++; return true; }
			throw new Error('unexpected command');
		},
	};
}
function samples() {
	const channels = [new Float32Array(frames), new Float32Array(frames)];
	for (let channel = 0; channel < 2; channel++) for (let index = 0; index < frames; index++) channels[channel]![index] = Math.sin(index * 0.17 + channel) * 1.25;
	channels[0]!.set([-0, 2 ** -149, -(2 ** -149), NaN, Infinity, -Infinity], 127);
	return channels;
}

test('direct PCM packets equal float WAV staging bytes across arbitrary producer blocks and coalesce render quanta', async () => {
	const channels = samples(); const baselineWrites: Uint8Array[] = []; const directWrites: Uint8Array[] = [];
	const file = new Blob([Uint8Array.from(encodeWav(channels, { sampleRate: 48000, bitDepth: 32, float: true }))]);
	const common = { plan, channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {} };
	const oldResult = await encodeDesktopAudioStreamFile({ ...common, file }, bridge(baselineWrites).stream);
	const native = bridge(directWrites);
	const result = await encodeDesktopAudioStreamFile({ ...common, async producePcm(write) {
		for (let first = 0; first < frames; first += 128) await write(channels.map((channel) => channel.subarray(first, Math.min(frames, first + 128))));
	} }, native.stream);
	assert.equal(directWrites.length, 3); assert.equal(directWrites[0]!.length, 16384 * 8);
	assert.deepEqual(Buffer.concat(directWrites), Buffer.concat(baselineWrites));
	assert.equal(native.deletes, 0); await result.cleanup(); await oldResult.cleanup(); assert.equal(native.deletes, 1);
});

test('direct PCM stream rejects incomplete or excess geometry before execute and keeps acknowledgement cancellation fenced', async () => {
	for (const emitted of [frames - 1, frames + 1]) {
		const native = bridge([]);
		await assert.rejects(() => encodeDesktopAudioStreamFile({ plan, channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
			async producePcm(write) { await write([new Float32Array(emitted), new Float32Array(emitted)]); },
		}, native.stream), /frame count/u);
		assert.equal(native.executing, 0); assert.equal(native.deletes, 1);
	}
	const controller = new AbortController(); const reason = new Error('export replaced'); const writes: Uint8Array[] = [];
	const native = bridge(writes, () => controller.abort(reason));
	await assert.rejects(() => encodeDesktopAudioStreamFile({ plan, channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: { signal: controller.signal },
		async producePcm(write) { await write(samples()); },
	}, native.stream), (error: unknown) => error === reason);
	assert.equal(writes.length, 1); assert.equal(native.executing, 0); assert.equal(native.deletes, 1);
});

test('prepared desktop PCM streaming admits exact bundled float geometry only and remains single use', async () => {
	for (const provider of ['bundled', 'external-ffmpeg'] as const) {
		const native = bridge([]); let queries = 0;
		const runtime = createDesktopAudioCodecRuntime({ ...native, async capabilities(query) {
			queries++; return { schemaVersion: 2, capabilities: query.operations.map((tuple) => ({ ...tuple, available: true, provider, reason: null })) };
		}, execute() { throw new Error('must not buffer whole PCM'); }, cancel() {} });
		const prepared = await runtime.preparePcmStream({ frameCount: frames, channelCount: 2, sampleRate: 48000 }, 'mp2', settings);
		assert.equal(queries, 1); assert.equal(Boolean(prepared), provider === 'bundled');
		if (prepared) {
			const result = await prepared.encode(async (write) => { await write(samples()); }); await result.cleanup!();
			await assert.rejects(() => prepared.encode(async () => undefined), /consumed/u);
		}
		assert.equal(await runtime.preparePcmStream({ frameCount: frames, channelCount: 2, sampleRate: 48000 }, 'flac', { ...settings, bitDepth: 24, compressionLevel: 5 }), null);
		await assert.rejects(() => runtime.preparePcmStream({ frameCount: frames, channelCount: 2, sampleRate: 48000 }, 'mp2', { ...settings, sampleRate: 44100 }), /geometry/u);
	}
});

test('a producer that returns before its packet acknowledgement is drained before native cleanup', async () => {
	const native = bridge([]); let settle!: () => void; let acknowledged = false; let deleted = false;
	const stream = async (command: DesktopAudioStreamCommand): Promise<unknown> => {
		if (command.type === 'write') { await new Promise<void>((resolve) => { settle = resolve; }); acknowledged = true; }
		if (command.type === 'delete') { assert.equal(acknowledged, true); deleted = true; }
		return await native.stream(command);
	};
	const exporting = encodeDesktopAudioStreamFile({ plan, channelMapping: 'preserve', extension: '.mp2', mimeType: 'audio/mpeg', settings: {},
		async producePcm(write) { void write([new Float32Array(16384), new Float32Array(16384)]); },
	}, stream);
	void exporting.catch(() => undefined);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(deleted, false); settle();
	await assert.rejects(exporting, /await each write acknowledgement/u);
	assert.equal(deleted, true); assert.equal(native.executing, 0);
});
