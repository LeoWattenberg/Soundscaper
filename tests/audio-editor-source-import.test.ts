/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImportVideoFile,
	type ImportVideoRuntime,
} from '../src/common/editor/controller/source-import.ts';
import {
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
} from '../src/common/editor/video-preview-capture-admission.ts';

interface VideoFile {
	readonly name: string;
	readonly type: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

function videoFile(name = 'movie.mp4'): VideoFile {
	return {
		name,
		type: 'video/mp4',
		size: 32,
		arrayBuffer: async () => new ArrayBuffer(8),
	};
}

function createFixture() {
	const calls: string[] = [];
	const addedSources: Record<string, unknown>[] = [];
	const derivatives: Array<{ timestamp: number; type: string }> = [];
	const commits: Array<{ command: { commands: unknown[] }; selection: Record<string, unknown> }> = [];
	const deletedSources: string[] = [];
	const deletedMedia: string[] = [];
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const options = {
		decodeMode: 'native' as 'native' | 'fallback' | 'none',
		posterFails: false,
		posterSourceAdmissionFails: false,
		thumbnailAdmissionFailure: null as number | null,
		thumbnailFailure: null as number | null,
		writeMediaFails: false,
		writerFails: false,
		activateFails: false,
		peaksFail: false,
	};
	const canonicalAudio = {
		length: 8,
		numberOfChannels: 1,
		sampleRate: 48_000,
		channels: [Float32Array.of(0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1)],
	};
	let project = {
		tracks: [] as Array<{ id: string; type: string; laneGroupId?: string }>,
	};
	const ids = new Map<string, number>();
	const stableId = (prefix: string) => {
		const next = (ids.get(prefix) || 0) + 1;
		ids.set(prefix, next);
		return `${prefix}-${next}`;
	};
	const extractor = {
		metadata: { durationSeconds: 2, width: 1_920, height: 1_080 },
		async capture(timestamp: number, captureOptions?: unknown) {
			calls.push(`capture:${timestamp}:${captureOptions ? 'poster' : 'thumbnail'}`);
			if (timestamp === 0 && options.posterSourceAdmissionFails) {
				throw new VideoPreviewSourceGeometryTooLargeError(16_385, 1, 'exceeds the maximum width');
			}
			if (timestamp === options.thumbnailAdmissionFailure) {
				throw new VideoPreviewEncodedPayloadTooLargeError(2, 1);
			}
			if ((timestamp === 0 && options.posterFails) || timestamp === options.thumbnailFailure) {
				throw new Error('capture failed');
			}
			return {
				blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
				width: 320,
				height: 180,
				mimeType: 'image/webp',
				timestampSeconds: timestamp,
			};
		},
		dispose() { calls.push('dispose'); },
	};
	const writer = {
		async write() {
			calls.push('writer-write');
			if (options.writerFails) throw new Error('writer failed');
		},
		async commit() { calls.push('writer-commit'); },
		async abort() { calls.push('writer-abort'); },
	};
	const runtime: ImportVideoRuntime = {
		SOURCE_CHUNK_FRAMES: 65_536,
		activateVideoSource: async (source: { id: string }) => {
			calls.push(`activate:${source.id}`);
			if (options.activateFails) throw new Error('activation failed');
		},
		audioBufferChannels: (value: typeof canonicalAudio) => value.channels || canonicalAudio.channels,
		audioEditorVideoThumbnailTimes: () => [1, 2],
		bufferFromChannels: async () => canonicalAudio,
		cacheSourceBuffer: (sourceId: string, value: unknown) => { sourceBuffers.set(sourceId, value); },
		canonicalizeBuffer: async () => canonicalAudio,
		commit: (command: { commands: unknown[] }, selection: Record<string, unknown>) => { commits.push({ command, selection }); },
		copy: {},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => {
			addedSources.push(source as Record<string, unknown>);
			return { type: 'source/add', source };
		},
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createAudioEditorVideoFrameExtractor: async () => extractor,
		createStableId: stableId,
		engine: {
			getAudioContext: async () => ({}),
			decodeAudioData: async () => {
				if (options.decodeMode !== 'native') throw new Error('native decode failed');
				return {
					...canonicalAudio,
					channels: undefined,
				};
			},
		},
		ffmpeg: {
			decode: async () => {
				if (options.decodeMode === 'none') throw new Error('no audio');
				return { channels: canonicalAudio.channels, sampleRate: 44_100 };
			},
		},
		findTrack: (value: typeof project, trackId: string) => value.tracks.find((track) => track.id === trackId) || null,
		fitAudioBufferToFrames: () => canonicalAudio,
		generateWaveformPeaks: async () => {
			if (options.peaksFail) throw new Error('peaks failed');
			return { levels: [] };
		},
		inspectEncodedAudioSampleRate: () => 44_100,
		normalizeImportOptions: () => ({ destination: 'timeline', trackId: null, timelineStartFrame: 0 }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async (bytes: number) => { calls.push(`preflight:${bytes}`); },
		getProject: () => project,
		projectSampleRate: () => 48_000,
		revokeVideoVisual: (sourceId: string) => { calls.push(`revoke:${sourceId}`); },
		sourceBuffers,
		sourcePeaks,
		store: {
			async writeMediaAsset(sourceId: string) {
				calls.push(`write-media:${sourceId}`);
				if (options.writeMediaFails) throw new Error('media write failed');
			},
			async saveVideoDerivative(_sourceId: string, derivative: { timestamp: number; type: string }) {
				derivatives.push(derivative);
			},
			async beginSourceWrite() { return writer; },
			async saveAnalysis() { calls.push('save-analysis'); },
			async deleteSource(sourceId: string) { deletedSources.push(sourceId); },
			async deleteMediaAsset(sourceId: string) { deletedMedia.push(sourceId); },
		},
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => { calls.push('warn-envelope'); },
		writeBuffer: async (target: typeof writer) => { await target.write(); },
	};
	return {
		addedSources,
		calls,
		commits,
		deletedMedia,
		deletedSources,
		derivatives,
		options,
		runtime,
		setProject: (value: typeof project) => { project = value; },
		sourceBuffers,
		sourcePeaks,
	};
}

test('video import extracts linked audio and creates a new timeline lane pair', async () => {
	const fixture = createFixture();
	const result = await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'timeline',
		trackId: null,
		trackIndex: 3,
		timelineStartFrame: 12,
	});

	assert.equal(result.destination, 'timeline');
	assert.match(result.sourceId, /^video-source-/u);
	assert.match(result.audioSourceId, /^source-/u);
	assert.match(result.trackId, /^video-track-/u);
	const videoSource = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(videoSource);
	assert.equal(videoSource.posterStorageKey, null);
	assert.equal(videoSource.thumbnailStorageKey, null);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
	assert.deepEqual(fixture.derivatives.map(({ timestamp, type }) => [timestamp, type]), [
		[0, 'poster'], [1, 'thumbnail'], [2, 'thumbnail'],
	]);
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(fixture.sourcePeaks.size, 1);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import reuses both members of an existing lane group', async () => {
	const fixture = createFixture();
	fixture.setProject({
		tracks: [
			{ id: 'video-lane', type: 'video', laneGroupId: 'media' },
			{ id: 'audio-lane', type: 'audio', laneGroupId: 'media' },
		],
	});
	fixture.options.decodeMode = 'fallback';
	const result = await createImportVideoFile(fixture.runtime)(videoFile('fallback.mov'), {
		destination: 'timeline', trackId: 'audio-lane', timelineStartFrame: 0,
	});

	assert.equal(result.trackId, 'video-lane');
	assert.equal(fixture.commits[0]?.command.commands.length, 4);
	assert.equal(fixture.calls.includes('writer-commit'), true);
});

