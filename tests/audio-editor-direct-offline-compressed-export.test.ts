/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeDirectOfflineCompressed } from '../src/common/editor/controller/direct-offline-compressed-export.ts';
import {
	prepareDirectCompressedDestination,
	type DirectCompressedDestination,
	type DirectCompressedFormat,
} from '../src/common/editor/controller/direct-compressed-export.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';

const FORMATS: readonly Readonly<{
	format: DirectCompressedFormat;
	options: Readonly<Record<string, unknown>>;
}>[] = Object.freeze([
	{ format: 'mp3', options: { bitRate: 320 } },
	{ format: 'flac', options: { sampleFormat: 'int16', dither: 'triangular-highpass' } },
	{ format: 'ogg-vorbis', options: { quality: 7 } },
	{ format: 'opus', options: { bitRate: 192 } },
	{ format: 'wavpack', options: { sampleFormat: 'int24', dither: 'triangular' } },
	{ format: 'wavpack', options: { sampleFormat: 'float32', dither: 'triangular-highpass' } },
	{ format: 'mp2', options: { bitRate: 384 } },
	{ format: 'aac-m4a', options: { bitRate: 256 } },
]);

test('offline compressed staging preserves input PCM and exact format dither ownership', async () => {
	for (const entry of FORMATS) {
		const plan = offlinePlan(entry.format, entry.options);
		const evidence = await fixture(plan);
		const channels = renderedChannels(Number(plan.encoding.inputChannelCount), plan.outputFrames);
		const output = await encodeDirectOfflineCompressed({
			assertCurrent: () => { evidence.events.push('current'); },
			channels,
			destination: evidence.destination,
			encodeWav(input, settings) {
				evidence.events.push('stage');
				evidence.stagedChannels.push(input);
				evidence.stagingSettings.push(settings);
				return Uint8Array.of(82, 73, 70, 70);
			},
			ffmpeg: evidence.ffmpeg,
			onEncoding: () => { evidence.events.push('encoding'); },
			plan,
			signal: new AbortController().signal,
		});
		assert.strictEqual(output.directDestination, evidence.destination, entry.format);
		assert.equal(output.byteLength, 5, entry.format);
		assert.strictEqual(evidence.stagedChannels[0], channels, entry.format);
		const staging = evidence.stagingSettings[0]!;
		assert.equal(staging.sampleRate, plan.sampleRate, entry.format);
		assert.equal(staging.float, entry.format !== 'flac', entry.format);
		assert.equal(staging.bitDepth, entry.format === 'flac' ? 16 : 32, entry.format);
		assert.equal(staging.dither, entry.format === 'flac' ? plan.ditherMode : 'none', entry.format);
		const transcode = evidence.ffmpegSettings[0]!;
		assert.deepEqual(transcode.channelMapping, plan.encoding.channelMapping, entry.format);
		assert.equal(transcode.inputChannelCount, plan.encoding.inputChannelCount, entry.format);
		assert.equal(transcode.channelCount, plan.channelCount, entry.format);
		assert.equal(
			transcode.applyDither,
			plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && entry.format !== 'flac',
			entry.format,
		);
		assert.ok(evidence.events.indexOf('stage') < evidence.events.indexOf('encoding'), entry.format);
		assert.ok(evidence.events.indexOf('encoding') < evidence.events.indexOf('ffmpeg:stat'), entry.format);
		assert.ok(evidence.events.indexOf('ffmpeg:stat') < evidence.events.indexOf('target:open'), entry.format);
	}
});

test('offline compressed staging validates central admission and unmapped renderer geometry first', async () => {
	const plan = offlinePlan('ogg-vorbis', { channelMapping: 'mono' });
	for (const [label, candidate, channels] of [
		['bare plan', { ...plan, render: { strategy: 'offline' } }, renderedChannels(2, plan.outputFrames)],
		['mapped width', plan, renderedChannels(plan.channelCount, plan.outputFrames)],
		['short render', plan, renderedChannels(2, plan.outputFrames - 1)],
		['invalid channel', plan, [new Float64Array(plan.outputFrames), new Float32Array(plan.outputFrames)]],
	] as const) {
		const evidence = await fixture(plan);
		await assert.rejects(
			encodeDirectOfflineCompressed({
				assertCurrent: () => undefined,
				channels: channels as unknown as readonly Float32Array[],
				destination: evidence.destination,
				encodeWav() { evidence.events.push('stage'); return Uint8Array.of(1); },
				ffmpeg: evidence.ffmpeg,
				onEncoding: () => undefined,
				plan: candidate,
				signal: new AbortController().signal,
			}),
			/offline compressed|channel|frame|centrally admitted/iu,
			label,
		);
		assert.equal(evidence.events.includes('stage'), false, label);
		assert.equal(evidence.opens(), 0, label);
	}
});

