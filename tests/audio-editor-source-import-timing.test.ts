/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	createImportVideoFile,
	type ImportVideoRuntime,
} from '../src/common/editor/controller/source-import.ts';
import { planVideoImportTiming } from '../src/common/editor/controller/video-import-timing.ts';
import { createFixture } from './audio-editor-source-import.test.ts';
import { videoFile } from './helpers/audio-editor-source-import-fixture.ts';

type MutableImportVideoRuntime = {
	-readonly [Name in keyof ImportVideoRuntime]: ImportVideoRuntime[Name];
};

test('video import rollback cannot delete a newer media generation', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	fixture.options.replaceMediaBeforeRollback = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/activation failed/u,
	);
	assert.deepEqual(fixture.mediaDiscardAttempts, ['video-source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
});

test('video import does not delete media that failed before persistence', async () => {
	const fixture = createFixture();
	fixture.options.writeMediaFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/media write failed/u,
	);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.calls.includes('revoke:video-source-1'), true);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('failed exact-timing import preserves newer original and timing generations', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalStore = runtime.store as Record<string, unknown> & {
		beginMediaAssetWrite(...args: unknown[]): Promise<unknown>;
	};
	const storageKeys: string[] = [];
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		async beginMediaAssetWrite(...args: unknown[]) {
			storageKeys.push(String(args[0]));
			return originalStore.beginMediaAssetWrite(...args);
		},
	};
	runtime.ffmpeg = {
		...(runtime.ffmpeg as Readonly<Record<string, unknown>>),
		async probeVideoTiming() {
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n, 80n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
			};
		},
	};
	runtime.activateVideoSource = async () => {
		for (const storageKey of storageKeys) fixture.replaceMediaGeneration(storageKey);
		throw new Error('activation failed after exact timing publication');
	};

	await assert.rejects(
		createImportVideoFile(runtime)(new File([Uint8Array.of(1, 2, 3)], 'exact.mp4', { type: 'video/mp4' }), {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		}),
		/activation failed after exact timing publication/u,
	);
	assert.equal(storageKeys.length, 2);
	assert.deepEqual(fixture.mediaDiscardAttempts, [...storageKeys].reverse());
	assert.deepEqual(fixture.deletedMedia, []);
});

test('exact timing owns imported source duration and one aligned A/V placement', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	runtime.store = {
		...(runtime.store as Readonly<Record<string, unknown>>),
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
	};
	const presentationTicks = Array.from({ length: 32 }, (_, index) => BigInt(index));
	runtime.ffmpeg = {
		...(runtime.ffmpeg as Readonly<Record<string, unknown>>),
		async probeVideoTiming() {
			return {
				timescale: 15,
				presentationTicks,
				finalFrameDurationTicks: 1n,
				nominalRate: { num: 15, den: 1 },
			};
		},
	};
	let fittedFrames = 0;
	runtime.fitAudioBufferToFrames = (buffer: Readonly<Record<string, unknown>>, frameCount: number) => {
		fittedFrames = frameCount;
		return { ...buffer, length: frameCount };
	};

	await createImportVideoFile(runtime)(new File([Uint8Array.of(1, 2, 3)], 'exact.webm', {
		type: 'video/webm',
	}));

	const commands = fixture.commits[0]?.command.commands as readonly Readonly<Record<string, unknown>>[];
	const sources = commands.filter(({ type }) => type === 'source/add')
		.map(({ source }) => source as Readonly<Record<string, unknown>>);
	const clips = commands.filter(({ type }) => type === 'clip/add')
		.map(({ clip }) => clip as Readonly<Record<string, unknown>>);
	assert.equal(sources.find(({ kind }) => kind === 'video')?.sampleFrameCount, 102_400);
	assert.equal(sources.find(({ kind }) => kind === 'audio')?.frameCount, 102_400);
	assert.equal(clips.find(({ kind }) => kind === 'video')?.sequenceFrameCount, 64);
	assert.equal(clips.find(({ kind }) => kind === 'audio')?.durationFrames, 102_400);
	assert.equal(fittedFrames, 102_400);
	assert.deepEqual(planVideoImportTiming({
		metadataDurationFrames: 101_789,
		sampleRate: 48_000,
		timingIndex: {
			encoding: 'soundscaper-video-timing-v1', timescale: 15, frameCount: 32,
			presentationTicks, finalFrameDurationTicks: 1n, endTicks: 32n,
		},
		timelineStartFrame: 0,
		sequenceRate: { num: 30, den: 1 },
	}), {
		sourceDurationFrames: 102_400,
		sequenceStartFrame: 0,
		sequenceEndFrame: 64,
		timelineStartFrame: 0,
		timelineDurationFrames: 102_400,
	});
});

