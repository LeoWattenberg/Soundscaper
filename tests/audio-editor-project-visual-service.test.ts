import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectVisualService,
	type ProjectVisualServiceDependencies,
} from '../src/common/editor/controller/project-visual-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

type VideoDerivatives = Awaited<ReturnType<
	ProjectVisualServiceDependencies['store']['listVideoDerivatives']
>>;

test('visual service assembles timeline and compound project-bin media from one inventory', () => {
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(['missing', 'video']),
		sourceBuffers: new Map([['audio', { buffer: true }]]),
		sourcePeaks: new Map([['audio', { levels: [] }]]),
		waveformPcmWindows: new Map([['audio-clip', { startFrame: 4 }]]),
		store: emptyStore(),
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});

	const timeline = service.getClipVisualData('audio-clip');
	assert.equal(timeline?.track?.id, 'audio-track');
	assert.deepEqual(timeline?.buffer, { buffer: true });
	assert.deepEqual(timeline?.pcmWindow, { startFrame: 4 });
	assert.equal(timeline?.available, true);

	const bin = service.getProjectBinClipVisualData('bin-video');
	assert.equal(bin?.videoClip?.id, 'bin-video');
	assert.deepEqual(bin?.itemClips?.map((clip) => clip.id), ['bin-video', 'bin-audio']);
	assert.equal(service.allProjectClips().length, 5);
	assert.equal(service.hasMissingTimelineSources(), true);
	assert.equal(service.hasMissingTimelineSources(undefined, { audioOnly: true }), true);
	assert.equal(service.hasMissingTimelineSources(undefined, {
		excludedSourceIds: new Set(['missing']),
	}), true, 'another missing timeline source must remain visible');
	assert.equal(service.hasMissingTimelineSources(undefined, {
		excludedSourceIds: new Set(['missing', 'video']),
	}), false, 'only the exact excluded source IDs may be ignored');
	assert.deepEqual(service.getVisibleClips({ startFrame: 0, endFrame: 100, overscanFrames: 0 })
		.map((visual) => visual?.clip.id), ['audio-clip']);
});

test('late video derivatives are revoked and cannot resurrect a superseded visual', async () => {
	const derivatives = deferred<VideoDerivatives>();
	const urls = fakeUrlPort();
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => new Blob(['video']),
			listVideoDerivatives: async () => derivatives.promise,
			loadVideoDerivative: async () => new Blob(['poster']),
		},
		projectDurationFrames: () => 1_000,
		url: urls,
	});

	const activation = service.activateVideoSource(project.sources[1]);
	await Promise.resolve();
	await service.revokeVideoVisual('video');
	derivatives.resolve([{ type: 'poster', timestamp: 0, width: 320, height: 180 }]);

	assert.equal(await activation, null);
	assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, null);
	assert.deepEqual(urls.revoked, ['blob:1']);
});

test('video activation resolves an exact project-scoped linked original after retained media misses', async () => {
	const project = projectFixture();
	const linkedBody = new Blob(['linked-video']);
	const resolutions: Array<Readonly<{ projectId: string; sourceId: string }>> = [];
	const derivativeReads: string[] = [];
	const binding = Object.freeze({ bindingToken: 'binding-linked-video' });
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async () => null,
			resolveLinkedVideoOriginal: async (projectId, source) => {
				resolutions.push({ projectId, sourceId: source.id });
				return { blob: linkedBody, binding };
			},
			listVideoDerivatives: async () => { throw new Error('retained derivative lookup'); },
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async (projectId, source, currentBinding) => {
				assert.equal(projectId, project.id);
				assert.equal(source.id, 'video');
				assert.equal(currentBinding, binding);
				derivativeReads.push('list');
				return [{ type: 'poster', timestamp: 0, width: 320, height: 180 }];
			},
			loadLinkedVideoDerivative: async (_projectId, _source, currentBinding) => {
				assert.equal(currentBinding, binding);
				derivativeReads.push('load');
				return new Blob(['linked-poster']);
			},
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});

	const visual = await service.activateVideoSource(project.sources[1]);

	assert.equal(visual?.mediaUrl, 'blob:1');
	assert.deepEqual(service.getVideoSourceVisualData('video'), {
		source: project.sources[1],
		available: true,
		mediaUrl: 'blob:1',
		posterUrl: 'blob:2',
		thumbnails: [],
	});
	assert.equal(service.getVideoSourceVisualData('audio'), null);
	assert.equal(service.getVideoSourceVisualData('unknown'), null);
	assert.deepEqual(resolutions, [{ projectId: project.id, sourceId: 'video' }]);
	assert.deepEqual(derivativeReads, ['list', 'load']);
});

