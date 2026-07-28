import assert from 'node:assert/strict';
import test from 'node:test';

import {
	aup4ReportHasMissingPcm,
	ensureAup4FileName,
	ensureScapeFileName,
	formatBytes,
	historyEntrySummary,
	isAudacityProjectFile,
	isLegacyAupFile,
	isLegacyBlockFile,
	isWavFile,
	labelExportFileName,
	labelMimeType,
	normalizeAup4CompatibilityReport,
	normalizeProjectSampleRate,
} from '../src/common/editor/controller/app-helpers.ts';
import {
	cloneAudacityWorkerPayload,
	freezeNyquistResult,
	mixNyquistPreviewChannels,
	normalizeNyquistRole,
	nyquistAudioResultBytes,
	nyquistChannelStats,
	nyquistMaximumOutputFrames,
	nyquistResultStatus,
} from '../src/common/editor/controller/nyquist-audio.ts';
import {
	createStoredChunkProvider,
	isStreamableStoredSource,
	normalizeByteLimit,
	scaleClipEnvelope,
	serializeAudacityNoiseProfile,
	sourceAudioBufferBytes,
	sourcePcmBytes,
} from '../src/common/editor/controller/source-audio.ts';
import { createStreamingZipArchive } from '../src/common/editor/controller/temporary-export.ts';
import {
	clipSourceWindowRange,
	generateWaveformPeaksFallback,
	legacyPeakCacheKey,
	mixToMono,
	peakCacheKey,
	readWaveformPcmWindow,
	waveformPcmWindowContains,
	waveformPeaksHaveRms,
} from '../src/common/editor/controller/waveform-analysis.ts';

test('Nyquist helpers normalize roles, bounds, channels, and transferable payloads', () => {
	assert.equal(normalizeNyquistRole(' Tool Analyze '), 'analyze');
	assert.equal(normalizeNyquistRole('generator'), 'generate');
	assert.equal(normalizeNyquistRole('unknown'), 'prompt');
	assert.equal(nyquistMaximumOutputFrames({ sampleRate: 100, inputFrames: 20, preview: true }), 600);
	assert.throws(
		() => nyquistMaximumOutputFrames({ sampleRate: 100, inputFrames: 20, preview: false, requested: 0 }),
		/maxOutputFrames must be positive/,
	);

	const mixed = mixNyquistPreviewChannels([
		[Float32Array.of(0.25, -0.5)],
		[Float32Array.of(0.5, 0.25), Float32Array.of(-0.25, 0.5)],
	], 2);
	assert.deepEqual(Array.from(mixed[0] ?? []), [0.75, -0.25]);
	assert.deepEqual(Array.from(mixed[1] ?? []), [0, 0]);
	assert.deepEqual(nyquistChannelStats([Float32Array.of(-1, 1)]), { peak: 1, rms: 1 });
	assert.equal(nyquistAudioResultBytes({ type: 'audio', channels: mixed }), 16);

	const evaluations = [{ result: { type: 'audio', sampleRate: 100, channels: mixed, output: 'ok' } }];
	assert.deepEqual(freezeNyquistResult(evaluations, { summarizeAudio: true }), {
		type: 'audio', sampleRate: 100, frameCount: 2, channelCount: 2, output: 'ok',
	});
	assert.equal(nyquistResultStatus(evaluations, { done: 'done' }), 'ok');

	const transfer: ArrayBuffer[] = [];
	const cloned = cloneAudacityWorkerPayload({
		channels: [Float32Array.of(1)],
		params: { gain: 2 },
		context: { beforeChannels: [Float32Array.of(0.5)] },
	}, transfer);
	assert.equal(transfer.length, 2);
	assert.notEqual(cloned.channels[0], evaluations[0]?.result.channels?.[0]);
});

test('source helpers validate memory limits, stored geometry, and clip metadata', async () => {
	assert.equal(sourceAudioBufferBytes({ length: 4, numberOfChannels: 2 }), 32);
	assert.equal(sourcePcmBytes({ frameCount: 4, channelCount: 2 }), 32);
	assert.equal(sourcePcmBytes({ frameCount: -1, channelCount: 2 }), Number.POSITIVE_INFINITY);
	assert.equal(normalizeByteLimit(null, 64), 64);
	assert.throws(() => normalizeByteLimit(-1, 64), /non-negative safe integer/);

	const source = { id: 'source', storageKey: 'stored', frameCount: 8, channelCount: 1, sampleRate: 48_000, chunkFrames: 4 };
	const metadata = { id: 'source', frameCount: 8, channelCount: 1, sampleRate: 48_000, chunkFrames: 4, chunkCount: 2 };
	assert.equal(isStreamableStoredSource(source, metadata), true);
	assert.equal(isStreamableStoredSource(source, { ...metadata, chunkCount: 1 }), false);
	const calls: unknown[][] = [];
	const provider = createStoredChunkProvider({
		readSourceChunk(...args: unknown[]) {
			calls.push(args);
			return Promise.resolve({ channels: [Float32Array.of(0, 1, 2, 3)] });
		},
	}, source, metadata);
	await provider.readStorageChunk(1, { signal: null });
	assert.deepEqual(calls, [['stored', 1, { signal: null }]]);

	assert.deepEqual(scaleClipEnvelope({
		durationFrames: 10,
		envelope: [{ frame: 0, value: 1 }, { frame: 5, value: 0.5 }, { frame: 5, value: 0.25 }],
	}, 20), [{ frame: 0, value: 1 }, { frame: 10, value: 0.5 }]);
	assert.deepEqual(serializeAudacityNoiseProfile({ meanPowers: Float32Array.of(1, 2), smoothing: 3 }), {
		meanPowers: [1, 2], smoothing: 3,
	});
});

