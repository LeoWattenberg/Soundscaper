import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectBinService,
	type ProjectBinServiceDependencies,
} from '../src/common/editor/controller/project-bin-service.ts';
import type { ProjectBinPreviewEngine } from '../src/common/editor/controller/project-bin-preview-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type {
	ProjectBinClip,
	ProjectBinPreview,
	ProjectBinProject,
} from '../src/common/editor/controller/project-bin-types.ts';

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('project-bin operations preserve grouped moves and prepare atomic A/V placement IDs', () => {
	const timelineProject = projectFixture({
		clips: [
			clipFixture({ id: 'first', groupId: 'group' }),
			clipFixture({ id: 'second', groupId: 'group', timelineStartFrame: 2_000 }),
		],
		selectionClipIds: ['first'],
	});
	const move = createHarness(timelineProject);
	assert.deepEqual(move.service.moveClipsToProjectBin('first'), ['first', 'second']);
	assert.deepEqual(move.commits, [{
		command: { type: 'project-bin/move-from-timeline', clipIds: ['first', 'second'] },
		selection: { selectClipId: null },
	}]);

	const audio = clipFixture({ id: 'bin-audio', sourceId: 'audio', binItemId: 'media' });
	const video = clipFixture({
		id: 'bin-video',
		sourceId: 'video',
		kind: 'video',
		binItemId: 'media',
		videoEffects: [{ id: 'effect' }],
	});
	let positionFrames = 17;
	const placement = createHarness(projectFixture({
		clips: [],
		projectBinClips: [video, audio],
		sources: [
			{ id: 'audio', kind: 'audio', sampleRate: 48_000, frameCount: 8_000, channelCount: 2 },
			{ id: 'video', kind: 'video', sampleRate: 48_000, frameCount: 8_000 },
		],
	}), { getPositionFrames: () => positionFrames });
	positionFrames = 42;
	const placedId = placement.service.placeProjectBinClip('bin-video');
	assert.match(placedId ?? '', /^clip-/);
	const placementCommit = placement.commits[0];
	assert.equal(placementCommit?.command.type, 'batch');
	if (placementCommit?.command.type !== 'batch') assert.fail('Expected an atomic placement batch.');
	assert.deepEqual(placementCommit.command.commands.map((command) => command.type), [
		'track/add', 'track/add', 'project-bin/place',
	]);
	const placeCommand = placementCommit.command.commands[2];
	assert.equal(placeCommand?.type, 'project-bin/place');
	if (placeCommand?.type !== 'project-bin/place') assert.fail('Expected a project-bin placement command.');
	assert.equal(placeCommand.timelineStartFrame, 42);
	assert.equal(placeCommand.placements?.length, 2);
	assert.match(placeCommand.avLinkId ?? '', /^av-link-/);
	assert.match(String(placeCommand.placements?.[0]?.videoEffectIds), /video-effect-/);
	assert.equal(placementCommit.selection?.selectClipId, placedId);
});

test('project-bin metadata and instance actions use one semantic source inventory', () => {
	const binClip = clipFixture({ id: 'bin', sourceId: 'shared', binItemId: 'item' });
	const first = clipFixture({ id: 'first', sourceId: 'shared', groupId: 'group' });
	const companion = clipFixture({ id: 'companion', sourceId: 'other', groupId: 'group' });
	const harness = createHarness(projectFixture({
		clips: [first, companion],
		projectBinClips: [binClip],
		sources: [
			{ id: 'shared', kind: 'audio', sampleRate: 48_000, frameCount: 8_000, channelCount: 1 },
			{ id: 'other', kind: 'audio', sampleRate: 48_000, frameCount: 8_000, channelCount: 1 },
		],
	}));

	assert.equal(harness.service.renameProjectBinClip('bin', '  Reusable  '), 'Reusable');
	assert.throws(() => harness.service.renameProjectBinClip('bin', '  '), TypeError);
	assert.equal(harness.service.setProjectBinClipColor('bin', 'green'), 'green');
	assert.throws(() => harness.service.setProjectBinClipColor('bin', 'orange'), RangeError);
	assert.equal(harness.service.projectBinInstanceCount('bin'), 1);
	assert.deepEqual(harness.service.selectProjectBinInstances('bin'), ['first', 'companion']);
	assert.equal(harness.selectedClipId, 'first');
	assert.equal(harness.selectedTrackId, 'track');
	assert.deepEqual(harness.selectionCommands[0]?.clipIds, ['first', 'companion']);
	assert.deepEqual(harness.service.removeProjectBinSource('bin'), ['first']);
	assert.equal(harness.service.removeProjectBinClip('bin'), 'bin');
	assert.throws(() => harness.service.removeProjectBinClip('missing'), /Audio clip not found/);

	const blocked = createHarness(harness.project, { editingBlocked: () => true });
	assert.equal(blocked.service.moveClipsToProjectBin('first'), null);
	assert.equal(blocked.service.placeProjectBinClip('bin'), null);
	assert.equal(blocked.service.renameProjectBinClip('bin', 'Name'), null);
	assert.equal(blocked.service.removeProjectBinClip('bin'), null);
	assert.equal(blocked.service.setProjectBinClipColor('bin', 'green'), null);
	assert.equal(blocked.service.removeProjectBinSource('bin'), null);
});