test('video activation rejects a digest-valid reference whose durable timing body is corrupt', async () => {
	const project = projectFixture();
	const sourceSha256 = '11'.repeat(32);
	const publication = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1_000,
		presentationTicks: [0n, 40n],
		finalFrameDurationTicks: 40n,
	});
	Object.assign(project.sources[1], {
		contentSha256: sourceSha256,
		timingAsset: publication.reference,
	});
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async (storageKey) => storageKey === publication.reference.storageKey
				? new Blob([new Uint8Array(publication.bytes.byteLength)])
				: new Blob(['video']),
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});

	await assert.rejects(service.activateVideoSource(project.sources[1]), /timing asset is corrupt/iu);
});

test('video activation owns ranged linked playback without materializing another original Blob', async () => {
	const project = projectFixture();
	const binding = Object.freeze({ bindingToken: 'binding-ranged-video' });
	const releases: string[] = [];
	const urls = fakeUrlPort();
	let wholeBlobResolutions = 0;
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async (projectId, source) => {
				assert.equal(projectId, project.id);
				assert.equal(source.id, 'video');
				return {
					binding,
					mediaUrl: 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/read/video.mp4',
					release: async () => { releases.push('lease'); },
				};
			},
			resolveLinkedVideoOriginal: async () => {
				wholeBlobResolutions += 1;
				throw new Error('must not materialize the linked original');
			},
			listVideoDerivatives: async () => { throw new Error('retained derivative lookup'); },
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async (_projectId, _source, currentBinding) => {
				assert.equal(currentBinding, binding);
				return [{ type: 'poster', timestamp: 0, width: 320, height: 180 }];
			},
			loadLinkedVideoDerivative: async () => new Blob(['linked-poster']),
		},
		projectDurationFrames: () => 1_000,
		url: urls,
	});

	const visual = await service.activateVideoSource(project.sources[1]);
	assert.equal(visual?.mediaUrl, 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/read/video.mp4');
	assert.equal(visual?.posterUrl, 'blob:1');
	assert.equal(wholeBlobResolutions, 0);
	assert.equal(await service.revokeVideoVisual('video', 'blob:stale'), false);
	assert.deepEqual(releases, []);
	assert.equal(service.getVideoSourceVisualData('video')?.mediaUrl, visual?.mediaUrl);
	assert.equal(await service.revokeVideoVisual('video', visual?.mediaUrl), true);
	assert.deepEqual(releases, ['lease']);
	assert.deepEqual(urls.revoked, ['blob:1']);
	assert.equal(await service.revokeVideoVisual('video', visual?.mediaUrl), false);
	assert.deepEqual(releases, ['lease']);
});

test('linked playback admission failures do not retry through whole-Blob resolution', async () => {
	const project = projectFixture();
	const admissionError = new Error('linked playback admission failed');
	let wholeBlobResolutions = 0;
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async () => { throw admissionError; },
			resolveLinkedVideoOriginal: async () => {
				wholeBlobResolutions += 1;
				return null;
			},
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});

	await assert.rejects(service.activateVideoSource(project.sources[1]), (error: unknown) => (
		error === admissionError
	));
	assert.equal(wholeBlobResolutions, 0);
});

