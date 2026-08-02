import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectVisualService,
	type ProjectVisualServiceDependencies,
} from '../src/common/editor/controller/project-visual-service.ts';

type VideoDerivatives = Awaited<ReturnType<
	ProjectVisualServiceDependencies['store']['listVideoDerivatives']
>>;

test('visual service assembles timeline and compound project-bin media from one inventory', () => {
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
		missingSourceIds: new Set(['missing']),
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
	assert.deepEqual(service.getVisibleClips({ startFrame: 0, endFrame: 100, overscanFrames: 0 })
		.map((visual) => visual?.clip.id), ['audio-clip']);
});

test('late video derivatives are revoked and cannot resurrect a superseded visual', async () => {
	const derivatives = deferred<VideoDerivatives>();
	const urls = fakeUrlPort();
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
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
	service.revokeVideoVisual('video');
	derivatives.resolve([{ type: 'poster', timestamp: 0, width: 320, height: 180 }]);

	assert.equal(await activation, null);
	assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, null);
	assert.deepEqual(urls.revoked, ['blob:1']);
});

test('video activation resolves an exact project-scoped linked original after retained media misses', async () => {
	const project = projectFixture();
	const linkedBody = new Blob(['linked-video']);
	const resolutions: Array<Readonly<{ projectId: string; sourceId: string }>> = [];
	const service = createProjectVisualService({
		getProject: () => project,
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			loadMediaAsset: async () => null,
			resolveLinkedVideoOriginal: async (projectId, source) => {
				resolutions.push({ projectId, sourceId: source.id });
				return { blob: linkedBody };
			},
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
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
		posterUrl: null,
		thumbnails: [],
	});
	assert.equal(service.getVideoSourceVisualData('audio'), null);
	assert.equal(service.getVideoSourceVisualData('unknown'), null);
	assert.deepEqual(resolutions, [{ projectId: project.id, sourceId: 'video' }]);
});

test('replacing and disposing video visuals revokes every owned URL exactly once', async () => {
	const urls = fakeUrlPort();
	const project = projectFixture();
	const service = createProjectVisualService({
		getProject: () => project,
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
	service.dispose();
	service.dispose();

	assert.deepEqual(urls.revoked, ['blob:1', 'blob:2', 'blob:3']);
	assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, null);
});

function projectFixture() {
	return {
		id: 'project',
		schemaVersion: 5,
		sources: [
			{ id: 'audio', kind: 'audio', storageKey: 'audio' },
			{ id: 'video', kind: 'video', storageKey: 'video' },
			{ id: 'missing', kind: 'audio', storageKey: 'missing' },
		],
		clips: [
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio', timelineStartFrame: 0, durationFrames: 100 },
			{ id: 'video-clip', kind: 'video', sourceId: 'video', timelineStartFrame: 200, durationFrames: 100 },
			{ id: 'missing-clip', kind: 'audio', sourceId: 'missing', timelineStartFrame: 400, durationFrames: 100 },
		],
		tracks: [
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip', 'missing-clip'] },
			{ id: 'video-track', type: 'video', clipIds: ['video-clip'] },
		],
		projectBin: {
			clips: [
				{ id: 'bin-video', kind: 'video', sourceId: 'video', binItemId: 'item', timelineStartFrame: 0, durationFrames: 100 },
				{ id: 'bin-audio', kind: 'audio', sourceId: 'audio', binItemId: 'item', timelineStartFrame: 0, durationFrames: 100 },
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

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((fulfill) => { resolve = fulfill; });
	return { promise, resolve };
}
