/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createAudioWarpControllerComposition,
} from '../src/common/editor/controller/audio-warp-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import { detectPcmTransients } from '../src/common/editor/transient-analysis.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';

const NOW = '2026-08-12T18:00:00.000Z';
const SOURCE_SHA256 = 'ab'.repeat(32);
const TEMPO_MAP = {
	mode: 'musical' as const,
	events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('selected digestless audio analyzes through the composed PCM and worker seams', async () => {
	const fixture = compositionFixture();

	const outcome = await fixture.service.analyzeSelected();

	assert.equal(outcome.clipId, 'clip');
	assert.equal(outcome.cacheStatus, 'computed');
	assert.deepEqual(outcome.analysis.transients.map(({ sourceFrame }) => sourceFrame), [150]);
	assert.deepEqual(fixture.pcmEvents, ['digest:warp-project:source', 'range:100-300']);
	assert.deepEqual(fixture.processing, [true, false]);
	assert.equal(fixture.service.view().renderStatus.path, 'exact-offline');
	assert.equal(fixture.service.view().hasWarpMap, false);
});

test('creating a map without prior warp state persists exact identity endpoints', () => {
	const fixture = compositionFixture();

	fixture.service.createIdentityMapSelected();

	assert.equal(fixture.commands[0]?.type, 'audio-warp/set');
	assert.deepEqual(clipOf(fixture.present()).warpMap, {
		feature: 'audio-warp',
		points: [
			{ outer: { num: 0, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward' },
			{ outer: { num: 100, den: 1 }, source: { num: 300, den: 1 }, mode: 'forward' },
		],
	});
	assert.equal(fixture.service.view().hasWarpMap, true);
});

test('selected-clip marker add, move, and delete persist through the existing exact set command', () => {
	const fixture = compositionFixture();
	assert.throws(() => fixture.service.addMarkerSelected({ outer: 50, source: 200 }), /identity warp map/iu);
	fixture.service.createIdentityMapSelected();
	fixture.service.addMarkerSelected({ outer: 50, source: 200 });
	assert.deepEqual(warpPointsOf(fixture.present())[1], {
		outer: { num: 50, den: 1 }, source: { num: 200, den: 1 }, mode: 'forward',
	});
	fixture.service.moveMarkerSelected(1, { outer: { num: 121, den: 2 }, source: 220 });
	assert.deepEqual(warpPointsOf(fixture.present())[1], {
		outer: { num: 121, den: 2 }, source: { num: 220, den: 1 }, mode: 'forward',
	});
	fixture.service.deleteMarkerSelected(1);
	assert.equal(warpPointsOf(fixture.present()).length, 2);
	assert.deepEqual(fixture.commands.map(({ type }) => type), [
		'audio-warp/set', 'audio-warp/set', 'audio-warp/set', 'audio-warp/set',
	]);
});

test('quantize routes exact zero, one, and intermediate strengths after ensuring identity', async () => {
	for (const strength of [0, { num: 1, den: 2 }, 1] as const) {
		const fixture = compositionFixture();
		await fixture.service.quantizeSelected({
			grid: { origin: 0, interval: 25 },
			strength,
		});
		assert.deepEqual(fixture.commands.map(({ type }) => type), ['audio-warp/set', 'audio-warp/quantize']);
		const quantize = fixture.commands[1];
		assert.equal(quantize?.type, 'audio-warp/quantize');
		if (quantize?.type === 'audio-warp/quantize') {
			assert.deepEqual(quantize.options.strength, typeof strength === 'number'
				? { num: strength, den: 1 }
				: strength);
			assert.deepEqual(quantize.transientSources, [{ num: 150, den: 1 }]);
		}
	}
});

test('bounded groove application and clear are concretely reachable on the selected clip', async () => {
	const fixture = compositionFixture();
	await fixture.service.applyGrooveSelected({
		grid: { origin: 0, interval: 25 },
		strength: 1,
		template: { offsets: [0, { num: 1, den: 3 }] },
		grooveStrength: { num: 1, den: 2 },
	});
	const groove = fixture.commands[1];
	assert.equal(groove?.type, 'audio-warp/quantize');
	if (groove?.type === 'audio-warp/quantize') {
		assert.deepEqual(groove.options.groove, {
			offsets: [{ num: 0, den: 1 }, { num: 1, den: 3 }],
		});
		assert.deepEqual(groove.options.grooveStrength, { num: 1, den: 2 });
	}

	fixture.service.clearSelected();
	assert.equal(fixture.commands.at(-1)?.type, 'audio-warp/clear');
	assert.equal(clipOf(fixture.present()).warpMap, null);
});

test('late analysis cannot author a clip after selection authority changes', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const fixture = compositionFixture({
		analyze: async (channels, options) => {
			await gate;
			return detectPcmTransients(channels, options);
		},
	});
	const pending = fixture.service.quantizeSelected({
		grid: { origin: 0, interval: 25 }, strength: 1,
	});
	await fixture.rangeStarted;
	fixture.select(null);
	release();

	await assert.rejects(pending, /selected audio clip changed/iu);
	assert.deepEqual(fixture.commands, []);
});

test('replacement-project analysis owns processing when clip ids collide', async () => {
	const firstStarted = deferred();
	const secondStarted = deferred();
	const firstGate = deferred();
	const secondGate = deferred();
	let analysisCalls = 0;
	const fixture = compositionFixture({
		analyze: async (channels, options) => {
			analysisCalls += 1;
			if (analysisCalls === 1) {
				firstStarted.resolve();
				await firstGate.promise;
			} else {
				secondStarted.resolve();
				await secondGate.promise;
			}
			return detectPcmTransients(channels, options);
		},
	});
	const origin = fixture.service.quantizeSelected({
		grid: { origin: 0, interval: 25 }, strength: 1,
	});
	await firstStarted.promise;
	assert.equal(fixture.processingState(), true);
	fixture.switchProject('replacement-project');
	assert.equal(fixture.processingState(), false);
	const replacement = fixture.service.applyGrooveSelected({
		grid: { origin: 0, interval: 25 },
		strength: 1,
		template: { offsets: [0] },
	});
	await secondStarted.promise;
	try {
		assert.equal(fixture.processingState(), true);
		secondGate.resolve();
		await replacement;
		assert.equal(fixture.processingState(), false);
		assert.deepEqual(fixture.processing, [true, true, false]);
		const settledProcessing = [...fixture.processing];

		firstGate.resolve();
		await assert.rejects(origin, /superseded|changed/iu);
		assert.deepEqual(fixture.processing, settledProcessing);
		assert.deepEqual(fixture.commands.map(({ type }) => type), [
			'audio-warp/set', 'audio-warp/quantize',
		]);
	} finally {
		firstGate.resolve();
		secondGate.resolve();
		await Promise.allSettled([origin, replacement]);
	}
});

test('newest overlapping warp request retires processing without waiting for its cancelled predecessor', async () => {
	const firstStarted = deferred();
	const secondStarted = deferred();
	const firstGate = deferred();
	const secondGate = deferred();
	let analysisCalls = 0;
	const fixture = compositionFixture({
		analyze: async (channels, options) => {
			analysisCalls += 1;
			if (analysisCalls === 1) {
				firstStarted.resolve();
				await firstGate.promise;
			} else {
				secondStarted.resolve();
				await secondGate.promise;
			}
			return detectPcmTransients(channels, options);
		},
	});
	const predecessor = fixture.service.analyzeSelected();
	await firstStarted.promise;
	const newest = fixture.service.quantizeSelected({
		grid: { origin: 0, interval: 25 }, strength: 1,
	});
	await secondStarted.promise;
	try {
		secondGate.resolve();
		await newest;
		assert.equal(fixture.processingState(), false);
		assert.deepEqual(fixture.processing, [true, false]);
		const settledProcessing = [...fixture.processing];

		firstGate.resolve();
		await assert.rejects(predecessor, /superseded/iu);
		assert.deepEqual(fixture.processing, settledProcessing);
	} finally {
		firstGate.resolve();
		secondGate.resolve();
		await Promise.allSettled([predecessor, newest]);
	}
});

test('dispose retires pending warp authoring without a late processing publication', async () => {
	const analysisStarted = deferred();
	const analysisGate = deferred();
	const fixture = compositionFixture({
		analyze: async (channels, options) => {
			analysisStarted.resolve();
			await analysisGate.promise;
			return detectPcmTransients(channels, options);
		},
	});
	const pending = fixture.service.quantizeSelected({
		grid: { origin: 0, interval: 25 }, strength: 1,
	});
	await analysisStarted.promise;
	assert.deepEqual(fixture.processing, [true]);
	fixture.service.dispose();
	fixture.service.dispose();
	assert.throws(() => fixture.service.view(), /disposed/iu);

	analysisGate.resolve();
	await assert.rejects(pending, /disposed/iu);
	assert.deepEqual(fixture.commands, []);
	assert.deepEqual(fixture.processing, [true]);
});

test('controller admission blocks no-selection, read-only/busy, video, and locked-track edits', async () => {
	const noSelection = compositionFixture();
	noSelection.select(null);
	assert.equal(noSelection.service.view().blockReason, 'no-audio-clip');
	await assert.rejects(noSelection.service.analyzeSelected(), /Select one audio clip/iu);

	const blocked = compositionFixture();
	blocked.setBlocked(true);
	assert.equal(blocked.service.view().blockReason, 'busy-or-read-only');
	assert.throws(() => blocked.service.createIdentityMapSelected(), /Editing is blocked/u);
	await assert.rejects(blocked.service.analyzeSelected(), /Editing is blocked/u);

	const locked = compositionFixture({ locked: true });
	assert.equal(locked.service.view().blockReason, 'locked');
	assert.throws(() => locked.service.createIdentityMapSelected(), /locked/u);
	await assert.rejects(locked.service.analyzeSelected(), /locked/u);

	const video = compositionFixture({ selectedClipKind: 'video' });
	assert.equal(video.service.view().blockReason, 'no-audio-clip');
	await assert.rejects(video.service.analyzeSelected(), /Select one audio clip/iu);
});

test('PCM storage capability is admitted only when transient analysis is requested', async () => {
	const fixture = compositionFixture({ lazyPcmAccess: true });

	assert.equal(fixture.service.view().selectedClipId, 'clip');
	fixture.service.createIdentityMapSelected();
	await assert.rejects(
		fixture.service.analyzeSelected(),
		/Transient analysis requires canonical PCM storage access/u,
	);
});

type Analyze = NonNullable<Parameters<typeof createAudioWarpControllerComposition>[0]['analyzeChannels']>;

function compositionFixture(options: Readonly<{
	locked?: boolean;
	selectedClipKind?: 'audio' | 'video';
	analyze?: Analyze;
	lazyPcmAccess?: boolean;
}> = {}) {
	let present = project(Boolean(options.locked), options.selectedClipKind);
	let selectedClipId: string | null = 'clip';
	let blocked = false;
	const lifetime = new EditorControllerLifetime();
	const generation = new EditorProjectGeneration();
	generation.activate(present.id);
	const commands: AudioEditorCommand[] = [];
	const cache = new Map<string, unknown>();
	const pcmEvents: string[] = [];
	const processing: boolean[] = [];
	let analysisProcessing = false;
	let resolveRangeStarted!: () => void;
	const rangeStarted = new Promise<void>((resolve) => { resolveRangeStarted = resolve; });
	const analysisStore = {
		loadAnalysis: async (key: string) => cache.get(key) ?? null,
		saveAnalysis: async (key: string, value: unknown) => { cache.set(key, value); },
		deleteAnalysis: async (key: string) => { cache.delete(key); },
	};
	const service = createAudioWarpControllerComposition({
		lifetime,
		getProject: () => present,
		getSelectedClipId: () => selectedClipId,
		editingBlocked: () => blocked,
		commit(command) {
			commands.push(command);
			present = applyEditorCommand(present, command, { now: NOW });
			return present;
		},
		captureProject: () => generation.capture(present.id),
		assertProject: (token) => generation.assertCurrent(token),
		store: (options.lazyPcmAccess ? analysisStore : {
			...analysisStore,
			getSourceMetadata: async () => null,
			async *readSourceChunks() { /* The injected access owns fixture PCM. */ },
			openSourceReadSession: async () => null,
		}) as Parameters<typeof createAudioWarpControllerComposition>[0]['store'],
		...(options.lazyPcmAccess ? {} : { pcmAccess: {
			async resolveSourceSha256(projectId, source) {
				pcmEvents.push(`digest:${projectId}:${source.id}`);
				return SOURCE_SHA256;
			},
			async readSourceRange(_source, range) {
				pcmEvents.push(`range:${String(range.startFrame)}-${String(range.endFrame)}`);
				resolveRangeStarted();
				const pcm = new Float32Array(range.endFrame - range.startFrame);
				pcm[50] = 1;
				return [pcm];
			},
			dispose: () => undefined,
		} }),
		analyzeChannels: options.analyze ?? ((channels, detectorOptions) => (
			detectPcmTransients(channels, detectorOptions)
		)),
		getRenderStatus: () => ({
			path: 'exact-offline', realtimeAcceleration: false,
			exactOfflineAvailable: true, fallback: true,
		}),
		setAnalysisProcessing(value) {
			analysisProcessing = value;
			processing.push(value);
		},
		publish: () => undefined,
	});
	lifetime.markReady();
	return {
		service, commands, pcmEvents, processing, rangeStarted,
		present: () => present,
		processingState: () => analysisProcessing,
		select: (clipId: string | null) => { selectedClipId = clipId; },
		setBlocked: (value: boolean) => { blocked = value; },
		switchProject(projectId: string) {
			generation.invalidate();
			present = project(Boolean(options.locked), options.selectedClipKind, projectId);
			generation.activate(present.id);
			analysisProcessing = false;
		},
	};
}

function project(
	locked: boolean,
	selectedClipKind: 'audio' | 'video' = 'audio',
	projectId = 'warp-project',
): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, title: 'Clip', anchor: 'sample',
		timelineStartFrame: 1_000, durationFrames: 100,
		sourceStartFrame: 100, sourceDurationFrames: 200,
		warpMap: null,
	});
	const result = createCurrentAudioEditorProject({
		id: projectId, now: NOW, tempoMap: TEMPO_MAP,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', locked, clipIds: ['clip'] })],
	});
	if (selectedClipKind === 'video') (result.clips[0] as Record<string, unknown>).kind = 'video';
	return result;
}

function clipOf(projectValue: AudioEditorProjectCurrent): Readonly<Record<string, unknown>> {
	const clip = projectValue.clips.find(({ id }) => id === 'clip');
	if (!clip) throw new Error('Missing fixture clip.');
	return clip;
}

function warpPointsOf(projectValue: AudioEditorProjectCurrent): readonly unknown[] {
	const warpMap = clipOf(projectValue).warpMap;
	if (!warpMap || typeof warpMap !== 'object' || !Array.isArray((warpMap as { points?: unknown }).points)) {
		throw new Error('Missing fixture warp map.');
	}
	return (warpMap as { points: readonly unknown[] }).points;
}