test('superseded and cancelled linked playback activations release their exact lease', async () => {
	const initialProject = projectFixture();
	let currentProject = initialProject;
	const admitted = deferred<Readonly<{
		binding: Readonly<{ bindingToken: string }>;
		mediaUrl: string;
		release(): Promise<void>;
	}>>();
	let staleReleases = 0;
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(initialProject.id);
	const staleService = createProjectVisualService({
		getProject: () => currentProject,
		captureProject: (projectId) => projectGeneration.capture(projectId),
		assertProject: (token) => projectGeneration.assertCurrent(
			token as ReturnType<EditorProjectGeneration['capture']>,
		),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async () => admitted.promise,
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});
	const staleActivation = staleService.activateVideoSource(initialProject.sources[1]);
	await Promise.resolve();
	currentProject = { ...initialProject };
	projectGeneration.invalidate();
	projectGeneration.activate(initialProject.id);
	admitted.resolve({
		binding: { bindingToken: 'stale-binding' },
		mediaUrl: 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/stale/video.mp4',
		release: async () => { staleReleases += 1; },
	});
	await assert.rejects(staleActivation, (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
	assert.equal(staleReleases, 1);

	const controller = new AbortController();
	const reason = new Error('cancel visual activation');
	const derivatives = deferred<VideoDerivatives>();
	let cancelledReleases = 0;
	const cancelledService = createProjectVisualService({
		getProject: () => initialProject,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async (_projectId, _source, options) => {
				assert.equal(options?.signal, controller.signal);
				return {
					binding: { bindingToken: 'cancelled-binding' },
					mediaUrl: 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/cancelled/video.mp4',
					release: async () => { cancelledReleases += 1; },
				};
			},
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async () => derivatives.promise,
			loadLinkedVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});
	const cancelledActivation = cancelledService.activateVideoSource(initialProject.sources[1], {
		signal: controller.signal,
	});
	await Promise.resolve();
	await Promise.resolve();
	controller.abort(reason);
	derivatives.resolve([]);
	await assert.rejects(cancelledActivation, (error: unknown) => error === reason);
	assert.equal(cancelledReleases, 1);
});

test('video replacement rechecks ownership after awaiting the previous lease release', async () => {
	const project = projectFixture();
	const firstRelease = deferred<void>();
	const releaseStarted = deferred<void>();
	const releases: string[] = [];
	let admissions = 0;
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async () => {
				admissions += 1;
				const admission = admissions;
				return {
					binding: { bindingToken: `binding-${admission}` },
					mediaUrl: `soundscaper-app://bundle/_desktop/read/linked-video-range-v1/${admission}/video.mp4`,
					async release() {
						releases.push(`${admission}:start`);
						if (admission === 1) {
							releaseStarted.resolve();
							await firstRelease.promise;
						}
						releases.push(`${admission}:done`);
					},
				};
			},
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async () => [],
			loadLinkedVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});
	await service.activateVideoSource(project.sources[1]);
	const replacement = service.activateVideoSource(project.sources[1]);
	await releaseStarted.promise;
	assert.equal(service.getVideoSourceVisualData('video')?.mediaUrl, null);
	assert.equal(await service.revokeVideoVisual('video'), false);
	firstRelease.resolve();
	assert.equal(await replacement, null);
	assert.deepEqual(releases, ['1:start', '1:done', '2:start', '2:done']);
});

test('video cleanup preserves activation failures and drains every disposal lease', async () => {
	const project = projectFixture();
	const activationError = new Error('derivative admission failed');
	const cleanupError = new Error('candidate lease cleanup failed');
	const failed = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async () => ({
				binding: { bindingToken: 'failed-binding' },
				mediaUrl: 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/failed/video.mp4',
				release: async () => { throw cleanupError; },
			}),
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async () => { throw activationError; },
			loadLinkedVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});
	await assert.rejects(failed.activateVideoSource(project.sources[1]), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors[0], activationError);
		assert.equal(error.errors[1], cleanupError);
		return true;
	});

	const releaseCalls: string[] = [];
	const sourceTwo = { ...project.sources[1], id: 'video-two', storageKey: 'video-two' };
	const disposing = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			leaseLinkedVideoOriginalPlayback: async (_projectId, source) => ({
				binding: { bindingToken: source.id },
				mediaUrl: `soundscaper-app://bundle/_desktop/read/linked-video-range-v1/${source.id}/video.mp4`,
				async release() {
					releaseCalls.push(source.id);
					if (source.id === 'video') throw new Error('first disposal failed');
				},
			}),
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async () => [],
			loadLinkedVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: fakeUrlPort(),
	});
	await disposing.activateVideoSource(project.sources[1]);
	await disposing.activateVideoSource(sourceTwo);
	const firstDisposal = disposing.dispose();
	assert.equal(disposing.dispose(), firstDisposal);
	await assert.rejects(firstDisposal, /first disposal failed/u);
	assert.deepEqual(releaseCalls, ['video', 'video-two']);
	assert.equal(await disposing.activateVideoSource(project.sources[1]), null);
});