test('replacement staging restores the active document and applies compatible media atomically', async () => {
	const originalClip = clipFixture({
		id: 'bin',
		sourceId: 'old-source',
		binItemId: 'bin-item',
		sourceDurationFrames: 800,
		durationFrames: 800,
	});
	const timelineClip = clipFixture({
		id: 'instance',
		sourceId: 'old-source',
		sourceDurationFrames: 800,
		durationFrames: 800,
	});
	const base = projectFixture({
		clips: [timelineClip],
		projectBinClips: [originalClip],
		sources: [{
			id: 'old-source', kind: 'audio', sampleRate: 48_000, frameCount: 1_000, channelCount: 1,
		}],
	});
	const imported = projectFixture({
		id: base.id,
		clips: base.clips,
		projectBinClips: [clipFixture({
			id: 'imported-bin', sourceId: 'new-source', binItemId: 'imported-item',
		})],
		sources: [...base.sources, {
			id: 'new-source', kind: 'audio', sampleRate: 48_000, frameCount: 400, channelCount: 1,
		}],
	});
	const harnessRef: { current?: ReturnType<typeof createHarness> } = {};
	const protectedSourceIds = new Set<string>();
	const protectedDuringRestore: string[][] = [];
	const harness = createHarness(base, {
		protectedSourceIds,
		projectChanged: () => { protectedDuringRestore.push([...protectedSourceIds]); },
		importProjectBinFile: async () => {
			harnessRef.current?.replaceImportedDocument(imported);
			return { clipId: 'imported-bin' };
		},
	});
	harnessRef.current = harness;

	const prepared = await harness.service.prepareProjectBinReplacement('bin', { name: 'short.wav' });
	assert.equal(harness.project, base);
	assert.equal(harness.importing, false);
	assert.equal(harness.restoreCount, 1);
	assert.deepEqual(protectedDuringRestore, [['new-source']]);
	assert.deepEqual([...protectedSourceIds], ['new-source']);
	assert.deepEqual(prepared?.shortenedClipIds, ['instance', 'bin']);
	assert.equal(prepared?.requiresChoice, true);
	assert.equal(harness.service.applyProjectBinReplacement(prepared?.token ?? ''), 'bin');
	const applied = harness.commits.at(-1)?.command;
	assert.equal(applied?.type, 'batch');
	if (applied?.type !== 'batch') assert.fail('Expected an atomic replacement batch.');
	assert.deepEqual(applied.commands.map((command) => command.type), [
		'source/add', 'project-bin/replace-media',
	]);
	assert.deepEqual([...protectedSourceIds], []);
});

