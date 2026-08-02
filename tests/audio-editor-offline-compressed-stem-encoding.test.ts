/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { captureDirectCompressedStemArchiveContract } from '../src/common/editor/controller/direct-compressed-stem-archive-plan.ts';
import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from '../src/common/editor/controller/rendered-audio-encoding.ts';
import { createExportPlan } from '../src/common/editor/export.js';

const CASES = Object.freeze([
	{
		label: 'FLAC int16', format: 'flac', options: { sampleFormat: 'int16', dither: 'triangular' },
		stagingBitDepth: 16, stagingFloat: false, stagingDither: 'triangular', applyDither: false,
	},
	{
		label: 'FLAC int24', format: 'flac', options: { sampleFormat: 'int24', dither: 'triangular-highpass' },
		stagingBitDepth: 24, stagingFloat: false, stagingDither: 'triangular-highpass', applyDither: false,
	},
	{
		label: 'integer WavPack', format: 'wavpack', options: { sampleFormat: 'int24', dither: 'triangular-highpass' },
		stagingBitDepth: 32, stagingFloat: true, stagingDither: 'none', applyDither: true,
	},
	{
		label: 'float WavPack', format: 'wavpack', options: { sampleFormat: 'float32', dither: 'triangular-highpass' },
		stagingBitDepth: 32, stagingFloat: true, stagingDither: 'none', applyDither: false,
	},
]);

test('offline compressed stems preserve input-width WAV staging and codec dither ownership', async () => {
	for (const entry of CASES) {
		const plan = offlineStemPlan(entry.format, entry.options);
		const contract = captureDirectCompressedStemArchiveContract(plan as never);
		assert.ok(contract, entry.label);
		assert.equal(contract.renderStrategy, 'offline', entry.label);
		const channels = Array.from(
			{ length: Number(plan.encoding.inputChannelCount) },
			(_value, channel) => new Float32Array(plan.outputFrames).fill((channel + 1) / 10),
		);
		const stagedInputs: Array<readonly Float32Array[]> = [];
		const stagingSettings: Array<Readonly<Record<string, unknown>>> = [];
		const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
		const runtime: RenderedAudioEncodingRuntime = {
			applyMediaChannelMapping() { throw new Error('offline stem mapping reached the renderer'); },
			audioBufferChannels(buffer) {
				return (buffer as unknown as Readonly<{ channels: readonly Float32Array[] }>).channels;
			},
			copy: { encoding: 'Encoding' },
			encodeAiff() { throw new Error('AIFF reached offline compressed stem encoding'); },
			encodeWav(input, settings) {
				stagedInputs.push(input);
				stagingSettings.push(settings);
				return Uint8Array.of(82, 73, 70, 70);
			},
			ffmpeg: {
				async encode(_input, format, settings) {
					assert.equal(format, entry.format);
					ffmpegSettings.push(settings);
					return { bytes: Uint8Array.of(1, 2, 3), mimeType: plan.mimeType };
				},
			},
			async resampleBuffer() { throw new Error('offline stem resampling was not expected'); },
			setStatus() {},
			throwIfAborted(signal) { signal.throwIfAborted(); },
		};
		const rendered = { sampleRate: plan.sampleRate, channels };
		const output = await encodeRenderedAudio(runtime, {
			plan: plan as unknown as RenderedAudioEncodingPlan,
			rendered,
			settings: {},
			signal: new AbortController().signal,
		});
		assert.deepEqual(output.bytes, Uint8Array.of(1, 2, 3), entry.label);
		assert.equal(stagedInputs.length, 1, entry.label);
		assert.equal(stagingSettings.length, 1, entry.label);
		assert.equal(ffmpegSettings.length, 1, entry.label);
		assert.strictEqual(stagedInputs[0], channels, entry.label);
		assert.equal(stagedInputs[0]?.length, Number(plan.encoding.inputChannelCount), entry.label);
		assert.equal(stagingSettings[0]?.sampleRate, plan.sampleRate, entry.label);
		assert.equal(stagingSettings[0]?.bitDepth, entry.stagingBitDepth, entry.label);
		assert.equal(stagingSettings[0]?.float, entry.stagingFloat, entry.label);
		assert.equal(stagingSettings[0]?.dither, entry.stagingDither, entry.label);
		assert.strictEqual(ffmpegSettings[0]?.channelMapping, plan.encoding.channelMapping, entry.label);
		assert.equal(ffmpegSettings[0]?.inputChannelCount, plan.encoding.inputChannelCount, entry.label);
		assert.equal(ffmpegSettings[0]?.channelCount, plan.channelCount, entry.label);
		assert.equal(ffmpegSettings[0]?.applyDither, entry.applyDither, entry.label);
	}
});

function offlineStemPlan(
	format: string,
	options: Readonly<Record<string, unknown>>,
) {
	return createExportPlan(projectFixture(), {
		mode: 'stems', format, includeTail: false, livePcmBytes: 0,
		channelMapping: 'mono', date: '2026-08-02', ...options,
	}) as ReturnType<typeof createExportPlan> & Readonly<{
		readonly encoding: Readonly<Record<string, unknown>> & {
			readonly channelMapping: unknown;
			readonly inputChannelCount: number;
		};
		readonly mimeType: string;
	}>;
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'offline-compressed-stem-encoding', title: 'Session', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 4 },
		loop: { enabled: false, startFrame: 0, endFrame: 4 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 4,
		}],
		tracks: [
			{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['clip'], effectsActive: true, effects: [] },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: [], effectsActive: true, effects: [] },
		],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
