/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import {
	DesktopSharedProjectSourceUnavailableError,
	verifyDesktopSharedProjectSourceAvailability,
	type DesktopSharedProjectSourceAvailabilityStore,
} from '../src/common/editor/storage/desktop-shared-project-source-availability.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';

const NOW = '2026-07-30T12:00:00.000Z';
const PRIOR_NOW = '2026-07-29T12:00:00.000Z';

interface StoredChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

test('source-free shared projects perform no recipient source or media reads', async () => {
	const calls: string[] = [];
	const project = projectWithSources('source-free-shared', []);

	await verifyDesktopSharedProjectSourceAvailability(project, null, refusingStore(calls));

	assert.deepEqual(calls, []);
});

test('mixed recipient availability uses bound storage keys and disables read maintenance', async () => {
	const audio = audioSource({
		id: 'logical-audio',
		storageKey: 'recipient-pcm-audio',
		frameCount: 3,
		channelCount: 2,
		chunkFrames: 2,
	});
	const video = videoSource({
		id: 'logical-video',
		storageKey: 'recipient-media-video',
	});
	const project = projectWithSources('mixed-shared', [audio, video]);
	const prior = priorProject(project, project.sources.map((source) => ({
		...source,
		name: `Prior ${String(source.name)}`,
		opaqueExtensions: { recipientOnly: true },
	})));
	const videoBody = new Blob(['recipient video'], { type: String(video.mimeType) });
	const videoSha256 = await digestMediaContent(videoBody);
	const sourceMetadataReads: string[] = [];
	const mediaMetadataReads: string[] = [];
	const audioBodyReads: string[] = [];
	const videoBodyReads: string[] = [];
	const audioOptions: unknown[] = [];
	const videoOptions: unknown[] = [];
	const store = availabilityStore({
		getSourceMetadata(sourceId) {
			sourceMetadataReads.push(sourceId);
			return sourceId === audio.storageKey ? storedAudioMetadata(audio) : null;
		},
		getMediaAssetMetadata(sourceId) {
			mediaMetadataReads.push(sourceId);
			return sourceId === video.storageKey
				? storedVideoMetadata(video, videoBody.size, videoSha256)
				: null;
		},
		async *readSourceChunks(sourceId, options) {
			audioBodyReads.push(sourceId);
			audioOptions.push(options);
			yield chunk(0, [[1, 2], [3, 4]]);
			yield chunk(1, [[5], [6]]);
		},
		loadMediaAsset(sourceId, options) {
			videoBodyReads.push(sourceId);
			videoOptions.push(options);
			return videoBody;
		},
	});

	await verifyDesktopSharedProjectSourceAvailability(project, prior, store);

	assert.deepEqual(sourceMetadataReads, ['recipient-pcm-audio', 'recipient-pcm-audio']);
	assert.deepEqual(mediaMetadataReads, ['recipient-media-video', 'recipient-media-video']);
	assert.deepEqual(audioBodyReads, ['recipient-pcm-audio']);
	assert.deepEqual(videoBodyReads, ['recipient-media-video']);
	assert.deepEqual(audioOptions, [{ signal: undefined }]);
	assert.deepEqual(videoOptions, [{ signal: undefined }]);
});

test('a missing same-project local binding fails before every recipient store read', async () => {
	const source = audioSource({ id: 'unbound-audio', storageKey: 'recipient-secret-key' });
	const project = projectWithSources('unbound-shared', [source]);
	const missingBinding = projectWithSources(project.id, []);

	for (const prior of [null, missingBinding]) {
		const calls: string[] = [];
		await assert.rejects(
			verifyDesktopSharedProjectSourceAvailability(project, prior, refusingStore(calls)),
			isUnavailable,
		);
		assert.deepEqual(calls, []);
	}
});

