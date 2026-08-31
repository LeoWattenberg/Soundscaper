import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipPropertyService,
	type ClipAnalysisResult,
} from '../src/common/editor/controller/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-domain-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import {
	brandRuntimeProjectProjection,
	RUNTIME_CLIP_PROJECTION_VERSION,
} from '../src/common/editor/runtime-clip-projection.ts';

test('time/pitch edits and grouped stretching preserve render revisions and envelopes', () => {
	const project = projectFixture();
	const harness = createHarness(project);

	harness.service.setClipTimePitch('active', {
		pitchCents: 300,
		speedRatio: 2,
		preserveFormants: true,
	});
	let command = harness.commits[0]?.command;
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a time/pitch transform.');
	assert.deepEqual(command.transforms[0], {
		clipId: 'active',
		trackId: 'track-a',
		changes: {
			pitchCents: 300,
			speedRatio: 2,
			preserveFormants: true,
			durationFrames: 500,
			fadeInFrames: 25,
			fadeOutFrames: 25,
			envelope: [{ frame: 250, value: 0.5 }],
			renderCacheRevision: 3,
		},
	});

	harness.service.stretchClip('active', { durationFrames: 2_000 });
	command = harness.commits[1]?.command;
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a grouped stretch transform.');
	assert.deepEqual(command.transforms.map(({ clipId, changes }) => ({
		clipId,
		durationFrames: changes.durationFrames,
		speedRatio: changes.speedRatio,
		renderCacheRevision: changes.renderCacheRevision,
	})), [{
		clipId: 'active', durationFrames: 2_000, speedRatio: 0.5, renderCacheRevision: 3,
	}, {
		clipId: 'companion', durationFrames: 1_000, speedRatio: 0.5, renderCacheRevision: 5,
	}]);

	harness.service.toggleStretchToTempo('active');
	assert.deepEqual(harness.commits[2]?.command, {
		type: 'clip/update', clipId: 'active',
		changes: { stretchToTempo: true, renderCacheRevision: 3 },
	});
});

test('reverse commits synchronously while normalization is owned by its clip task', async () => {
	const project = projectFixture();
	const gate = deferred<ClipAnalysisResult>();
	const harness = createHarness(project, { analyze: () => gate.promise });

	await harness.service.handleClipAction('reverse', 'active');
	assert.deepEqual(harness.commits[0]?.command, {
		type: 'clip/update', clipId: 'active', changes: { reversed: true },
	});

	const pending = harness.service.handleClipAction('normalize-peak', 'active');
	await Promise.resolve();
	assert.equal(harness.analysisSignals.length, 1);
	harness.replaceWithinProject(projectFixture({
		clips: project.clips.map((clip) => clip.id === 'active'
			? { ...clip, renderCacheRevision: Number(clip.renderCacheRevision) + 1 }
			: clip),
	}));
	gate.resolve({ peakAmplitude: 0.5, integratedLufs: -20 });

	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(harness.commits.length, 1, 'a stale analysis must not publish gain');
});

test('normalization analyzes the selected source extent rather than its stretched timeline extent', async () => {
	let analyzed: readonly Float32Array[] = [];
	const project = projectFixture({
		clips: [clipFixture({
			sourceStartFrame: 100,
			sourceDurationFrames: 1_000,
			durationFrames: 500,
			speedRatio: 2,
		}), clipFixture({
			id: 'companion', timelineStartFrame: 1_500, sourceStartFrame: 1_000,
			sourceDurationFrames: 500, durationFrames: 500, renderCacheRevision: 4,
		})],
	});
	const harness = createHarness(project, {
		analyze: async (channels) => {
			analyzed = channels;
			return { peakAmplitude: 1, integratedLufs: -14 };
		},
	});

	await harness.service.handleClipAction('normalize-peak', 'active');

	assert.equal(analyzed[0]?.length, 1_000);
	assert.equal(analyzed[0]?.[0], Math.fround(100 / 4_000));
	assert.equal(analyzed[0]?.at(-1), Math.fround(1_099 / 4_000));
});