test('late replacement completion cannot restore or publish into a switched project', async () => {
	let resolveImport!: (result: { clipId: string }) => void;
	const imported = new Promise<{ clipId: string }>((resolve) => { resolveImport = resolve; });
	const base = projectFixture({
		projectBinClips: [clipFixture({ id: 'bin', binItemId: 'item' })],
	});
	const harness = createHarness(base, {
		importProjectBinFile: async () => imported,
	});
	const pending = harness.service.prepareProjectBinReplacement('bin', { name: 'late.wav' });
	await Promise.resolve();
	const publicationsBeforeSwitch = harness.publishCount;
	const switched = projectFixture({ id: 'other-project', projectBinClips: [] });
	harness.switchProject(switched);
	resolveImport({ clipId: 'imported-bin' });

	await assert.rejects(pending, { name: 'AbortError', code: 'PROJECT_CHANGED' });
	assert.equal(harness.project, switched);
	assert.equal(harness.restoreCount, 0);
	assert.equal(harness.publishCount, publicationsBeforeSwitch);
	assert.equal(harness.importing, false);
});

test('replacement cancellation removes staged audio/video assets and rejects stale application', async () => {
	const target = clipFixture({ id: 'bin', sourceId: 'old', binItemId: 'item' });
	const base = projectFixture({
		projectBinClips: [target],
		sources: [{ id: 'old', kind: 'audio', sampleRate: 48_000, frameCount: 1_000, channelCount: 1 }],
	});
	const importedAudio = projectFixture({
		id: base.id,
		projectBinClips: [clipFixture({ id: 'new-bin', sourceId: 'new', binItemId: 'new-item' })],
		sources: [{ id: 'new', kind: 'audio', sampleRate: 48_000, frameCount: 1_000, channelCount: 1 }],
	});
	const audioRef: { current?: ReturnType<typeof createHarness> } = {};
	const audioHarness = createHarness(base, {
		importProjectBinFile: async () => {
			audioRef.current?.replaceImportedDocument(importedAudio);
			return { clipId: 'new-bin' };
		},
	});
	audioRef.current = audioHarness;
	const prepared = await audioHarness.service.prepareProjectBinReplacement('bin', { name: 'new.wav' });
	assert.equal(await audioHarness.service.cancelProjectBinReplacement(prepared?.token ?? ''), true);
	assert.deepEqual(audioHarness.deletedSources, ['new']);
	assert.equal(await audioHarness.service.cancelProjectBinReplacement(prepared?.token ?? ''), false);

	const staleRef: { current?: ReturnType<typeof createHarness> } = {};
	const staleHarness = createHarness(base, {
		importProjectBinFile: async () => {
			staleRef.current?.replaceImportedDocument(importedAudio);
			return { clipId: 'new-bin' };
		},
	});
	staleRef.current = staleHarness;
	const stale = await staleHarness.service.prepareProjectBinReplacement('bin', { name: 'new.wav' });
	staleHarness.switchProject(projectFixture({ id: 'different' }));
	assert.throws(
		() => staleHarness.service.applyProjectBinReplacement(stale?.token ?? ''),
		/project changed/,
	);
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(staleHarness.deletedSources, ['new']);

	const importedVideo = projectFixture({
		id: base.id,
		projectBinClips: [clipFixture({
			id: 'video-bin', sourceId: 'video', kind: 'video', binItemId: 'video-item',
		})],
		sources: [{ id: 'video', kind: 'video', sampleRate: 48_000, frameCount: 1_000 }],
	});
	const revokeStarted = deferred();
	const revokeGate = deferred();
	const videoRef: { current?: ReturnType<typeof createHarness> } = {};
	const videoHarness = createHarness(base, {
		importProjectBinFile: async () => {
			videoRef.current?.replaceImportedDocument(importedVideo);
			return { clipId: 'video-bin' };
		},
		async revokeVideoVisual() {
			revokeStarted.resolve();
			await revokeGate.promise;
		},
	});
	videoRef.current = videoHarness;
	const rejected = assert.rejects(
		videoHarness.service.prepareProjectBinReplacement('bin', { name: 'video.mp4' }),
		/Replacement incompatible/,
	);
	await revokeStarted.promise;
	assert.deepEqual(videoHarness.deletedMedia, []);
	revokeGate.resolve();
	await rejected;
	assert.deepEqual(videoHarness.deletedMedia, ['video']);
});

