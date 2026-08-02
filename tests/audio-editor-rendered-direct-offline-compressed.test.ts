/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareDirectCompressedDestination,
	type DirectCompressedFormat,
} from '../src/common/editor/controller/direct-compressed-export.ts';
import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from '../src/common/editor/controller/rendered-audio-encoding.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('rendered direct compressed output resamples then stages unmapped mono and custom inputs', async () => {
	const cases = [
		{ format: 'mp3', mapping: 'mono', sampleRate: 48_000, expectedMode: 'mono', expectedChannels: 1 },
		{
			format: 'ogg-vorbis', sampleRate: 44_100, expectedMode: 'custom', expectedChannels: 3,
			mapping: { channels: [0, 1, { inputs: [{ channel: 0, gain: 0.5 }, { channel: 1, gain: 0.5 }] }] },
		},
	] as const;
	for (const entry of cases) {
		const plan = offlinePlan(entry.format, entry.sampleRate, entry.mapping);
		const evidence = await fixture(plan);
		const rendered = {
			sampleRate: 44_100,
			channels: [Float32Array.of(1, 2, 3, 4), Float32Array.of(-1, -2, -3, -4)],
		};
		const output = await encodeRenderedAudio(evidence.runtime, {
			assertCurrent: () => { evidence.events.push('current'); },
			directCompressedDestination: evidence.destination,
			plan: plan as unknown as RenderedAudioEncodingPlan,
			rendered,
			settings: {},
			signal: new AbortController().signal,
		});
		assert.strictEqual(output.directDestination, evidence.destination, entry.format);
		assert.equal(output.byteLength, 5, entry.format);
		assert.equal(evidence.legacyEncodes, 0, entry.format);
		assert.equal(evidence.mappingCalls, 0, entry.format);
		assert.equal(evidence.stagedChannels[0]!.length, 2, entry.format);
		assert.equal(evidence.stagedChannels[0]![0]!.length, plan.outputFrames, entry.format);
		assert.equal(evidence.ffmpegSettings[0]!.inputChannelCount, 2, entry.format);
		assert.equal(evidence.ffmpegSettings[0]!.channelCount, entry.expectedChannels, entry.format);
		assert.equal(
			(evidence.ffmpegSettings[0]!.channelMapping as Readonly<{ mode: string }>).mode,
			entry.expectedMode,
			entry.format,
		);
		if (entry.sampleRate === 48_000) {
			assert.deepEqual(evidence.resamples, [{ sampleRate: 48_000, outputFrames: plan.outputFrames }]);
			assert.ok(evidence.events.indexOf('resample') < evidence.events.indexOf('stage'));
		} else assert.deepEqual(evidence.resamples, []);
	}
});

async function fixture(plan: ReturnType<typeof offlinePlan>) {
	const events: string[] = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	const resamples: Array<Readonly<{ sampleRate: number; outputFrames: number }>> = [];
	const stagedChannels: Array<readonly Float32Array[]> = [];
	let bytes = 0;
	let legacyEncodes = 0;
	let mappingCalls = 0;
	const prepared = {
		mode: 'stream' as const,
		async createWritable() {
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
	const runtime: RenderedAudioEncodingRuntime = {
		applyMediaChannelMapping() { mappingCalls += 1; throw new Error('offline compressed mapping reached renderer'); },
		audioBufferChannels(buffer) {
			return (buffer as unknown as Readonly<{ channels: readonly Float32Array[] }>).channels;
		},
		copy: { encoding: 'Encoding' },
		encodeAiff() { throw new Error('AIFF reached'); },
		encodeWav(channels) {
			events.push('stage');
			stagedChannels.push(channels);
			return Uint8Array.of(82, 73, 70, 70);
		},
		ffmpeg: {
			async encode() { legacyEncodes += 1; return { bytes: Uint8Array.of(9), mimeType: plan.mimeType }; },
			async encodeFileToSink(_file, format, sink, settings) {
				assert.equal(format, plan.format);
				ffmpegSettings.push(settings);
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2, 3, 4, 5));
				const output = await sink.close();
				return { output, byteLength: 5, chunkCount: 1, extension: `.${plan.encoding.extension}`, mimeType: plan.mimeType };
			},
		},
		async resampleBuffer(_input, sampleRate, _context, _copy, outputFrames) {
			events.push('resample');
			resamples.push({ sampleRate, outputFrames });
			return {
				sampleRate,
				channels: [new Float32Array(outputFrames).fill(0.25), new Float32Array(outputFrames).fill(-0.25)],
			};
		},
		setStatus(message) { events.push(`status:${String(message)}`); },
		throwIfAborted(signal) { if (signal.aborted) throw signal.reason; },
	};
	return {
		destination: preparation.destination, events, ffmpegSettings,
		get legacyEncodes() { return legacyEncodes; },
		get mappingCalls() { return mappingCalls; },
		resamples, runtime, stagedChannels,
	};
}

function offlinePlan(format: DirectCompressedFormat, sampleRate: number, channelMapping: unknown) {
	return createExportPlan(projectFixture(), {
		format, sampleRate, channelMapping, includeTail: false, livePcmBytes: 0, date: '2026-08-02',
	}) as ReturnType<typeof createExportPlan> & Readonly<{
		readonly encoding: Readonly<Record<string, unknown>> & { readonly extension: string };
		readonly channelMapping: unknown;
		readonly ditherMode: string;
		readonly format: DirectCompressedFormat;
		readonly mimeType: string;
		readonly outputs: readonly [{ readonly fileName: string }];
	}>;
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'rendered-offline-compressed', title: 'Rendered mix', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 44_100, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 4 }, loop: { enabled: false, startFrame: 0, endFrame: 4 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 2, sampleRate: 44_100, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