test('new normalization replaces the previous task and project switches suppress late gain commits', async () => {
	const project = projectFixture();
	const first = deferred<ClipAnalysisResult>();
	const second = deferred<ClipAnalysisResult>();
	const results = [first.promise, second.promise];
	const harness = createHarness(project, { analyze: () => results.shift()! });

	const superseded = harness.service.handleClipAction('normalize-lufs', 'active');
	await Promise.resolve();
	const replacement = harness.service.handleClipAction('normalize-lufs', 'active');
	await Promise.resolve();
	assert.equal(harness.analysisSignals[0]?.aborted, true);
	first.resolve({ peakAmplitude: 1, integratedLufs: -20 });
	await assert.rejects(superseded, { name: 'AbortError' });
	second.resolve({ peakAmplitude: 1, integratedLufs: -20 });
	await replacement;
	assert.equal(harness.commits.length, 1);
	const gain = 10 ** ((-14 - -20) / 20);
	assert.deepEqual(harness.commits[0]?.command, {
		type: 'clip/update', clipId: 'active', changes: { gain },
	});

	const switchedGate = deferred<ClipAnalysisResult>();
	harness.setAnalyze(() => switchedGate.promise);
	const switched = harness.service.handleClipAction('normalize-peak', 'active');
	await Promise.resolve();
	harness.switchProject(projectFixture({ id: 'other-project' }));
	switchedGate.resolve({ peakAmplitude: 0.25, integratedLufs: -14 });
	await assert.rejects(switched, { name: 'AbortError', code: 'PROJECT_CHANGED' });
	assert.equal(harness.commits.length, 1);
});

test('clip property validation, blocking, defaults, and single-clip paths are explicit', async () => {
	const single = projectFixture({
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }],
		clips: [clipFixture({ groupId: null, envelope: undefined })],
		selection: null,
	});
	const harness = createHarness(single, {
		analyze: async () => ({ peakAmplitude: 0, integratedLufs: Number.NaN }),
	});

	assert.throws(() => harness.service.setClipTimePitch('active', { pitchCents: Number.NaN }), /Pitch/);
	assert.throws(() => harness.service.setClipTimePitch('active', { pitchCents: -1_201 }), /Pitch/);
	assert.throws(() => harness.service.setClipTimePitch('active', { pitchCents: 1_201 }), /Pitch/);
	assert.throws(() => harness.service.setClipTimePitch('active', { speedRatio: Number.NaN }), /Speed/);
	assert.throws(() => harness.service.setClipTimePitch('active', { speedRatio: 0 }), /Speed/);
	harness.service.setClipTimePitch('active');
	harness.service.resetClipPitchSpeed('active');
	harness.service.stretchClip('active');
	harness.service.stretchClip('active', { timelineStartFrame: 20, durationFrames: 250 });
	assert.throws(
		() => harness.service.stretchClip('active', { timelineStartFrame: Number.POSITIVE_INFINITY }),
		/Timeline/,
	);
	await harness.service.handleClipAction('normalize-peak', 'active');
	await harness.service.handleClipAction('unknown', 'active');
	assert.equal(harness.commits.length, 6);

	harness.sourceBuffers.delete('source');
	assert.equal(await harness.service.handleClipAction('normalize-peak', 'active'), undefined);
	assert.equal(await harness.service.handleClipAction('reverse', 'missing'), undefined);
	assert.throws(() => harness.service.setClipTimePitch('missing'), /Audio clip/);
	assert.throws(() => harness.service.stretchClip('missing'), /Audio clip/);
	assert.throws(() => harness.service.toggleStretchToTempo('missing'), /Audio clip/);

	harness.setBlocked(true);
	assert.equal(await harness.service.handleClipAction('reverse', 'active'), undefined);
	assert.equal(harness.service.setClipTimePitch('active'), null);
	assert.equal(harness.service.stretchClip('active'), null);
	assert.equal(harness.service.toggleStretchToTempo('active'), null);
});