test('recipient binding covers persisted identity and kind-specific media geometry', async () => {
	const audio = audioSource({ id: 'bound-audio', storageKey: 'bound-audio-pcm' });
	const audioProject = projectWithSources('audio-binding-project', [audio]);
	const audioChanges: ReadonlyArray<readonly [string, unknown]> = [
		['storageKey', 'other-pcm'],
		['mimeType', 'audio/flac'],
		['frameCount', Number(audio.frameCount) + 1],
		['sampleRate', 44_100],
		['channelCount', Number(audio.channelCount) + 1],
		['originalSampleRate', 96_000],
		['sampleFormat', 'int16'],
		['chunkFrames', Number(audio.chunkFrames) + 1],
	];
	const video = videoSource({ id: 'bound-video', storageKey: 'bound-video-media' });
	const videoProject = projectWithSources('video-binding-project', [video]);
	const videoChanges: ReadonlyArray<readonly [string, unknown]> = [
		['storageKey', 'other-media'],
		['mimeType', 'video/webm'],
		['sampleFrameCount', Number(video.sampleFrameCount) + 1],
		['sampleRate', 44_100],
		['width', 1_280],
		['height', 720],
		['frameRate', 24],
		['videoCodec', 'vp9'],
		['audioCodec', 'opus'],
		['hasAudio', false],
	];
	for (const [project, source, changes] of [
		[audioProject, audio, audioChanges],
		[videoProject, video, videoChanges],
	] as const) {
		for (const [field, value] of changes) {
			const calls: string[] = [];
			const changed = {
				...source, [field]: value,
				...(source.kind === 'video' && field === 'frameRate'
					? { timingDecision: { mode: 'conform-cfr-at-ingest', rate: value } } : {}),
			};
			await assert.rejects(
				verifyDesktopSharedProjectSourceAvailability(
					project,
					priorProject(project, [changed]),
					refusingStore(calls),
				),
				isUnavailable,
				`${String(source.kind)} binding field ${field}`,
			);
			assert.deepEqual(calls, [], `${String(source.kind)} binding field ${field}`);
		}
	}
});

test('disposable video preview locators do not change durable recipient bindings', async () => {
	const first = videoSource({
		id: 'preview-alias-a',
		storageKey: 'shared-video-original',
		posterStorageKey: 'current-poster-a',
		thumbnailStorageKey: 'current-thumbnail-a',
	});
	const second = videoSource({
		id: 'preview-alias-b',
		storageKey: 'shared-video-original',
		posterStorageKey: 'current-poster-b',
		thumbnailStorageKey: 'current-thumbnail-b',
	});
	const project = projectWithSources('preview-locator-binding', [first, second]);
	const prior = priorProject(project, [{
		...first,
		posterStorageKey: 'prior-poster-a',
		thumbnailStorageKey: 'prior-thumbnail-a',
	}, {
		...second,
		posterStorageKey: 'prior-poster-b',
		thumbnailStorageKey: 'prior-thumbnail-b',
	}]);
	const body = new Blob(['shared video original'], { type: String(first.mimeType) });
	const sha256 = await digestMediaContent(body);
	let metadataReads = 0;
	let bodyReads = 0;
	const store = availabilityStore({
		getMediaAssetMetadata(sourceId) {
			assert.equal(sourceId, 'shared-video-original');
			metadataReads += 1;
			return storedVideoMetadata(first, body.size, sha256);
		},
		loadMediaAsset(sourceId) {
			assert.equal(sourceId, 'shared-video-original');
			bodyReads += 1;
			return body;
		},
	});

	await verifyDesktopSharedProjectSourceAvailability(project, prior, store);

	assert.equal(metadataReads, 2);
	assert.equal(bodyReads, 1);
});

