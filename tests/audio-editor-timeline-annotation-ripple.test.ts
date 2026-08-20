/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareDisjointRangeDeleteCommand,
	prepareRangeDeleteCommand,
} from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const NOW = '2026-08-09T12:00:00.000Z';
const MAIN_SEQUENCE = 'main-sequence';

test('whole-sequence ripple contracts sample and musical authority and prunes removed selections', () => {
	const project = projectWithTracks({
		tracks: [audioTrack('main-track')],
		sequences: [sequence(MAIN_SEQUENCE, ['main-track'])],
		annotations: [
			sampleMarker('sample-before', 12_000),
			sampleMarker('sample-inside', 30_000, 'paired'),
			sampleMarker('sample-after', 60_000),
			sampleRegion('sample-overlap', 12_000, 60_000),
			musicalMarker('musical-inside', rational(3, 2), 'paired'),
			musicalMarker('musical-after', rational(3)),
			musicalRegion('musical-overlap', rational(1, 2), rational(5, 2)),
		],
		selectedAnnotationIds: ['sample-inside', 'musical-inside'],
	});
	const command = preparedRipple(project, 24_000, 48_000, ['main-track']);

	assert.deepEqual(command.annotationRippleOperations, [{
		sequenceId: MAIN_SEQUENCE,
		sampleRange: { startFrame: 24_000, endFrame: 48_000 },
		musicalRange: { startBeat: rational(1), endBeat: rational(2) },
	}]);
	const edited = applyEditorCommand(project, command, { now: NOW });

	assert.deepEqual(annotationState(edited), [
		['sample-before', 'sample', 12_000, 12_000, null],
		['sample-after', 'sample', 36_000, 36_000, null],
		['sample-overlap', 'sample', 12_000, 36_000, null],
		['musical-after', 'musical', rational(2), rational(2), null],
		['musical-overlap', 'musical', rational(1, 2), rational(3, 2), null],
	]);
	assert.deepEqual(edited.selection.annotationIds, []);
});

test('regions use half-open contraction boundaries and retain surviving batch identity', () => {
	const project = projectWithTracks({
		tracks: [audioTrack('main-track')],
		sequences: [sequence(MAIN_SEQUENCE, ['main-track'])],
		annotations: [
			sampleRegion('ending-at-start', 1, 10, 'regions'),
			sampleRegion('ending-inside', 1, 15, 'regions'),
			sampleRegion('inside', 11, 19, 'regions'),
			sampleRegion('starting-inside', 15, 30, 'regions'),
			sampleRegion('starting-at-end', 20, 30, 'regions'),
		],
	});
	const edited = applyEditorCommand(project, preparedRipple(project, 10, 20, ['main-track']), { now: NOW });

	assert.deepEqual(annotationState(edited), [
		['ending-at-start', 'sample', 1, 10, 'regions'],
		['ending-inside', 'sample', 1, 10, 'regions'],
		['starting-inside', 'sample', 10, 20, 'regions'],
		['starting-at-end', 'sample', 10, 20, 'regions'],
	]);
});