test('left-edge grouped stretching clamps companions at the timeline origin', () => {
	const project = projectFixture();
	const harness = createHarness(project);

	harness.service.stretchClip('active', { timelineStartFrame: 500, durationFrames: 2_000 });

	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a grouped stretch.');
	assert.deepEqual(command.transforms.map(({ clipId, changes }) => ({
		clipId,
		timelineStartFrame: changes.timelineStartFrame,
		durationFrames: changes.durationFrames,
	})), [{
		clipId: 'active', timelineStartFrame: 0, durationFrames: 1_000,
	}, {
		clipId: 'companion', timelineStartFrame: 1_500, durationFrames: 500,
	}]);
});

function createHarness(
	initialProject: ClipTransformProject,
	options: Readonly<{
		analyze?: (channels: readonly Float32Array[]) => Promise<ClipAnalysisResult>;
	}> = {},
) {
	let project = initialProject;
	let analyze = options.analyze ?? (async () => ({ peakAmplitude: 1, integratedLufs: -14 }));
	let blocked = false;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const commits: Array<{ command: AudioEditorCommand }> = [];
	const analysisSignals: AbortSignal[] = [];
	const sourceBuffers = new Map([['source', audioBufferFixture()]]);
	const service = createClipPropertyService({
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.',
			clipPitchRange: 'Pitch out of range.',
			clipSpeedPositive: 'Speed must be positive.',
			timelineFramesFinite: 'Timeline frames must be finite.',
		},
		getProject: () => project,
		getSelectedClipId: () => 'active',
		editingBlocked: () => blocked,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		analyzeChannels: async (channels, _sampleRate, signal) => {
			analysisSignals.push(signal);
			return analyze(channels);
		},
		sourceBuffers,
		createId: (prefix) => `${prefix}-id`,
		commit: (command) => {
			commits.push({ command });
			return project;
		},
	});
	return {
		analysisSignals,
		commits,
		service,
		sourceBuffers,
		setBlocked(value: boolean) { blocked = value; },
		setAnalyze(next: () => Promise<ClipAnalysisResult>) { analyze = next; },
		replaceWithinProject(next: ClipTransformProject) { project = next; },
		switchProject(next: ClipTransformProject) {
			project = next;
			generation.activate(next.id);
		},
	};
}

function projectFixture(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return brandRuntimeProjectProjection({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project', title: 'Project', sampleRate: 48_000,
		projectBin: { clips: [] }, timelineAnnotations: [],
		sequences: [{ id: 'main-sequence' }], primarySequenceId: 'main-sequence',
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }, {
			id: 'track-b', name: 'B', type: 'audio', clipIds: ['companion'],
		}],
		clips: [clipFixture(), clipFixture({
			id: 'companion', timelineStartFrame: 1_500, sourceStartFrame: 1_000,
			sourceDurationFrames: 500, durationFrames: 500, renderCacheRevision: 4,
		})],
		sources: [{
			id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
			frameCount: 4_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: {
			startFrame: 0, endFrame: 0, trackIds: ['track-a', 'track-b'],
			clipIds: ['active', 'companion'], frequencyRange: null,
		},
		...overrides,
		runtimeProjectionVersion: RUNTIME_CLIP_PROJECTION_VERSION,
	}) as unknown as ClipTransformProject;
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	const clip = {
		id: 'active', sourceId: 'source', title: 'Clip', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		durationFrames: 1_000, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 25, fadeOutFrames: 25, reversed: false,
		envelope: [{ frame: 500, value: 0.5 }], groupId: 'group', avLinkId: null,
		pitchCents: 0, speedRatio: 1, preserveFormants: false,
		stretchToTempo: false, renderCacheRevision: 2, opaqueExtensions: {},
		...overrides,
	};
	return {
		...clip,
		timelineEndFrame: Number(clip.timelineStartFrame) + Number(clip.durationFrames),
		sourceEndFrame: Number(clip.sourceStartFrame) + Number(clip.sourceDurationFrames),
		sequenceStartFrame: null,
		sequenceEndFrame: null,
		coordinateDomain: 'resolved-samples' as const,
	};
}

function audioBufferFixture(): AudioBuffer {
	const channel = Float32Array.from({ length: 4_000 }, (_, index) => index / 4_000);
	return {
		length: channel.length,
		numberOfChannels: 1,
		sampleRate: 48_000,
		getChannelData: () => channel,
	} as unknown as AudioBuffer;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
