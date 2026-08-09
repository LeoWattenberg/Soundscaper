/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	projectForCommandConsumers,
	projectForRuntimeConsumers,
} from '../src/common/editor/project-current-runtime.ts';
import {
	createAudioEditorProjectV10,
	createLabelTrackV10,
	createLabelV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
	loadAudioEditorProjectV10,
	validateAudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
	resolveRuntimeClipProjection,
} from '../src/common/editor/runtime-clip-projection.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	resolveActiveVideoLayers,
	validateVideoTrackComposition,
	videoTimelineDurationFrames,
} from '../src/common/editor/video-timeline.js';

const NOW = '2026-08-09T12:00:00.000Z';

test('the current-project facade projects command consumers without rewriting legacy generations', () => {
	const project = videoProject();
	const commandProject = projectForCommandConsumers(project);

	assert.notStrictEqual(commandProject, project);
	assert.equal(isRuntimeProjectProjection(commandProject), true);
	assert.equal(commandProject.clips[0]?.timelineStartFrame, 3_675);
	assert.equal(commandProject.sources[0]?.frameCount, project.sources[0]?.sampleFrameCount);
	const legacy = { schemaVersion: 9 };
	assert.strictEqual(projectForCommandConsumers(legacy), legacy);
});

test('persisted runtime markers cannot bypass any runtime projection boundary', () => {
	const project = videoProject();
	const poisoned = { ...project, runtimeProjectionVersion: 1 };

	assert.throws(() => validateAudioEditorProjectV10(poisoned), /runtime projection/iu);
	const runtime = projectForRuntimeConsumers(poisoned);
	assert.notStrictEqual(runtime, poisoned);
	assert.equal(isRuntimeProjectProjection(runtime), true);
	assert.equal(videoTimelineDurationFrames(poisoned), 11_025);
	assert.equal(createVideoExportPlan(poisoned, {
		format: 'mp4',
		includeAudio: false,
	}).range.endFrame, 11_025);

	const derived = { ...runtime };
	assert.equal(isRuntimeProjectProjection(derived), false, 'object shape alone cannot forge the runtime brand');
	assert.strictEqual(brandRuntimeProjectProjection(derived), derived);
	assert.equal(isRuntimeProjectProjection(derived), true);
	assert.throws(() => brandRuntimeProjectProjection({
		...poisoned,
		clips: [{ ...poisoned.clips[0], coordinateDomain: 'persisted' }],
	}), /resolved runtime projection/iu);
});

test('a reconciled command result immediately loses its transient runtime trust', () => {
	const project = videoProject();
	const updated = applyEditorCommand(project, {
		type: 'clip/update',
		clipId: 'video-clip',
		changes: { title: 'Updated video' },
	}, { now: NOW });

	assert.equal(isRuntimeProjectProjection(updated), false);
	assert.equal(Object.hasOwn(updated.clips[0], 'timelineStartFrame'), false);
	const runtime = projectForRuntimeConsumers(updated);
	assert.equal(isRuntimeProjectProjection(runtime), true);
	assert.ok(Array.isArray(runtime.tracks));
	assert.ok(Array.isArray(runtime.clips));
	assert.equal(validateVideoTrackComposition(runtime.tracks[0], runtime.clips), true);
	const layers = resolveActiveVideoLayers(updated, 3_675);
	assert.equal(layers.length, 1);
	assert.equal(layers[0].clips[0].clipId, 'video-clip');
});

test('foundation video clip rendered fallbacks remain editable through unrelated commands', () => {
	const project = videoClipFallbackProject();
	const updated = applyEditorCommand(project, {
		type: 'track/update',
		trackId: 'video-track',
		changes: { name: 'Renamed after return' },
	}, { now: NOW });

	assert.equal(updated.tracks[0]?.name, 'Renamed after return');
	assert.equal(validateAudioEditorProjectV10(updated), true);
});

test('audio export resolves musical labels through the runtime projection', () => {
	const label = createLabelV10({
		id: 'beat-label',
		title: 'Beat label',
		color: 'auto',
		anchor: 'musical',
		startBeat: { num: 1, den: 1 },
		endBeat: { num: 2, den: 1 },
	});
	const project = createAudioEditorProjectV10({
		id: 'musical-label-export',
		title: 'Musical label export',
		now: NOW,
		tracks: [createLabelTrackV10({ id: 'labels', name: 'Labels', labels: [label] })],
	});

	assert.equal(validateAudioEditorProjectV10(project), true);
	const plan = createExportPlan(project, { format: 'wav', markerTrackId: 'labels' });
	assert.deepEqual(plan.markers, [{
		id: 1,
		sampleOffset: 24_000,
		sampleLength: 24_000,
		label: 'Beat label',
		note: '',
	}]);
});

test('untrusted v10 admission rejects foundation state whose owned requirement was omitted', () => {
	const project = createAudioEditorProjectV10({
		id: 'owned-feature-admission',
		now: NOW,
		tempoMap: {
			mode: 'musical',
			events: [
				{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'tempo-2', beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 } },
			],
		},
	});
	assert.ok(project.featureRequirements.requirements.some(({ featureId }) => (
		featureId === 'org.soundscaper.capability.musical-timeline'
	)));
	const omitted = {
		...project,
		featureRequirements: { schemaVersion: 2, requirements: [] },
	};

	assert.throws(() => validateAudioEditorProjectV10(omitted), /owned feature requirement/iu);
	assert.throws(() => loadAudioEditorProjectV10(omitted), /owned feature requirement/iu);
});

function videoProject() {
	const sampleRate = 44_100;
	const sequence = { id: 'main', rate: { num: 24, den: 1 } };
	const source = createVideoSourceV10({
		id: 'video-source',
		storageKey: 'video-source',
		mimeType: 'video/mp4',
		frameCount: sampleRate,
		sampleRate,
		width: 16,
		height: 16,
		sourceFrameRate: sequence.rate,
		sourceFrameCount: 24,
	}, sampleRate);
	const clip = createVideoClipV10({
		id: 'video-clip',
		sourceId: source.id,
		sequenceId: sequence.id,
		sequenceStartFrame: 2,
		sequenceFrameCount: 4,
		sourceInFrame: 0,
		sourceFrameCount: 4,
	}, { projectSampleRate: sampleRate, sequence, source });
	return createAudioEditorProjectV10({
		id: 'runtime-boundary-video',
		title: 'Runtime boundary video',
		now: NOW,
		sampleRate,
		sequences: [sequence],
		primarySequenceId: sequence.id,
		sources: [source],
		clips: [clip],
		tracks: [createVideoTrackV10({ id: 'video-track', clipIds: [clip.id] })],
	});
}

function videoClipFallbackProject() {
	const base = videoProject();
	const target: Record<string, unknown> = {
		...(base.clips[0] as Readonly<Record<string, unknown>>),
		videoEffects: [createVideoEffect('pixelate', { id: 'fallback-effect' })],
	};
	const targetId = String(target.id);
	const fallback = createVideoSourceV10({
		...base.sources[0],
		id: 'video-fallback',
		storageKey: 'video-fallback',
		name: 'Rendered fallback',
		sampleFrameCount: resolveRuntimeClipProjection(base, target).durationFrames,
		sourceFrameCount: target.sourceFrameCount,
		hasAudio: false,
	}, base.sampleRate);
	return createAudioEditorProjectV10({
		...base,
		sources: [base.sources[0], fallback],
		clips: [target],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-video-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1',
					kind: 'video',
					sourceId: fallback.id,
					sha256: 'ab'.repeat(32),
					targetClipId: targetId,
				},
			}],
		},
	});
}
