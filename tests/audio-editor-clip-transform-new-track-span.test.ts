import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import {
	createClipTransformService,
} from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import {
	brandRuntimeProjectProjection,
	RUNTIME_CLIP_PROJECTION_VERSION,
} from '../src/common/editor/runtime-clip-projection.ts';

test('moving a group to new tracks reserves the whole span whichever clip is grabbed', () => {
	const harness = createHarness(projectFixture());

	const targetTrackId = harness.service.moveClipsToNewTrack('companion', 400);

	const command = harness.commits[0]?.command;
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one new-track batch.');
	const added = command.commands.filter((entry) => entry.type === 'track/add');
	assert.equal(added.length, 2, 'the group spans two tracks, so two fresh tracks are reserved');
	const addedTrackIds = added.map((entry) => entry.type === 'track/add' ? entry.track.id : '');
	const transform = command.commands.find((entry) => entry.type === 'clip/transform-many');
	assert.equal(transform?.type, 'clip/transform-many');
	if (transform?.type !== 'clip/transform-many') assert.fail('Expected a grouped new-track transform.');
	assert.deepEqual(transform.transforms.map(({ clipId, trackId, changes }) => ({
		clipId, trackId, timelineStartFrame: changes.timelineStartFrame,
	})), [{
		clipId: 'active', trackId: addedTrackIds[0], timelineStartFrame: 300,
	}, {
		clipId: 'companion', trackId: addedTrackIds[1], timelineStartFrame: 400,
	}]);
	for (const entry of transform.transforms) {
		assert.ok(
			addedTrackIds.includes(entry.trackId ?? ''),
			`clip ${entry.clipId} must land on a new track, not ${String(entry.trackId)}`,
		);
	}
	assert.equal(targetTrackId, addedTrackIds[1], 'the grabbed clip keeps its own new track');
	assert.deepEqual(harness.commits[0]?.selection, {
		selectTrackId: addedTrackIds[1], selectClipId: 'companion',
	});
});

test('grabbing the topmost clip of the same group produces the same destinations', () => {
	const fromTop = createHarness(projectFixture());
	const fromBottom = createHarness(projectFixture());

	fromTop.service.moveClipsToNewTrack('active', 300);
	fromBottom.service.moveClipsToNewTrack('companion', 400);

	assert.deepEqual(newTrackDestinations(fromTop), newTrackDestinations(fromBottom));
	const selection = fromBottom.commits[0]?.command;
	assert.equal(selection?.type, 'batch');
	if (selection?.type !== 'batch') assert.fail('Expected one new-track batch.');
	const selectionCommand = selection.commands.find((entry) => entry.type === 'selection/set');
	assert.equal(selectionCommand?.type, 'selection/set');
	if (selectionCommand?.type !== 'selection/set') assert.fail('Expected a remapped selection.');
	assert.deepEqual(selectionCommand.trackIds, ['track-1', 'track-2']);
});

function newTrackDestinations(harness: ReturnType<typeof createHarness>): Array<[string, string]> {
	const command = harness.commits[0]?.command;
	if (command?.type !== 'batch') return assert.fail('Expected one new-track batch.');
	const transform = command.commands.find((entry) => entry.type === 'clip/transform-many');
	if (transform?.type !== 'clip/transform-many') return assert.fail('Expected a grouped transform.');
	return transform.transforms.map((entry) => [entry.clipId, entry.trackId ?? '']);
}

function createHarness(project: ClipTransformProject) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const commits: Array<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}> = [];
	let nextId = 0;
	const service = createClipTransformService({
		lifetime,
		copy: {
			audioClipNotFound: 'Audio clip not found.', track: 'Track',
			timelineFramesFinite: 'Timeline frames must be finite.',
		},
		getProject: () => project,
		getSelectedClipId: () => 'active',
		editingBlocked: () => false,
		createId: (prefix) => `${prefix}-${++nextId}`,
		snapTimelineFrame: (frame) => Math.round(Number(frame)),
		activeSelection: () => project.selection?.endFrame !== project.selection?.startFrame
			? project.selection ?? null
			: null,
		commit: (command, selection) => {
			commits.push({ command, ...(selection ? { selection } : {}) });
			return project;
		},
	});
	return { commits, service };
}

function projectFixture(): ClipTransformProject {
	return brandRuntimeProjectProjection({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		projectBin: { clips: [] },
		timelineAnnotations: [],
		sequences: [{ id: 'main-sequence' }],
		primarySequenceId: 'main-sequence',
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		tracks: [{ id: 'track-a', name: 'A', type: 'audio', clipIds: ['active'] }, {
			id: 'track-b', name: 'B', type: 'audio', clipIds: ['companion'],
		}, { id: 'track-c', name: 'C', type: 'audio', clipIds: [] }],
		clips: [clipFixture({ id: 'active', timelineStartFrame: 100 }), clipFixture({
			id: 'companion', timelineStartFrame: 200,
		})],
		sources: [{
			id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
			frameCount: 4_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: {
			startFrame: 50, endFrame: 350,
			trackIds: ['track-a', 'track-b'], clipIds: ['active', 'companion'],
			frequencyRange: null,
		},
		runtimeProjectionVersion: RUNTIME_CLIP_PROJECTION_VERSION,
	}) as unknown as ClipTransformProject;
}

function clipFixture(overrides: Readonly<Record<string, unknown>> = {}) {
	const clip = {
		id: 'active', sourceId: 'source', title: 'Clip', kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		durationFrames: 1_000, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], groupId: null, avLinkId: null, pitchCents: 0, speedRatio: 1,
		preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
		opaqueExtensions: {},
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