test('replacement cancellation drains its staged chunk provider before deleting source storage', { timeout: 1_000 }, async () => {
	const target = clipFixture({ id: 'bin', sourceId: 'old', binItemId: 'item' });
	const base = projectFixture({
		projectBinClips: [target],
		sources: [{ id: 'old', kind: 'audio', sampleRate: 48_000, frameCount: 1_000, channelCount: 1 }],
	});
	const imported = projectFixture({
		id: base.id,
		projectBinClips: [clipFixture({ id: 'new-bin', sourceId: 'new', binItemId: 'new-item' })],
		sources: [{ id: 'new', kind: 'audio', sampleRate: 48_000, frameCount: 1_000, channelCount: 1 }],
	});
	const drainStarted = deferred();
	const drainGate = deferred();
	const events: string[] = [];
	const providers = Object.assign(new Map<string, unknown>([['new', {}]]), {
		async drain() {
			events.push('drain-providers:start');
			drainStarted.resolve();
			await drainGate.promise;
			events.push('drain-providers:done');
		},
	});
	const harnessRef: { current?: ReturnType<typeof createHarness> } = {};
	const harness = createHarness(base, {
		sourceChunkProviders: providers,
		retireSourceChunkProvider: async (sourceId) => {
			providers.delete(sourceId);
			events.push('publish-engine-providers');
			await providers.drain();
		},
		importProjectBinFile: async () => {
			harnessRef.current?.replaceImportedDocument(imported);
			return { clipId: 'new-bin' };
		},
	});
	harnessRef.current = harness;
	const prepared = await harness.service.prepareProjectBinReplacement('bin', { name: 'new.wav' });
	const cancellation = harness.service.cancelProjectBinReplacement(prepared?.token ?? '');

	await drainStarted.promise;
	assert.equal(providers.has('new'), false);
	assert.deepEqual(events, ['publish-engine-providers', 'drain-providers:start']);
	assert.deepEqual(harness.deletedSources, []);
	drainGate.resolve();
	assert.equal(await cancellation, true);
	assert.deepEqual(events, [
		'publish-engine-providers', 'drain-providers:start', 'drain-providers:done',
	]);
	assert.deepEqual(harness.deletedSources, ['new']);
});

test('replacement cancellation continues cleanup when runtime retirement fails', async () => {
	const target = clipFixture({
		id: 'video-bin', sourceId: 'old-video', kind: 'video', binItemId: 'video-item',
	});
	const base = projectFixture({
		projectBinClips: [target],
		sources: [{ id: 'old-video', kind: 'video', sampleRate: 48_000, frameCount: 1_000 }],
	});
	const imported = projectFixture({
		id: base.id,
		projectBinClips: [clipFixture({
			id: 'new-video-bin', sourceId: 'new-video', kind: 'video', binItemId: 'new-item',
		})],
		sources: [{ id: 'new-video', kind: 'video', sampleRate: 48_000, frameCount: 1_000 }],
	});
	const events: string[] = [];
	const harnessRef: { current?: ReturnType<typeof createHarness> } = {};
	const harness = createHarness(base, {
		importProjectBinFile: async () => {
			harnessRef.current?.replaceImportedDocument(imported);
			return { clipId: 'new-video-bin' };
		},
		revokeVideoVisual: () => {
			events.push('revoke');
			throw new Error('visual teardown failed');
		},
		retireSourceChunkProvider: () => {
			events.push('retire');
			throw new Error('provider teardown failed');
		},
	});
	harnessRef.current = harness;
	const prepared = await harness.service.prepareProjectBinReplacement(
		'video-bin', { name: 'replacement.mp4' },
	);

	assert.equal(await harness.service.cancelProjectBinReplacement(prepared?.token ?? ''), true);
	assert.deepEqual(events, ['revoke', 'retire']);
	assert.deepEqual(harness.deletedMedia, ['new-video']);
});