test('linked derivative refusal revokes the already-created media URL', async () => {
	const project = projectFixture();
	const urls = fakeUrlPort();
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			resolveLinkedVideoOriginal: async () => ({
				blob: new Blob(['linked-video']), binding: { bindingToken: 'stale' },
			}),
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			listLinkedVideoDerivatives: async () => { throw new Error('binding changed'); },
			loadLinkedVideoDerivative: async () => null,
		},
		projectDurationFrames: () => 1_000,
		url: urls,
	});

	await assert.rejects(service.activateVideoSource(project.sources[1]), /binding changed/u);
	assert.deepEqual(urls.revoked, ['blob:1']);
	assert.equal(service.getVideoSourceVisualData('video')?.mediaUrl, null);
});

test('replacing and disposing video visuals revokes every owned URL exactly once', async () => {
	const urls = fakeUrlPort();
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
		...projectFence(),
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => new Blob(['video']),
			listVideoDerivatives: async () => [
				{ type: 'poster', timestamp: 0, width: 320, height: 180 },
				{ type: 'thumbnail', timestamp: 1, width: 160, height: 90 },
			],
			loadVideoDerivative: async () => new Blob(['image']),
		},
		projectDurationFrames: () => 1_000,
		url: urls,
	});

	await service.activateVideoSource(project.sources[1]);
	assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, 'blob:1');
	await service.dispose();
	await service.dispose();

	assert.deepEqual(urls.revoked, ['blob:1', 'blob:2', 'blob:3']);
	assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, null);
});

function projectFixture() {
	return {
		id: 'project',
		schemaVersion: 5,
		sampleRate: 48_000,
		sources: [
			{ id: 'audio', kind: 'audio', storageKey: 'audio' },
			{ id: 'video', kind: 'video', storageKey: 'video' },
			{ id: 'missing', kind: 'audio', storageKey: 'missing' },
		],
		clips: [
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100 },
			{ id: 'video-clip', kind: 'video', sourceId: 'video', timelineStartFrame: 200, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100 },
			{ id: 'missing-clip', kind: 'audio', sourceId: 'missing', timelineStartFrame: 400, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100 },
		],
		tracks: [
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip', 'missing-clip'] },
			{ id: 'video-track', type: 'video', clipIds: ['video-clip'] },
		],
		projectBin: {
			clips: [
				{ id: 'bin-video', kind: 'video', sourceId: 'video', binItemId: 'item', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100 },
				{ id: 'bin-audio', kind: 'audio', sourceId: 'audio', binItemId: 'item', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100 },
			],
		},
	};
}

function emptyStore() {
	return {
		loadMediaAsset: async () => null,
		listVideoDerivatives: async () => [],
		loadVideoDerivative: async () => null,
	};
}

function fakeUrlPort() {
	let next = 0;
	const revoked: string[] = [];
	return {
		revoked,
		createObjectURL: (_blob: Blob) => `blob:${++next}`,
		revokeObjectURL: (url: string) => { revoked.push(url); },
	};
}

function projectFence() {
	return {
		captureProject: (projectId: string) => projectId,
		assertProject: (_token: unknown) => undefined,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((fulfill) => { resolve = fulfill; });
	return { promise, resolve };
}