test('probe failure stores genuinely conformed CFR media and reprobes its exact timing', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalFfmpeg = runtime.ffmpeg as Readonly<Record<string, unknown>>;
	let probeCalls = 0;
	let conformedInput: Blob | null = null;
	runtime.ffmpeg = {
		...originalFfmpeg,
		async probeVideoTiming() {
			probeCalls += 1;
			if (probeCalls === 1) throw new Error('unsupported original timebase');
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n, 80n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
			};
		},
		async conformVideoToCfr(input: Blob) {
			conformedInput = input;
			return new File([Uint8Array.of(9, 8, 7)], 'conformed.mp4', { type: 'video/mp4' });
		},
	};
	const originalStore = runtime.store as Record<string, unknown>;
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async writeMediaAsset(storageKey: string, body: Blob) {
			fixture.calls.push(`write-media:${storageKey}`);
			return { sha256: await digestMediaContent(body), size: body.size };
		},
		async beginMediaAssetWrite(storageKey: string) {
			const chunks: ArrayBuffer[] = [];
			let bytesWritten = 0;
			return {
				maximumChunkBytes: 8,
				get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) {
					chunks.push(Uint8Array.from(bytes).buffer);
					bytesWritten += bytes.byteLength;
				},
				async commit() { throw new Error('Timing publication must retain ownership.'); },
				async commitOwned() {
					const body = new Blob(chunks);
					fixture.calls.push(`write-media:${storageKey}`);
					return {
						metadata: { sha256: await digestMediaContent(body), size: body.size },
						async discardIfCurrent() { return true; },
					};
				},
				async abort() { chunks.length = 0; },
			};
		},
	};
	const original = new File([Uint8Array.of(1, 2, 3, 4)], 'vfr.mov', { type: 'video/quicktime' });

	await createImportVideoFile(runtime)(original, {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.equal(conformedInput, original);
	assert.equal(probeCalls, 2);
	const source = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(source);
	assert.equal(source.mimeType, 'video/mp4');
	assert.equal(source.videoCodec, 'h264');
	assert.deepEqual(source.frameRate, { num: 25, den: 1 });
	assert.equal((source.timingDecision as Record<string, unknown>).mode, 'conform-cfr-at-ingest');
	assert.ok(source.timingAsset);
});

test('probe fallback fails closed when CFR conformance is unavailable', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	runtime.ffmpeg = {
		async decode() { return { channels: [], sampleRate: 48_000 }; },
		async probeVideoTiming() { throw new Error('unsupported original timebase'); },
	};
	const original = new File([Uint8Array.of(1, 2, 3, 4)], 'unprobed.mov', {
		type: 'video/quicktime',
	});

	await assert.rejects(
		createImportVideoFile(runtime)(original, {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		}),
		/CFR conformance is unavailable/iu,
	);
	assert.equal(fixture.addedSources.length, 0);
	assert.equal(fixture.calls.some((call) => call.startsWith('write-media:')), false);
});