test('video and resumed audio previews follow explicit pause, resume, stop, and engine-state policies', async () => {
	const video = clipFixture({ id: 'video-bin', sourceId: 'video', kind: 'video', binItemId: 'video-item' });
	const videoHarness = createHarness(projectFixture({
		projectBinClips: [video],
		sources: [{ id: 'video', kind: 'video', sampleRate: 48_000, frameCount: 1_000 }],
	}), {
		playbackState: 'playing',
		visualMediaUrl: 'blob:video',
	});
	assert.deepEqual(await videoHarness.service.playPauseProjectBinClip('video-bin'), {
		clipId: 'video-bin',
		binItemId: 'video-item',
		state: 'playing',
		kind: 'video',
		mediaUrl: 'blob:video',
	});
	assert.equal(videoHarness.playbackStopCount, 1);
	assert.equal((await videoHarness.service.playPauseProjectBinClip('video-bin')).state, 'paused');
	assert.equal((await videoHarness.service.playPauseProjectBinClip('video-bin')).state, 'playing');
	assert.equal(await videoHarness.service.stopProjectBinPreview(), true);
	assert.equal(await videoHarness.service.stopProjectBinPreview(), false);

	const audioEngine = createPreviewEngine(Promise.resolve());
	const audioHarness = createHarness(projectFixture({
		projectBinClips: [clipFixture({ id: 'audio-bin', sourceId: 'audio', binItemId: 'audio-item' })],
	}), { previewEngine: audioEngine });
	await audioHarness.service.playPauseProjectBinClip('audio-bin');
	assert.equal((await audioHarness.service.playPauseProjectBinClip('audio-bin')).state, 'paused');
	assert.equal(audioEngine.pauseCalls, 1);
	assert.equal((await audioHarness.service.playPauseProjectBinClip('audio-bin')).state, 'playing');
	audioEngine.emit('paused');
	assert.equal(audioHarness.preview?.state, 'paused');
	audioEngine.emit('stopped');
	assert.equal(audioHarness.preview?.state, 'stopped');
	audioEngine.emit('playing');
	assert.equal(audioHarness.preview?.state, 'stopped');
	await audioHarness.service.dispose();
	assert.equal(audioEngine.disposeCalls, 1);

	const missing = createHarness(projectFixture({
		projectBinClips: [clipFixture({ id: 'missing-bin', sourceId: 'missing' })],
	}));
	missing.missingSourceIds.add('missing');
	await assert.rejects(missing.service.playPauseProjectBinClip('missing-bin'), /Local sources missing/);
	await assert.rejects(missing.service.playPauseProjectBinClip('unknown'), /Audio clip not found/);
});

test('preview playback rejects late completion after disposal without a late publication', async () => {
	let resolvePlay!: () => void;
	const play = new Promise<void>((resolve) => { resolvePlay = resolve; });
	const previewEngine = createPreviewEngine(play);
	const project = projectFixture({
		projectBinClips: [clipFixture({ id: 'preview', sourceId: 'source', binItemId: 'preview-item' })],
	});
	const harness = createHarness(project, { previewEngine });
	const pending = harness.service.playPauseProjectBinClip('preview');
	await Promise.resolve();
	assert.equal(harness.preview?.state, 'playing');
	const publishedBeforeDisposal = harness.publishCount;
	harness.lifetime.beginDisposal();
	resolvePlay();

	await assert.rejects(pending, { code: 'DISPOSED' });
	assert.equal(harness.publishCount, publishedBeforeDisposal);
	assert.equal(await harness.service.stopProjectBinPreview({ dispose: true }), true);
	assert.equal(harness.preview, null);
	assert.equal(previewEngine.disposeCalls, 1);
});

test('a retired preview engine cannot overwrite its replacement with a late state event', async () => {
	const firstEngine = createPreviewEngine(Promise.resolve()), secondEngine = createPreviewEngine(Promise.resolve());
	const engines = [firstEngine, secondEngine];
	const project = projectFixture({ projectBinClips: [
			clipFixture({ id: 'first-preview', sourceId: 'first-source', binItemId: 'first-item' }),
			clipFixture({ id: 'second-preview', sourceId: 'second-source', binItemId: 'second-item' }),
	] });
	const harness = createHarness(project, {
		createPreviewEngine: ({ onState }) => {
			const engine = engines.shift();
			assert.ok(engine);
			engine.setOnState(onState);
			return engine;
		},
	});
	await harness.service.playPauseProjectBinClip('first-preview');
	await harness.service.stopProjectBinPreview({ dispose: true });
	await harness.service.playPauseProjectBinClip('second-preview');
	firstEngine.emit('stopped');
	assert.equal(harness.preview?.clipId, 'second-preview');
	assert.equal(harness.preview?.state, 'playing');
	secondEngine.emit('paused');
	assert.equal(harness.preview?.state, 'paused');
});
interface HarnessOptions {
	readonly importProjectBinFile?: ProjectBinServiceDependencies['importProjectBinFile'];
	readonly revokeVideoVisual?: ProjectBinServiceDependencies['revokeVideoVisual'];
	readonly sourceChunkProviders?: ProjectBinServiceDependencies['sourceChunkProviders'];
	readonly retireSourceChunkProvider?: ProjectBinServiceDependencies['retireSourceChunkProvider'];
	readonly previewEngine?: ReturnType<typeof createPreviewEngine>;
	readonly createPreviewEngine?: ProjectBinServiceDependencies['createPreviewEngine'];
	readonly editingBlocked?: () => boolean;
	readonly getPositionFrames?: ProjectBinServiceDependencies['getPositionFrames'];
	readonly playbackState?: string;
	readonly visualMediaUrl?: string | null;
	readonly projectChanged?: ProjectBinServiceDependencies['projectChanged'];
	readonly protectedSourceIds?: Set<string>;
}

