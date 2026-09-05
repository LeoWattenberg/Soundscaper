import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipPropertyService,
	type ClipPropertyService,
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

// A 1 s 44.1 kHz source in a 48 kHz project: 44_100 source frames occupy 48_000
// timeline frames, so an unstretched clip's speed ratio is 1, not 44_100/48_000.
test('stretching a clip whose source rate differs from the project rate keeps the speed ratio rate-compensated', () => {
	const harness = createHarness(mixedRateProject());

	harness.service.stretchClip('active', { durationFrames: 96_000 });

	assert.deepEqual(soleTransform(harness.commits[0]), {
		clipId: 'active', durationFrames: 96_000, speedRatio: 0.5,
	});
});

test('setting a speed ratio on a mixed-rate clip resolves the timeline duration through the project rate', () => {
	const harness = createHarness(mixedRateProject());

	harness.service.setClipTimePitch('active', { speedRatio: 2 });
	assert.deepEqual(soleTransform(harness.commits[0]), {
		clipId: 'active', durationFrames: 24_000, speedRatio: 2,
	});

	harness.service.setClipTimePitch('active', { speedRatio: 0.5 });
	assert.deepEqual(soleTransform(harness.commits[1]), {
		clipId: 'active', durationFrames: 96_000, speedRatio: 0.5,
	});
});

test('resetting pitch and speed restores a mixed-rate clip to its full timeline duration', () => {
	const harness = createHarness(mixedRateProject({
		clips: [clipFixture({ pitchCents: 400 })],
	}));

	harness.service.resetClipPitchSpeed('active');

	assert.deepEqual(soleTransform(harness.commits[0]), {
		clipId: 'active', durationFrames: 48_000, speedRatio: 1,
	});
});

test('grouped stretching rate-compensates every companion clip', () => {
	const harness = createHarness(mixedRateProject({
		tracks: [
			{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] },
			{ id: 'track-b', name: 'B', type: 'audio', clipIds: ['companion'] },
		],
		clips: [clipFixture({ groupId: 'group' }), clipFixture({
			id: 'companion', groupId: 'group', timelineStartFrame: 200_000,
		})],
	}));

	harness.service.stretchClip('active', { durationFrames: 96_000 });

	const command = harness.commits[0];
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a grouped stretch.');
	assert.deepEqual(command.transforms.map(({ clipId, changes }) => ({
		clipId, durationFrames: changes.durationFrames, speedRatio: changes.speedRatio,
	})), [
		{ clipId: 'active', durationFrames: 96_000, speedRatio: 0.5 },
		{ clipId: 'companion', durationFrames: 96_000, speedRatio: 0.5 },
	]);
});

test('a source recorded at the project rate keeps the uncompensated arithmetic', () => {
	const harness = createHarness(mixedRateProject({
		sources: [sourceFixture({ sampleRate: 48_000, originalSampleRate: 48_000, frameCount: 48_000 })],
		clips: [clipFixture({ sourceDurationFrames: 48_000 })],
	}));

	harness.service.stretchClip('active', { durationFrames: 96_000 });
	assert.deepEqual(soleTransform(harness.commits[0]), {
		clipId: 'active', durationFrames: 96_000, speedRatio: 0.5,
	});

	harness.service.setClipTimePitch('active', { speedRatio: 2 });
	assert.deepEqual(soleTransform(harness.commits[1]), {
		clipId: 'active', durationFrames: 24_000, speedRatio: 2,
	});
});

function soleTransform(command: AudioEditorCommand | undefined) {
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected a clip transform command.');
	assert.equal(command.transforms.length, 1);
	const transform = command.transforms[0];
	return {
		clipId: transform?.clipId,
		durationFrames: transform?.changes.durationFrames,
		speedRatio: transform?.changes.speedRatio,
	};
}

function createHarness(project: ClipTransformProject): {
	readonly commits: readonly AudioEditorCommand[];
	readonly service: ClipPropertyService;
} {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const commits: AudioEditorCommand[] = [];
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
		editingBlocked: () => false,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		analyzeChannels: async () => ({ peakAmplitude: 1, integratedLufs: -14 }),
		sourceBuffers: new Map(),
		createId: (prefix) => `${prefix}-id`,
		commit: (command) => {
			commits.push(command);
			return project;
		},
	});
	return { commits, service };
}

function mixedRateProject(overrides: Partial<ClipTransformProject> = {}): ClipTransformProject {
	return brandRuntimeProjectProjection({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project', title: 'Project', sampleRate: 48_000,
		projectBin: { clips: [] }, timelineAnnotations: [],
		sequences: [{ id: 'main-sequence' }], primarySequenceId: 'main-sequence',
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }],
		clips: [clipFixture()],
		sources: [sourceFixture()],
		selection: null,
		...overrides,
		runtimeProjectionVersion: RUNTIME_CLIP_PROJECTION_VERSION,
	}) as unknown as ClipTransformProject;
}

function sourceFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
		frameCount: 44_100, channelCount: 1, sampleRate: 44_100, originalSampleRate: 44_100,
		...overrides,
	};
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	const clip = {
		id: 'active', sourceId: 'source', title: 'Clip', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 44_100,
		durationFrames: 48_000, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, inverted: false,
		envelope: [], groupId: null, avLinkId: null,
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