test('video participation conforms one shared span for media and annotation ripple', () => {
	const rate = { num: 24, den: 1 };
	const videoSource = createVideoSource({
		id: 'video-source', sampleFrameCount: 20_000, sourceFrameCount: 10,
		width: 16, height: 16, frameRate: rate,
	});
	const audioSource = createAudioSource({ id: 'audio-source', frameCount: 20_000, channelCount: 1 });
	const videoClip = createVideoClip({
		id: 'video-clip', sourceId: 'video-source', sequenceId: MAIN_SEQUENCE,
		sequenceStartFrame: 2, sequenceFrameCount: 1, sourceInFrame: 2, sourceFrameCount: 1,
	}, { projectSampleRate: 48_000, sequence: { id: MAIN_SEQUENCE, rate }, source: videoSource });
	const audioClip = createAudioClip({
		id: 'audio-clip', sourceId: 'audio-source', timelineStartFrame: 4_000,
		durationFrames: 2_000, sourceDurationFrames: 2_000,
	});
	const project = projectWithTracks({
		sources: [videoSource, audioSource],
		clips: [videoClip, audioClip],
		tracks: [videoTrack('video-track', ['video-clip']), audioTrack('audio-track', ['audio-clip'])],
		sequences: [sequence(MAIN_SEQUENCE, ['video-track', 'audio-track'])],
		annotations: [sampleMarker('after', 3_000), musicalMarker('musical-after', rational(1, 8))],
	});
	const command = preparedRipple(project, 0, 1_200, ['video-track', 'audio-track']);

	assert.deepEqual(command.annotationRippleOperations, [{
		sequenceId: MAIN_SEQUENCE,
		sampleRange: { startFrame: 0, endFrame: 2_000 },
		musicalRange: { startBeat: rational(0), endBeat: rational(1, 12) },
	}]);
	const edited = applyEditorCommand(project, command, { now: NOW });
	assert.deepEqual(annotationState(edited), [
		['after', 'sample', 1_000, 1_000, null],
		['musical-after', 'musical', rational(1, 24), rational(1, 24), null],
	]);
	assert.deepEqual(
		resolveRuntimeProjectProjection(edited).clips.map(({ id, timelineStartFrame }) => [id, timelineStartFrame]),
		[['video-clip', 2_000], ['audio-clip', 2_000]],
	);

	const collapsed = preparedRipple(project, 0, 800, ['video-track', 'audio-track']);
	assert.deepEqual(collapsed.annotationRippleOperations, []);
	assert.deepEqual(
		applyEditorCommand(project, collapsed, { now: NOW }).timelineAnnotations,
		project.timelineAnnotations,
	);
});

test('only fully covered media sequences ripple while labels do not block participation', () => {
	const project = projectWithTracks({
		tracks: [
			audioTrack('main-a'), audioTrack('main-b'), labelTrack('main-label'),
			audioTrack('second-a'), labelTrack('second-label'),
		],
		sequences: [
			sequence(MAIN_SEQUENCE, ['main-a', 'main-b', 'main-label']),
			sequence('second', ['second-a', 'second-label']),
		],
		annotations: [
			sampleMarker('main-marker', 30, null, MAIN_SEQUENCE),
			sampleMarker('second-marker', 30, null, 'second'),
		],
	});
	const partial = preparedRipple(project, 10, 20, ['main-a', 'second-a']);
	assert.deepEqual(partial.annotationRippleOperations, [{
		sequenceId: 'second',
		sampleRange: { startFrame: 10, endFrame: 20 },
		musicalRange: { startBeat: rational(1, 2_400), endBeat: rational(1, 1_200) },
	}]);
	assert.deepEqual(annotationState(applyEditorCommand(project, partial, { now: NOW })), [
		['main-marker', 'sample', 30, 30, null],
		['second-marker', 'sample', 20, 20, null],
	]);

	const all = preparedRipple(project, 10, 20, ['main-a', 'main-b', 'second-a']);
	assert.deepEqual(all.annotationRippleOperations?.map(({ sequenceId }) => sequenceId), [MAIN_SEQUENCE, 'second']);
	assert.deepEqual(annotationState(applyEditorCommand(project, all, { now: NOW })), [
		['main-marker', 'sample', 20, 20, null],
		['second-marker', 'sample', 20, 20, null],
	]);

	const source = createAudioSource({ id: 'source', frameCount: 1_000, channelCount: 1 });
	const clips = [
		createAudioClip({ id: 'early', sourceId: 'source', timelineStartFrame: 0, durationFrames: 5 }),
		createAudioClip({ id: 'late', sourceId: 'source', timelineStartFrame: 30, durationFrames: 5 }),
	];
	const withClips = projectWithTracks({
		sources: [source],
		clips,
		tracks: [audioTrack('clip-track', ['early', 'late'])],
		sequences: [sequence(MAIN_SEQUENCE, ['clip-track'])],
		annotations: [sampleMarker('clip-marker', 30)],
	});
	const fullClipCommand = preparedRipple(withClips, 10, 20, ['clip-track']);
	const partialClipCommand = {
		...fullClipCommand,
		clipIds: ['early'],
		annotationRippleOperations: [],
	} as const;
	assert.deepEqual(annotationState(applyEditorCommand(withClips, partialClipCommand, { now: NOW })), [
		['clip-marker', 'sample', 30, 30, null],
	]);
});