test('waveform helpers map source windows and compute validated peak pyramids', async () => {
	const clip = { durationFrames: 100, sourceDurationFrames: 200, sourceStartFrame: 10, reversed: false };
	assert.deepEqual(clipSourceWindowRange(clip, 10, 20, 1_000), { startFrame: 28, endFrame: 52 });
	assert.deepEqual(clipSourceWindowRange({ ...clip, reversed: true }, 10, 20, 1_000), { startFrame: 168, endFrame: 192 });
	assert.equal(waveformPcmWindowContains({ startFrame: 2, endFrame: 8 }, { startFrame: 3, endFrame: 7 }), true);

	const chunks = [Float32Array.of(0, 1, 2, 3), Float32Array.of(4, 5, 6, 7)];
	const window = await readWaveformPcmWindow({
		channelCount: 1,
		chunkFrames: 4,
		readStorageChunk: (chunkIndex: number) => Promise.resolve({ channels: [chunks[chunkIndex] as Float32Array] }),
	}, { startFrame: 2, endFrame: 7 });
	assert.deepEqual(Array.from(window[0] ?? []), [2, 3, 4, 5, 6]);

	const channels = [Float32Array.of(-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5)];
	const peaks = generateWaveformPeaksFallback(channels);
	assert.equal(waveformPeaksHaveRms(peaks, { frameCount: 8, channelCount: 1 }), true);
	assert.equal(peaks.levels[0]?.channels[0]?.minimums[0], -1);
	assert.equal(peaks.levels[0]?.channels[0]?.maximums[0], 1);
	assert.deepEqual(Array.from(mixToMono([channels[0] as Float32Array, channels[0] as Float32Array])), Array.from(channels[0] as Float32Array));
	assert.equal(peakCacheKey('source'), 'audio-editor-peaks-v2:source');
	assert.equal(legacyPeakCacheKey('source'), 'audio-editor-peaks-v1:source');
});

test('controller file helpers preserve formats, summaries, and compatibility counts', () => {
	assert.equal(normalizeProjectSampleRate(96_000), 96_000);
	assert.equal(normalizeProjectSampleRate(1), 48_000);
	assert.deepEqual(historyEntrySummary({ command: { type: 'batch', commands: [{ type: 'split' }, { type: 'move' }] } }), {
		type: 'batch', commandCount: 2, commands: ['split', 'move'],
	});
	assert.equal(formatBytes(1_536), '1.5 KB');
	assert.equal(isAudacityProjectFile({ name: 'project.AUP3' }), true);
	assert.equal(isAudacityProjectFile({ name: 'project.AUP4' }), true);
	assert.equal(isAudacityProjectFile({ name: 'project.aup' }), false);
	assert.equal(isLegacyAupFile({ name: 'project.aup' }), true);
	assert.equal(isLegacyBlockFile({ name: 'e000.au' }), true);
	assert.equal(isWavFile({ name: 'audio.bin', type: 'audio/x-wav' }), true);
	assert.equal(isWavFile({ name: 'large-master.RF64' }), true);
	assert.equal(isWavFile({ name: 'unsupported-master.bw64' }), true);
	assert.equal(isWavFile({ name: 'audio.bin', type: 'audio/rf64' }), true);
	assert.equal(labelExportFileName('unsafe:name.wav', 'vtt'), 'unsafe-name.vtt');
	assert.equal(labelExportFileName('episode.wav', 'json'), 'episode.json');
	assert.equal(labelMimeType('json'), 'application/json+chapters');
	assert.equal(ensureAup4FileName('mix'), 'mix.aup4');
	assert.equal(ensureScapeFileName('mix'), 'mix.scape');

	const report = normalizeAup4CompatibilityReport({
		items: [{ disposition: 'preserved' }, { disposition: 'missing', code: 'MISSING_LOCAL_AUDIO' }],
	}, 'open');
	assert.deepEqual(report.counts, { preserved: 1, converted: 0, missing: 1, omitted: 0 });
	assert.equal(aup4ReportHasMissingPcm(report), true);
});

test('temporary ZIP export streams bytes without requiring persistent storage', async () => {
	const archive = await createStreamingZipArchive('stems.zip', 0, {
		largeStemsStorageRequired: 'storage required',
		stemArchiveClosed: 'archive closed',
		temporaryExportClosed: 'export closed',
	});
	await archive.add('track.raw', Uint8Array.of(1, 2, 3), null);
	const { blob, cleanup } = await archive.finish();
	const bytes = new Uint8Array(await blob.arrayBuffer());
	assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
	await cleanup();
});