test('compatible duplicate recipient storage-key bindings verify one shared payload', async () => {
	const first = audioSource({ id: 'duplicate-a', storageKey: 'shared-storage-key' });
	const second = audioSource({ id: 'duplicate-b', storageKey: 'shared-storage-key' });
	const project = projectWithSources('duplicate-storage-binding', [first, second]);
	let metadataReads = 0;
	let bodyReads = 0;
	const store = availabilityStore({
		getSourceMetadata() {
			metadataReads += 1;
			return storedAudioMetadata(first);
		},
		async *readSourceChunks() {
			bodyReads += 1;
			yield chunk(0, [[1, 2]]);
			yield chunk(1, [[3, 4]]);
		},
	});

	await verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), store);

	assert.equal(metadataReads, 2);
	assert.equal(bodyReads, 1);
});

test('short and malformed recipient PCM fail as source-unavailable', async () => {
	const source = audioSource({
		id: 'checked-audio',
		storageKey: 'checked-pcm',
		frameCount: 3,
		channelCount: 2,
		chunkFrames: 2,
	});
	const project = projectWithSources('checked-audio-project', [source]);
	const prior = priorProject(project);
	const cases: ReadonlyArray<readonly [string, readonly StoredChunk[]]> = [
		['short', [chunk(0, [[1, 2], [3, 4]])]],
		['misaligned', [
			{ index: 0, frames: 2, channels: [Float32Array.of(1, 2), Float32Array.of(3)] },
		]],
		['wrong-index', [chunk(1, [[1, 2], [3, 4]])]],
		['wrong-frames', [
			{ index: 0, frames: 1, channels: [Float32Array.of(1, 2), Float32Array.of(3, 4)] },
		]],
		['extra', [
			chunk(0, [[1, 2], [3, 4]]),
			chunk(1, [[5], [6]]),
			chunk(2, [[7], [8]]),
		]],
	];

	for (const [label, chunks] of cases) {
		await assert.rejects(
			verifyDesktopSharedProjectSourceAvailability(project, prior, audioStore(source, chunks)),
			isUnavailable,
			label,
		);
	}
});

test('recipient PCM validation ignores provider-shadowed array predicates', async () => {
	const source = audioSource({
		id: 'shadowed-audio', storageKey: 'shadowed-pcm', frameCount: 2, chunkFrames: 2,
	});
	const project = projectWithSources('shadowed-audio-project', [source]);
	const channels = [null] as unknown as Float32Array[];
	Object.defineProperty(channels, 'every', { value: () => true });
	Object.defineProperty(channels, 'some', { value: () => false });
	const store = audioStore(source, [{ index: 0, frames: 2, channels }]);

	await assert.rejects(
		verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), store),
		isUnavailable,
	);
});

test('missing recipient video body fails as source-unavailable', async () => {
	const source = videoSource({ id: 'missing-video', storageKey: 'missing-video-body' });
	const project = projectWithSources('missing-video-project', [source]);
	const store = availabilityStore({
		getMediaAssetMetadata(sourceId) {
			assert.equal(sourceId, source.storageKey);
			return storedVideoMetadata(source, 12, '0'.repeat(64));
		},
		loadMediaAsset(sourceId, options) {
			assert.equal(sourceId, source.storageKey);
			assert.deepEqual(options, { signal: undefined });
			return null;
		},
	});

	await assert.rejects(
		verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), store),
		isUnavailable,
	);
});

test('recipient video requires a trusted content digest before its body is read', async () => {
	const source = videoSource({ id: 'digestless-video', storageKey: 'digestless-video-body' });
	const project = projectWithSources('digestless-video-project', [source]);
	let bodyReads = 0;
	const store = availabilityStore({
		getMediaAssetMetadata() {
			return storedVideoMetadata(source, 12);
		},
		loadMediaAsset() {
			bodyReads += 1;
			return new Blob(['untrusted']);
		},
	});

	await assert.rejects(
		verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), store),
		isUnavailable,
	);
	assert.equal(bodyReads, 0);
});