test('disjoint preparation simulates annotation contraction right-to-left and replays atomically', () => {
	const project = projectWithTracks({
		tracks: [audioTrack('main-track')],
		sequences: [sequence(MAIN_SEQUENCE, ['main-track'])],
		annotations: [sampleMarker('after', 50), sampleMarker('removed', 35)],
		selectedAnnotationIds: ['removed'],
	});
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareDisjointRangeDeleteCommand(runtime, {
		ranges: [{ startFrame: 10, endFrame: 20 }, { startFrame: 30, endFrame: 40 }],
		trackIds: ['main-track'],
		rippleMode: 'track',
	}) as AudioEditorCommand;

	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') throw new TypeError('Expected a disjoint command batch.');
	assert.deepEqual(command.commands.map((child) => child.type), ['range/ripple-delete', 'range/ripple-delete']);
	assert.ok(command.commands.every((child) => (
		child.type === 'range/ripple-delete' && Array.isArray(child.annotationRippleOperations)
	)));
	const edited = applyEditorCommand(project, command, { now: NOW });
	assert.deepEqual(annotationState(edited), [['after', 'sample', 30, 30, null]]);
	assert.deepEqual(edited.selection.annotationIds, []);
});

test('malformed or forged annotation operations reject the complete edit without mutating input', () => {
	const project = projectWithTracks({
		tracks: [audioTrack('main-track')],
		sequences: [sequence(MAIN_SEQUENCE, ['main-track'])],
		annotations: [sampleMarker('after', 50)],
	});
	const snapshot = structuredClone(project);
	const command = preparedRipple(project, 10, 20, ['main-track']);
	const forged = {
		...command,
		annotationRippleOperations: command.annotationRippleOperations?.map((operation) => ({
			...operation,
			sampleRange: { ...operation.sampleRange, endFrame: 21 },
		})),
	} as AudioEditorCommand;

	assert.throws(() => applyEditorCommand(project, forged, { now: NOW }), /annotation ripple operations.*match/iu);
	assert.throws(() => applyEditorCommand(project, {
		...command,
		annotationRippleOperations: [{
			...command.annotationRippleOperations?.[0],
			unexpected: true,
		}],
	} as unknown as AudioEditorCommand, { now: NOW }), /unsupported field/iu);
	const { annotationRippleOperations: _omitted, ...missing } = command;
	assert.throws(() => applyEditorCommand(project, missing as AudioEditorCommand, { now: NOW }), /requires annotation ripple operations/iu);
	assert.deepEqual(project, snapshot);

	const legacyCommand = prepareRangeDeleteCommand({
		...structuredClone(project),
		schemaVersion: 10,
	} as never, {
		startFrame: 10, endFrame: 20, rippleMode: 'track',
	});
	assert.equal(Object.hasOwn(legacyCommand, 'annotationRippleOperations'), false);
});

test('history undo and redo restore the exact pre- and post-ripple annotation state', () => {
	const project = projectWithTracks({
		tracks: [audioTrack('main-track')],
		sequences: [sequence(MAIN_SEQUENCE, ['main-track'])],
		annotations: [sampleMarker('after', 50), musicalRegion('region', rational(0), rational(1))],
	});
	const before = annotationState(project);
	let history = createEditorHistory(project);
	history = executeEditorCommand(history, preparedRipple(project, 10, 20, ['main-track']), { now: NOW });
	const after = annotationState(history.present as ReturnType<typeof createCurrentAudioEditorProject>);
	assert.notDeepEqual(after, before);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(annotationState(history.present as ReturnType<typeof createCurrentAudioEditorProject>), before);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual(annotationState(history.present as ReturnType<typeof createCurrentAudioEditorProject>), after);
});