test('ingest persists probed characteristics instead of guessing codecs', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalStore = runtime.store as Record<string, unknown>;
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
	};
	runtime.ffmpeg = {
		...(runtime.ffmpeg as Readonly<Record<string, unknown>>),
		async probeVideoTiming() {
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n, 80n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
				characteristics: {
					backend: 'ffmpeg',
					codedWidth: 1_920,
					codedHeight: 1_080,
					rotationDegrees: 270,
					videoCodec: 'prores',
					fieldOrder: 'top-field-first',
					audioStreams: [{ index: 1, codec: 'pcm_s24le', channelCount: 2, sampleRate: 48_000, language: 'eng' }],
					startTimecode: { negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
				},
			};
		},
	};
	await createImportVideoFile(runtime)(new File([Uint8Array.of(1, 2, 3)], 'take.mp4', { type: 'video/mp4' }));
	const source = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(source);
	const characteristics = source.characteristics as Record<string, unknown>;
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.rotationDegrees, 270);
	assert.equal(characteristics.fieldOrder, 'top-field-first');
	assert.deepEqual(characteristics.startTimecode, {
		negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false,
	});
	assert.equal(characteristics.extractedAudioStreamIndex, 1, 'a single reported program is the one ingest extracted');
	assert.equal(source.videoCodec, 'prores', 'the probed codec replaces the ingest guess');
	assert.equal(source.audioCodec, 'pcm_s24le');
});

test('a multi-stream master records the programs ingest did not import', async () => {
	const fixture = createFixture();
	const runtime = fixture.runtime as MutableImportVideoRuntime;
	const originalStore = runtime.store as Record<string, unknown>;
	runtime.store = {
		...originalStore,
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
	};
	runtime.ffmpeg = {
		...(runtime.ffmpeg as Readonly<Record<string, unknown>>),
		async probeVideoTiming() {
			return {
				timescale: 1_000,
				presentationTicks: [0n, 40n],
				finalFrameDurationTicks: 40n,
				nominalRate: { num: 25, den: 1 },
				characteristics: {
					backend: 'ffmpeg',
					videoCodec: 'h264',
					audioStreams: [
						{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
						{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: 'deu' },
					],
				},
			};
		},
	};
	await createImportVideoFile(runtime)(new File([Uint8Array.of(4, 5, 6)], 'master.mp4', { type: 'video/mp4' }));
	const source = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(source);
	const characteristics = source.characteristics as Record<string, unknown>;
	assert.equal((characteristics.audioStreams as readonly unknown[]).length, 2);
	assert.equal(
		characteristics.extractedAudioStreamIndex,
		null,
		'ingest does not claim which program it decoded when the inventory is ambiguous',
	);
	assert.equal(source.audioCodec, 'unknown');
});

test('an unreported probe leaves the characteristics record explicitly empty', async () => {
	const fixture = createFixture();
	const source = await createImportVideoFile(fixture.runtime)(videoFile())
		.then(() => fixture.addedSources.find(({ kind }) => kind === 'video'));
	assert.ok(source);
	assert.deepEqual(source.characteristics, {
		backend: null, codedWidth: null, codedHeight: null, rotationDegrees: null,
		pixelAspectRatio: null, fieldOrder: null, hasAlpha: null, videoCodec: null,
		colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null, extractedAudioStreamIndex: null, startTimecode: null,
	});
	assert.equal(source.videoCodec, 'unknown', 'a runtime that cannot probe records nothing rather than a guess');
});

test('the first timing probe receives the import abort signal', async () => {
	const fixture = createFixture();
	const seen: Array<AbortSignal | undefined> = [];
	const controller = new AbortController();
	const importVideo = createImportVideoFile({
		...fixture.runtime,
		helperTimingProbe: {
			id: 'native-helper',
			probe: async (_input: Blob, probeOptions: Readonly<{ signal?: AbortSignal }> = {}) => {
				seen.push(probeOptions.signal);
				throw new Error('helper probe unavailable in this fixture');
			},
		},
	} as never);
	const blobVideo = new File([new Uint8Array(4)], 'movie.mp4', { type: 'video/mp4' });
	await assert.rejects(() => importVideo(blobVideo as never, {
		destination: 'timeline', trackId: null, trackIndex: 0, timelineStartFrame: 0,
		signal: controller.signal,
	} as never));
	assert.equal(seen.length, 1);
	assert.equal(seen[0], controller.signal,
		'aborting an import must be able to cancel its in-flight helper probe');
});