test('recipient video bytes must match a trusted local content digest', async () => {
	const source = videoSource({ id: 'changed-video', storageKey: 'changed-video-body' });
	const project = projectWithSources('changed-video-project', [source]);
	const body = new Blob(['changed recipient video'], { type: String(source.mimeType) });
	const store = availabilityStore({
		getMediaAssetMetadata() {
			return storedVideoMetadata(source, body.size, '0'.repeat(64));
		},
		loadMediaAsset() { return body; },
	});

	await assert.rejects(
		verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), store),
		isUnavailable,
	);
});

test('the cumulative 65,536 audio-chunk ceiling is preflighted before recipient I/O', async () => {
	const first = audioSource({
		id: 'chunk-budget-a',
		storageKey: 'chunk-budget-a-pcm',
		frameCount: 65_536,
		chunkFrames: 1,
	});
	const second = audioSource({
		id: 'chunk-budget-b',
		storageKey: 'chunk-budget-b-pcm',
		frameCount: 1,
		chunkFrames: 1,
	});
	const project = projectWithSources('over-chunk-budget', [first, second]);
	const calls: string[] = [];

	await assert.rejects(
		verifyDesktopSharedProjectSourceAvailability(project, priorProject(project), refusingStore(calls)),
		(error: unknown) => error instanceof RangeError && /chunk/iu.test(error.message),
	);
	assert.deepEqual(calls, []);
});

test('active cancellation returns the PCM iterator and preserves the exact reason', async () => {
	const source = audioSource({
		id: 'cancelled-audio',
		storageKey: 'cancelled-audio-pcm',
		frameCount: 2,
		chunkFrames: 1,
	});
	const project = projectWithSources('cancelled-project', [source]);
	const controller = new AbortController();
	const reason = new Error('cancel recipient availability');
	let returned = 0;
	let readOptions: unknown;
	const cleanupGate = deferred<void>();
	const iterator: AsyncIterableIterator<StoredChunk> = {
		async next() {
			controller.abort(reason);
			return { done: false, value: chunk(0, [[1]]) };
		},
		async return() {
			returned += 1;
			await cleanupGate.promise;
			return { done: true, value: undefined };
		},
		[Symbol.asyncIterator]() { return iterator; },
	};
	const store = availabilityStore({
		getSourceMetadata(sourceId) {
			assert.equal(sourceId, source.storageKey);
			return storedAudioMetadata(source);
		},
		readSourceChunks(sourceId, options) {
			assert.equal(sourceId, source.storageKey);
			readOptions = options;
			return iterator;
		},
	});

	let timeout: ReturnType<typeof setTimeout> | undefined;
	const verification = verifyDesktopSharedProjectSourceAvailability(
		project,
		priorProject(project),
		store,
		{ signal: controller.signal },
	);
	try {
		await assert.rejects(
			Promise.race([
				verification,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => { reject(new Error('availability cancellation stalled')); }, 100);
				}),
			]),
			(error: unknown) => error === reason,
		);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
	assert.deepEqual(readOptions, {
		signal: controller.signal,
	});
	assert.equal(returned, 1);
});