function preparedRipple(
	project: ReturnType<typeof createCurrentAudioEditorProject>,
	startFrame: number,
	endFrame: number,
	trackIds: readonly string[],
): Extract<AudioEditorCommand, { readonly type: 'range/ripple-delete' }> {
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareRangeDeleteCommand(runtime, { startFrame, endFrame, trackIds, rippleMode: 'track' });
	if (command.type !== 'range/ripple-delete') throw new TypeError('Expected a ripple-delete command.');
	return command as unknown as Extract<AudioEditorCommand, { readonly type: 'range/ripple-delete' }>;
}

function projectWithTracks(options: Readonly<{
	tracks: readonly Record<string, unknown>[];
	sequences: readonly Record<string, unknown>[];
	annotations: readonly TimelineAnnotationV11[];
	selectedAnnotationIds?: readonly string[];
	sources?: readonly Record<string, unknown>[];
	clips?: readonly Record<string, unknown>[];
}>): ReturnType<typeof createCurrentAudioEditorProject> {
	return createCurrentAudioEditorProject({
		id: 'annotation-ripple',
		now: NOW,
		tracks: options.tracks,
		sources: options.sources,
		clips: options.clips,
		sequences: options.sequences,
		primarySequenceId: MAIN_SEQUENCE,
		timelineAnnotations: options.annotations,
		selection: { annotationIds: options.selectedAnnotationIds ?? [] },
	});
}

function audioTrack(id: string, clipIds: readonly string[] = []): Record<string, unknown> {
	return createAudioTrack({ id, name: id, clipIds });
}

function videoTrack(id: string, clipIds: readonly string[] = []): Record<string, unknown> {
	return createVideoTrack({ id, name: id, clipIds });
}

function labelTrack(id: string): Record<string, unknown> {
	return { id, name: id, type: 'label', labels: [] };
}

function sequence(id: string, trackIds: readonly string[]): Record<string, unknown> {
	return { id, name: id, rate: { num: 24, den: 1 }, trackIds };
}

function common(id: string, batchId: string | null, sequenceId: string) {
	return { id, sequenceId, name: id, color: 'auto' as const, batchId, opaqueExtensions: {} };
}

function sampleMarker(
	id: string,
	positionFrame: number,
	batchId: string | null = null,
	sequenceId = MAIN_SEQUENCE,
): TimelineAnnotationV11 {
	return { ...common(id, batchId, sequenceId), kind: 'marker', anchor: 'sample', positionFrame };
}

function musicalMarker(
	id: string,
	positionBeat: Readonly<{ num: number; den: number }>,
	batchId: string | null = null,
	sequenceId = MAIN_SEQUENCE,
): TimelineAnnotationV11 {
	return { ...common(id, batchId, sequenceId), kind: 'marker', anchor: 'musical', positionBeat };
}

function sampleRegion(
	id: string,
	startFrame: number,
	endFrame: number,
	batchId: string | null = null,
	sequenceId = MAIN_SEQUENCE,
): TimelineAnnotationV11 {
	return { ...common(id, batchId, sequenceId), kind: 'region', anchor: 'sample', startFrame, endFrame };
}

function musicalRegion(
	id: string,
	startBeat: Readonly<{ num: number; den: number }>,
	endBeat: Readonly<{ num: number; den: number }>,
	batchId: string | null = null,
	sequenceId = MAIN_SEQUENCE,
): TimelineAnnotationV11 {
	return { ...common(id, batchId, sequenceId), kind: 'region', anchor: 'musical', startBeat, endBeat };
}

function rational(num: number, den = 1): Readonly<{ num: number; den: number }> {
	return { num, den };
}

function annotationState(project: ReturnType<typeof createCurrentAudioEditorProject>): readonly unknown[] {
	return project.timelineAnnotations.map((annotation) => {
		if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
			return [annotation.id, annotation.anchor, annotation.positionFrame, annotation.positionFrame, annotation.batchId];
		}
		if (annotation.kind === 'marker') {
			return [annotation.id, annotation.anchor, annotation.positionBeat, annotation.positionBeat, annotation.batchId];
		}
		if (annotation.anchor === 'sample') {
			return [annotation.id, annotation.anchor, annotation.startFrame, annotation.endFrame, annotation.batchId];
		}
		return [annotation.id, annotation.anchor, annotation.startBeat, annotation.endBeat, annotation.batchId];
	});
}