test('project-bin video import tolerates missing audio and disposable preview failures', async () => {
	const fixture = createFixture();
	fixture.options.decodeMode = 'none';
	fixture.options.posterFails = true;
	fixture.options.thumbnailFailure = 1;
	const result = await createImportVideoFile(fixture.runtime)(videoFile(''), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.equal(result.destination, 'project-bin');
	assert.equal(result.audioSourceId, null);
	assert.equal(result.audioClipId, null);
	assert.equal(result.trackId, null);
	assert.equal(fixture.commits[0]?.command.commands.length, 2);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [2]);
	assert.equal(fixture.calls.includes('warn-envelope'), true);
});

test('video import stops disposable filmstrip work after an encoded hard-cap refusal', async () => {
	const fixture = createFixture();
	fixture.options.thumbnailAdmissionFailure = 1;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster', 'capture:1:thumbnail'],
	);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [0]);
});

test('video import skips all disposable captures after source-frame admission refuses the poster', async () => {
	const fixture = createFixture();
	fixture.options.posterSourceAdmissionFails = true;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster'],
	);
	assert.deepEqual(fixture.derivatives, []);
});

test('a selected ungrouped video lane causes a companion lane pair to be created', async () => {
	const fixture = createFixture();
	fixture.setProject({ tracks: [{ id: 'video-only', type: 'video' }] });
	const result = await createImportVideoFile(fixture.runtime)(videoFile('clip.webm'), {
		destination: 'timeline', trackId: 'video-only', timelineStartFrame: 4,
	});
	assert.match(result.trackId, /^video-track-/u);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
});

test('video import removes persisted media and audio when activation fails', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/activation failed/u,
	);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.calls.includes('revoke:video-source-1'), true);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import aborts a failed extracted-audio write and keeps cleanup idempotent', async () => {
	const fixture = createFixture();
	fixture.options.writerFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/writer failed/u,
	);
	assert.equal(fixture.calls.includes('writer-abort'), true);
	assert.deepEqual(fixture.deletedSources, []);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
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