function createHarness(initialProject: ProjectBinProject, options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projects = new EditorProjectGeneration();
	projects.activate(initialProject.id);
	let project = initialProject;
	let history: unknown = { present: project };
	let selectedClipId: string | null = null;
	let selectedTrackId: string | null = null;
	let preview: ProjectBinPreview | null = null;
	let importing = false;
	let publishCount = 0;
	let restoreCount = 0;
	let playbackStopCount = 0;
	let id = 0;
	const missingSourceIds = new Set<string>();
	const deletedSources: string[] = [];
	const deletedMedia: string[] = [];
	const selectionCommands: Array<Extract<AudioEditorCommand, { type: 'selection/set' }>> = [];
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	const previewEngine = options.previewEngine ?? createPreviewEngine(Promise.resolve());
	const sourceChunkProviders = options.sourceChunkProviders
		?? Object.assign(new Map<string, unknown>(), { drain: async () => undefined });
	const dependencies: ProjectBinServiceDependencies = {
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			localSourcesMissing: 'Local sources missing.',
			track: 'Track',
			projectBinReplacementIncompatible: 'Replacement incompatible.',
		},
		trackColors: ['blue', 'green'], retireTimelinePlayback: () => { playbackStopCount += 1; },
		protectedSourceIds: options.protectedSourceIds ?? new Set<string>(),
		playbackEngine: {
			getState: () => ({ state: options.playbackState ?? 'stopped' }),
			stop: () => { playbackStopCount += 1; },
		},
		sourceBuffers: new Map<string, AudioBuffer>(),
		sourceChunkProviders,
		retireSourceChunkProvider: options.retireSourceChunkProvider ?? (async (sourceId) => {
			sourceChunkProviders.delete(sourceId);
			await sourceChunkProviders.drain();
		}),
		sourcePeaks: new Map<string, unknown>(),
		missingSourceIds,
		store: {
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
			deleteMediaAsset: async (sourceId) => { deletedMedia.push(sourceId); },
			getLinkedOriginalBinding: async () => null, getSourceMetadata: async () => null, relinkLinkedAudioOriginal: async () => { throw new Error('Unexpected linked-audio relink.'); }, releaseLinkedOriginalLocator: async () => true, getLinkedVideoOriginalBinding: async () => null, relinkLinkedVideoOriginal: async () => { throw new Error('Unexpected linked-video relink.'); }, releaseLinkedVideoOriginalLocator: async () => true,
		},
		createPreviewEngine: options.createPreviewEngine ?? (({ onState }) => {
			previewEngine.setOnState(onState);
			return previewEngine;
		}),
		createId: (prefix) => `${prefix}-${++id}`,
		captureProject: () => projects.capture(project.id),
		assertProject: (token) => projects.assertCurrent(token),
		getProject: () => project,
		getSelectedClipId: () => selectedClipId,
		getSelectedTrackId: () => selectedTrackId,
		setSelectedClipId: (value) => { selectedClipId = value; },
		setSelectedTrackId: (value) => { selectedTrackId = value; },
		getPreview: () => preview,
		setPreview: (value) => { preview = value; },
		editingBlocked: options.editingBlocked ?? (() => false),
		commit: (command, selection) => { commits.push({ command, selection }); },
		updateSelection: (command) => { selectionCommands.push(command); },
		getPositionFrames: options.getPositionFrames ?? (() => 128),
		normalizeTimelineStartFrame: (value) => Math.max(0, Math.round(Number(value))),
		getVisualData: () => options.visualMediaUrl == null ? null : { mediaUrl: options.visualMediaUrl },
		activateStoredSource: async () => null, invalidateSourceRuntime: async () => undefined, activateVideoSource: async () => null,
		digestMediaContent: async (blob) => `digest:${await (blob as Blob).text()}`,
		admitChangedContentAudioCandidate: async () => undefined,
		admitChangedContentVideoCandidate: async () => undefined,
		deleteVideoDerivative: async () => undefined,
		captureActiveDocument: () => ({ history, project }),
		restoreActiveDocument: (snapshot) => {
			history = snapshot.history;
			project = snapshot.project;
			restoreCount += 1;
		},
		setImporting: (value) => { importing = value; },
		importProjectBinFile: options.importProjectBinFile ?? (async () => null),
		projectChanged: options.projectChanged ?? (() => undefined),
		publish: () => { publishCount += 1; },
		revokeVideoVisual: options.revokeVideoVisual ?? (() => undefined),
	};
	const service = createProjectBinService(dependencies);
	return {
		service,
		lifetime,
		commits,
		selectionCommands,
		missingSourceIds,
		deletedSources,
		deletedMedia,
		get project() { return project; },
		get preview() { return preview; },
		get selectedClipId() { return selectedClipId; },
		get selectedTrackId() { return selectedTrackId; },
		get importing() { return importing; },
		get publishCount() { return publishCount; },
		get restoreCount() { return restoreCount; },
		get playbackStopCount() { return playbackStopCount; },
		replaceImportedDocument(value: ProjectBinProject) {
			project = value;
			history = { present: value };
		},
		switchProject(value: ProjectBinProject) {
			project = value;
			history = { present: value };
			projects.activate(value.id);
		},
	};
}