test('offline compressed staging fences cancellation and stale ownership after synchronous WAV creation', async () => {
	for (const mode of ['abort', 'stale'] as const) {
		const plan = offlinePlan('mp3');
		const evidence = await fixture(plan);
		const abort = new AbortController();
		const failure = new Error(mode);
		let stale = false;
		await assert.rejects(
			encodeDirectOfflineCompressed({
				assertCurrent() { if (stale) throw failure; },
				channels: renderedChannels(2, plan.outputFrames),
				destination: evidence.destination,
				encodeWav() {
					evidence.events.push('stage');
					if (mode === 'abort') abort.abort(failure);
					else stale = true;
					return Uint8Array.of(1);
				},
				ffmpeg: evidence.ffmpeg,
				onEncoding: () => undefined,
				plan,
				signal: abort.signal,
			}),
			(error) => error === failure,
			mode,
		);
		assert.deepEqual(evidence.events, ['stage'], mode);
		assert.equal(evidence.opens(), 0, mode);
	}
});

async function fixture(plan: ReturnType<typeof offlinePlan>) {
	const events: string[] = [];
	const stagedChannels: Array<readonly Float32Array[]> = [];
	const stagingSettings: Array<Readonly<Record<string, unknown>>> = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	let opens = 0;
	let bytes = 0;
	const prepared = {
		mode: 'stream' as const,
		async createWritable() {
			opens += 1;
			events.push('target:open');
			return new WritableStream<Uint8Array>({ write(chunk) { bytes += chunk.byteLength; } });
		},
		bytesWritten: () => bytes,
		async commit() { return { fileName: plan.outputs[0].fileName, method: 'memory', size: bytes }; },
		async abort() { events.push('target:abort'); },
	};
	const preparation = await prepareDirectCompressedDestination(
		{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	const ffmpeg = {
		async encodeFileToSink(
			file: Blob,
			format: DirectCompressedFormat,
			sink: FfmpegOutputSink<DirectCompressedDestination>,
			settings: Readonly<Record<string, unknown>>,
		) {
			assert.equal(file.type, 'audio/wav');
			assert.equal(format, plan.format);
			ffmpegSettings.push(settings);
			events.push('ffmpeg:stat');
			await sink.open(5);
			await sink.write(Uint8Array.of(1, 2, 3, 4, 5));
			const output = await sink.close();
			return { output, byteLength: 5, chunkCount: 1, extension: `.${plan.encoding.extension}`, mimeType: plan.mimeType };
		},
	};
	return {
		destination: preparation.destination, events, ffmpeg, ffmpegSettings,
		opens: () => opens, stagedChannels, stagingSettings,
	};
}

function offlinePlan(format: DirectCompressedFormat, options: Readonly<Record<string, unknown>> = {}) {
	return createExportPlan(projectFixture(), {
		format, includeTail: false, livePcmBytes: 0, date: '2026-08-02', ...options,
	}) as ReturnType<typeof createExportPlan> & Readonly<{
		readonly encoding: Readonly<Record<string, unknown>> & {
			readonly bitDepth: number | null;
			readonly channelMapping: unknown;
			readonly extension: string;
			readonly inputChannelCount: number;
			readonly sampleFormat: string | null;
		};
		readonly ditherMode: string;
		readonly format: DirectCompressedFormat;
		readonly mimeType: string;
		readonly outputs: readonly [{ readonly fileName: string }];
	}>;
}

function renderedChannels(channelCount: number, frameCount: number): readonly Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => (
		Float32Array.from({ length: frameCount }, (_value, frame) => (channel + 1) * (frame + 1) / 100)
	));
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'offline-compressed', title: 'Offline compressed', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 4 }, loop: { enabled: false, startFrame: 0, endFrame: 4 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