function availabilityStore(
	overrides: Partial<DesktopSharedProjectSourceAvailabilityStore> = {},
): DesktopSharedProjectSourceAvailabilityStore {
	const defaults: DesktopSharedProjectSourceAvailabilityStore = {
		getSourceMetadata() { return null; },
		getMediaAssetMetadata() { return null; },
		async *readSourceChunks() { return; },
		loadMediaAsset() { return null; },
	};
	return Object.assign(defaults, overrides);
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function refusingStore(calls: string[]): DesktopSharedProjectSourceAvailabilityStore {
	return availabilityStore({
		getSourceMetadata() { calls.push('source-metadata'); throw new Error('unexpected source metadata read'); },
		getMediaAssetMetadata() { calls.push('media-metadata'); throw new Error('unexpected media metadata read'); },
		readSourceChunks() { calls.push('audio-body'); throw new Error('unexpected audio body read'); },
		loadMediaAsset() { calls.push('video-body'); throw new Error('unexpected video body read'); },
	});
}

function audioStore(
	source: Readonly<Record<string, unknown>>,
	chunks: readonly StoredChunk[],
): DesktopSharedProjectSourceAvailabilityStore {
	return availabilityStore({
		getSourceMetadata(sourceId) {
			return sourceId === source.storageKey ? storedAudioMetadata(source) : null;
		},
		async *readSourceChunks() { yield* chunks; },
	});
}

function storedAudioMetadata(source: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return {
		...source,
		id: source.storageKey,
		frameLength: source.frameCount,
		chunkCount: Math.ceil(Number(source.frameCount) / Number(source.chunkFrames)),
		storage: 'indexeddb-chunks',
		sourceToken: `${String(source.storageKey)}:generation-1`,
		committedAt: PRIOR_NOW,
	};
}

function storedVideoMetadata(
	source: Readonly<Record<string, unknown>>,
	size: number,
	sha256?: string,
): Readonly<Record<string, unknown>> {
	return {
		sourceId: source.storageKey,
		size,
		mimeType: source.mimeType,
		storage: 'indexeddb-blob',
		committedAt: PRIOR_NOW,
		...(sha256 === undefined ? {} : { sha256 }),
	};
}

function chunk(index: number, channels: readonly (readonly number[])[]): StoredChunk {
	const pcm = channels.map((channel) => Float32Array.from(channel));
	return { index, frames: pcm[0]?.length ?? 0, channels: pcm };
}

function audioSource(
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return createAudioSource({
		id: 'audio-source',
		name: 'Audio source',
		mimeType: 'audio/wav',
		storageKey: 'audio-source-pcm',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
		...overrides,
	});
}

function videoSource(
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return createVideoSource({
		id: 'video-source',
		name: 'Video source',
		mimeType: 'video/mp4',
		storageKey: 'video-source-media',
		frameCount: 12,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		posterStorageKey: 'video-poster',
		thumbnailStorageKey: 'video-thumbnail',
		...overrides,
	});
}

function projectWithSources(
	id: string,
	sources: readonly Readonly<Record<string, unknown>>[],
): AudioEditorProjectCurrent {
	const timelineClips: Readonly<Record<string, unknown>>[] = [];
	const tracks: Readonly<Record<string, unknown>>[] = [];
	const binClips: Readonly<Record<string, unknown>>[] = [];
	for (const [index, source] of sources.entries()) {
		const sourceId = String(source.id);
		if (index === 0 && source.kind === 'audio') {
			const clip = createAudioClip({
				id: `${sourceId}-timeline-clip`,
				sourceId,
				durationFrames: Math.min(2, Number(source.frameCount)),
			});
			timelineClips.push(clip);
			tracks.push(createAudioTrack({ id: `${sourceId}-track`, clipIds: [clip.id] }));
			continue;
		}
		const clipOptions = {
			id: `${sourceId}-bin-clip`,
			sourceId,
			durationFrames: Math.min(2, Number(source.kind === 'video' ? source.sampleFrameCount : source.frameCount)),
			binItemId: `${sourceId}-bin-item`,
		};
		binClips.push(source.kind === 'video'
			? createVideoClip(clipOptions)
			: createAudioClip(clipOptions));
	}
	return createCurrentAudioEditorProject({
		id,
		title: `Project ${id}`,
		revision: 2,
		now: NOW,
		sources,
		clips: timelineClips,
		tracks,
		projectBin: { clips: binClips },
	});
}

function priorProject(
	project: AudioEditorProjectCurrent,
	sources: readonly Readonly<Record<string, unknown>>[] = project.sources,
): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		...project,
		revision: 1,
		createdAt: PRIOR_NOW,
		updatedAt: PRIOR_NOW,
		sources,
	});
}
function isUnavailable(error: unknown): boolean {
	assert.ok(error instanceof DesktopSharedProjectSourceUnavailableError);
	return true;
}