function projectFixture(options: Readonly<{
	id?: string;
	clips?: readonly ProjectBinClip[];
	projectBinClips?: readonly ProjectBinClip[];
	selectionClipIds?: readonly string[];
	sources?: ProjectBinProject['sources'];
}> = {}): ProjectBinProject {
	const clips = options.clips ?? [];
	const sourceIds = new Set([
		...clips.map((clip) => clip.sourceId),
		...(options.projectBinClips ?? []).map((clip) => clip.sourceId),
	]);
	return {
		schemaVersion: 17, revision: 0,
		id: options.id ?? 'project',
		sampleRate: 48_000,
		sources: options.sources ?? [...sourceIds].map((sourceId) => ({
			id: sourceId, kind: 'audio', sampleRate: 48_000, frameCount: 8_000, channelCount: 1,
		})),
		clips,
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: clips.map((clip) => clip.id) }],
		projectBin: { clips: options.projectBinClips ?? [] },
		selection: { clipIds: options.selectionClipIds ?? [] },
	};
}

function clipFixture(overrides: Partial<ProjectBinClip> = {}): ProjectBinClip {
	return {
		id: 'clip',
		sourceId: 'source',
		title: 'Clip',
		kind: 'audio',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1_000,
		durationFrames: 1_000,
		...overrides,
	};
}

function createPreviewEngine(play: Promise<void>) {
	let disposeCalls = 0;
	let pauseCalls = 0;
	let onState: (state: string) => void = () => undefined;
	const engine: ProjectBinPreviewEngine & {
		readonly disposeCalls: number;
		readonly pauseCalls: number;
		setOnState(listener: (state: string) => void): void;
		emit(state: string): void;
	} = {
		loadProject: () => undefined,
		setSourceResolver: () => undefined,
		play: async () => play,
		pause: () => { pauseCalls += 1; },
		stop: () => undefined,
		dispose: async () => { disposeCalls += 1; },
		get disposeCalls() { return disposeCalls; },
		get pauseCalls() { return pauseCalls; },
		setOnState: (listener) => { onState = listener; },
		emit: (state) => { onState(state); },
	};
	return engine;
}
