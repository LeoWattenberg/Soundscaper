/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
	applyEditorCommand,
	createAddTimelineAnnotationCommand,
	createBatchSetTimelineAnnotationsCommand,
	createConvertTimelineAnnotationCommand,
	createMoveTimelineAnnotationsCommand,
	createRemoveTimelineAnnotationsCommand,
	createResizeTimelineAnnotationCommand,
	createUpdateTimelineAnnotationsCommand,
} from '../src/common/editor/commands.js';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV11 } from '../src/common/editor/project-v11.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';
import { createTimelineAnnotationRuntimeHandlers } from '../src/common/editor/commands/timeline-annotation-runtime.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';

const NOW = '2026-08-09T18:00:00.000Z';

test('the global runtime applies all seven exact-V11 annotation commands without leaking transients', () => {
	let project = fixtureProject();
	project = applyEditorCommand(project, createAddTimelineAnnotationCommand(sampleMarker('added', 90)), { now: NOW });
	project = applyEditorCommand(project, createUpdateTimelineAnnotationsCommand(
		['sample-marker', 'musical-region'],
		{ name: 'Shared', color: 'cyan' },
	), { now: NOW });
	project = applyEditorCommand(project, createMoveTimelineAnnotationsCommand(
		['sample-marker', 'musical-marker'],
		{ sampleFrames: 5, beats: { num: 1, den: 2 } },
	), { now: NOW });
	project = applyEditorCommand(project, createResizeTimelineAnnotationCommand(
		'sample-region', 'start', { anchor: 'sample', frame: 25 },
	), { now: NOW });
	project = applyEditorCommand(project, createConvertTimelineAnnotationCommand(
		'sample-marker', { kind: 'marker', anchor: 'musical', positionBeat: { num: 3, den: 2 } },
	), { now: NOW });
	project = applyEditorCommand(project, createBatchSetTimelineAnnotationsCommand(
		['sample-region', 'musical-region'], 'shared-batch',
	), { now: NOW });
	project = applyEditorCommand(project, createRemoveTimelineAnnotationsCommand(['selected-marker']), { now: NOW });

	assert.deepEqual(project.timelineAnnotations.map(({ id }) => id), [
		'sample-marker', 'musical-marker', 'sample-region', 'musical-region', 'added',
	]);
	assert.deepEqual(project.selection.annotationIds, []);
	assert.deepEqual(annotation(project, 'sample-marker'), {
		...common('sample-marker'), name: 'Shared', color: 'cyan',
		kind: 'marker', anchor: 'musical', positionBeat: { num: 3, den: 2 },
	});
	assert.deepEqual(annotation(project, 'musical-marker'), {
		...common('musical-marker'), kind: 'marker', anchor: 'musical', positionBeat: { num: 3, den: 2 },
	});
	assert.deepEqual(annotation(project, 'sample-region'), {
		...common('sample-region'), batchId: 'shared-batch',
		kind: 'region', anchor: 'sample', startFrame: 25, endFrame: 40,
	});
	assert.deepEqual(annotation(project, 'musical-region'), {
		...common('musical-region'), name: 'Shared', color: 'cyan', batchId: 'shared-batch',
		kind: 'region', anchor: 'musical', startBeat: { num: 2, den: 1 }, endBeat: { num: 3, den: 1 },
	});
	for (const value of project.timelineAnnotations) {
		assert.equal(Object.hasOwn(value, 'timelineStartFrame'), false);
		assert.equal(Object.hasOwn(value, 'timelineEndFrame'), false);
		assert.equal(Object.hasOwn(value, 'durationFrames'), false);
		assert.equal(Object.hasOwn(value, 'coordinateDomain'), false);
	}
});

test('annotation commands are exact-V11, atomic, and reconcile the reserved owned requirement', () => {
	const empty = createAudioEditorProjectV11({ id: 'annotation-requirement', now: NOW });
	const added = applyEditorCommand(empty, createAddTimelineAnnotationCommand(sampleMarker('only', 10)), { now: NOW });
	assert.ok(added.featureRequirements.requirements.some(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations
	)));
	const removed = applyEditorCommand(added, createRemoveTimelineAnnotationsCommand(['only']), { now: NOW });
	assert.ok(removed.featureRequirements.requirements.every(({ id }) => (
		id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations
	)));

	const historical = createAudioEditorProjectV10({ id: 'annotation-v10-reject', now: NOW });
	assert.throws(
		() => applyEditorCommand(historical, createAddTimelineAnnotationCommand(sampleMarker('no-v10', 10)), { now: NOW }),
		/exact schema V11|schema 11/iu,
	);

	const original = fixtureProject();
	const snapshot = structuredClone(original);
	assert.throws(() => applyEditorCommand(original, {
		type: 'timeline-annotation/move-many',
		annotationIds: ['sample-marker', 'sample-region'],
		delta: { sampleFrames: -100, beats: { num: 0, den: 1 } },
	}, { now: NOW }), /non-negative/iu);
	assert.deepEqual(original, snapshot);
	assert.throws(() => applyEditorCommand(original, createAddTimelineAnnotationCommand({
		...sampleMarker('smuggled-transient', 5),
		timelineStartFrame: 5,
	} as unknown as TimelineAnnotationV11), { now: NOW }), /unsupported.*timelineStartFrame/iu);
	assert.deepEqual(original, snapshot);

	const handlers = createTimelineAnnotationRuntimeHandlers();
	assert.throws(
		() => handlers['timeline-annotation/remove-many'](fixtureProject(), {
			type: 'timeline-annotation/remove-many',
			annotationIds: ['sample-marker'],
		}),
		/trusted runtime projection/iu,
	);
});

test('tempo commands preserve authoritative annotation order while changing only the runtime projection', () => {
	const original = fixtureProject();
	const before = resolveRuntimeProjectProjection(original);
	const edited = applyEditorCommand(original, {
		type: 'tempo/set',
		bpm: 60,
	}, { now: NOW });
	const after = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		edited.timelineAnnotations.map(({ id }) => id),
		original.timelineAnnotations.map(({ id }) => id),
	);
	assert.deepEqual(
		annotation(edited, 'musical-marker'),
		annotation(original, 'musical-marker'),
	);
	assert.equal(before.timelineAnnotations?.find(({ id }) => id === 'musical-marker')?.timelineStartFrame, 24_000);
	assert.equal(after.timelineAnnotations?.find(({ id }) => id === 'musical-marker')?.timelineStartFrame, 48_000);
	for (const value of edited.timelineAnnotations) {
		assert.equal(Object.hasOwn(value, 'coordinateDomain'), false);
	}
});

test('cross-domain batches rebase annotation commands after a tempo-map mutation', () => {
	const original = fixtureProject();
	const edited = applyEditorCommand(original, {
		type: 'batch',
		commands: [{
			type: 'tempo/set',
			bpm: 60,
		}, {
			type: 'timeline-annotation/update-many',
			annotationIds: ['musical-marker'],
			changes: { name: 'After tempo edit' },
		}],
	}, { now: NOW });

	assert.equal(annotation(edited, 'musical-marker').name, 'After tempo edit');
	assert.deepEqual(
		(annotation(edited, 'musical-marker') as Extract<TimelineAnnotationV11, { anchor: 'musical'; kind: 'marker' }>).positionBeat,
		{ num: 1, den: 1 },
	);
	assert.equal(
		resolveRuntimeProjectProjection(edited).timelineAnnotations
			?.find(({ id }) => id === 'musical-marker')?.timelineStartFrame,
		48_000,
	);
});

test('history restores annotation state, selection, and its owned requirement through undo and redo', () => {
	let history = createEditorHistory(createAudioEditorProjectV11({
		id: 'annotation-history',
		now: NOW,
	}));
	const initial = historyState(history.present);
	history = executeEditorCommand(history, createAddTimelineAnnotationCommand(
		sampleMarker('history-marker', 10),
	), { now: NOW });
	const afterAdd = historyState(history.present);
	history = executeEditorCommand(history, {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 10,
		annotationIds: ['history-marker'],
	}, { now: NOW });
	const afterSelection = historyState(history.present);
	history = executeEditorCommand(history, createUpdateTimelineAnnotationsCommand(
		['history-marker'],
		{ name: 'Updated in history', color: 'orange' },
	), { now: NOW });
	const afterUpdate = historyState(history.present);
	history = executeEditorCommand(history, createRemoveTimelineAnnotationsCommand(
		['history-marker'],
	), { now: NOW });
	const afterRemove = historyState(history.present);

	assert.deepEqual(afterRemove, initial);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(historyState(history.present), afterUpdate);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(historyState(history.present), afterSelection);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(historyState(history.present), afterAdd);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(historyState(history.present), initial);

	for (const expected of [afterAdd, afterSelection, afterUpdate, afterRemove]) {
		history = redoEditorCommand(history, { now: NOW });
		assert.deepEqual(historyState(history.present), expected);
	}
});

test('maximum annotation and tempo maps remain bounded through command and shared projection', () => {
	const count = 4_096;
	const annotations = Array.from({ length: count }, (_, index) => ({
		...common(`annotation-${String(index).padStart(4, '0')}`),
		kind: 'marker' as const,
		anchor: 'musical' as const,
		positionBeat: { num: index, den: 1 },
	}));
	const project = createAudioEditorProjectV11({
		id: 'annotation-command-maximum',
		now: NOW,
		tempoMap: {
			mode: 'musical',
			events: Array.from({ length: count }, (_, index) => ({
				id: `tempo-${String(index)}`,
				beat: { num: index, den: 1 },
				bpm: { num: index % 2 === 0 ? 120 : 90, den: 1 },
			})),
		},
		timelineAnnotations: annotations,
	});
	const startedAt = performance.now();
	const edited = applyEditorCommand(project, createUpdateTimelineAnnotationsCommand(
		annotations.map(({ id }) => id),
		{ color: 'blue' },
	), { now: NOW });
	const projected = resolveRuntimeProjectProjection(edited);
	const elapsed = performance.now() - startedAt;

	assert.equal(edited.timelineAnnotations.length, count);
	assert.equal(projected.timelineAnnotations?.length, count);
	assert.ok(elapsed < 2_000, `maximum annotation command and projection took ${String(Math.round(elapsed))} ms`);
});

test('annotation factories validate IDs and defensively clone every nested payload', () => {
	const source = sampleMarker('factory-marker', 12);
	const add = createAddTimelineAnnotationCommand(source);
	const ids = ['factory-marker'];
	const changes = { name: 'Renamed', color: 'violet' as const };
	const update = createUpdateTimelineAnnotationsCommand(ids, changes);
	const delta = { sampleFrames: 1, beats: { num: 1, den: 2 } };
	const move = createMoveTimelineAnnotationsCommand(ids, delta);
	const coordinate = { anchor: 'sample' as const, frame: 20 };
	const resize = createResizeTimelineAnnotationCommand('factory-marker', 'end', coordinate);
	const coordinates = { kind: 'marker' as const, anchor: 'musical' as const, positionBeat: { num: 2, den: 1 } };
	const convert = createConvertTimelineAnnotationCommand('factory-marker', coordinates);
	const remove = createRemoveTimelineAnnotationsCommand(ids);
	const batch = createBatchSetTimelineAnnotationsCommand(ids, 'batch');

	source.name = 'Mutated';
	ids[0] = 'mutated';
	changes.name = 'Mutated';
	delta.beats.num = 9;
	coordinate.frame = 99;
	coordinates.positionBeat.num = 9;
	assert.equal(add.annotation.name, 'factory-marker');
	assert.deepEqual(update, { type: 'timeline-annotation/update-many', annotationIds: ['factory-marker'], changes: { name: 'Renamed', color: 'violet' } });
	assert.deepEqual(move.delta, { sampleFrames: 1, beats: { num: 1, den: 2 } });
	assert.deepEqual(resize.coordinate, { anchor: 'sample', frame: 20 });
	assert.deepEqual(convert.coordinates, { kind: 'marker', anchor: 'musical', positionBeat: { num: 2, den: 1 } });
	assert.deepEqual(remove.annotationIds, ['factory-marker']);
	assert.deepEqual(batch, { type: 'timeline-annotation/batch-set', annotationIds: ['factory-marker'], batchId: 'batch' });
	for (const command of [add, update, move, resize, convert, remove, batch]) {
		assert.deepEqual(JSON.parse(JSON.stringify(command)), command);
	}

	for (const create of [
		() => createUpdateTimelineAnnotationsCommand([], { name: 'No' }),
		() => createMoveTimelineAnnotationsCommand([' duplicate ', ' duplicate '], delta),
		() => createRemoveTimelineAnnotationsCommand(['valid', 'valid']),
		() => createResizeTimelineAnnotationCommand('', 'start', coordinate),
		() => createBatchSetTimelineAnnotationsCommand(['valid'], ' '),
	]) assert.throws(create, /ID|non-empty|canonical|duplicate/iu);
	for (const unsafe of [
		{ ...source, opaqueExtensions: { bigint: 1n } },
		{ ...source, opaqueExtensions: { map: new Map([['value', 1]]) } },
	]) {
		assert.throws(
			() => createAddTimelineAnnotationCommand(unsafe as unknown as TimelineAnnotationV11),
			/JSON-safe|plain JSON objects/iu,
		);
	}
	const lossyArray = [1] as number[] & Record<string, unknown>;
	lossyArray['4294967295'] = 2;
	assert.throws(() => createAddTimelineAnnotationCommand({
		...source,
		opaqueExtensions: { lossyArray },
	}), /non-JSON array field/iu);
	assert.throws(() => createConvertTimelineAnnotationCommand('factory-marker', {
		kind: 'marker',
		anchor: 'musical',
		positionBeat: { num: 1n, den: 1 },
	} as never), /JSON-safe/iu);
	assert.throws(() => createMoveTimelineAnnotationsCommand(['factory-marker'], {
		sampleFrames: -0,
		beats: { num: 0, den: 1 },
	}), /exact finite JSON numbers/iu);
});

test('the low-level runtime rejects non-replayable nested command records atomically', () => {
	const original = fixtureProject();
	const snapshot = structuredClone(original);
	let getterReads = 0;
	const accessorChanges: Record<string, unknown> = {};
	Object.defineProperty(accessorChanges, 'name', {
		enumerable: true,
		get() {
			getterReads += 1;
			return `unstable-${String(getterReads)}`;
		},
	});
	assert.throws(() => applyEditorCommand(original, {
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker', 'musical-marker'],
		changes: accessorChanges,
	} as never, { now: NOW }), /own enumerable data property/iu);
	assert.equal(getterReads, 0);

	const symbolicDelta = {
		sampleFrames: 1,
		beats: { num: 0, den: 1 },
		[Symbol('lossy')]: true,
	};
	assert.throws(() => applyEditorCommand(original, {
		type: 'timeline-annotation/move-many',
		annotationIds: ['sample-marker'],
		delta: symbolicDelta,
	} as never, { now: NOW }), /unsupported field.*Symbol\(lossy\)/iu);

	const hiddenCoordinate = { anchor: 'sample' } as Record<string, unknown>;
	Object.defineProperty(hiddenCoordinate, 'frame', { enumerable: false, value: 30 });
	assert.throws(() => applyEditorCommand(original, {
		type: 'timeline-annotation/resize',
		annotationId: 'sample-region',
		edge: 'start',
		coordinate: hiddenCoordinate,
	} as never, { now: NOW }), /own enumerable data property/iu);
	assert.deepEqual(original, snapshot);
});

function fixtureProject(): ReturnType<typeof createAudioEditorProjectV11> {
	return createAudioEditorProjectV11({
		id: 'annotation-command-integration',
		now: NOW,
		timelineAnnotations: [
			sampleMarker('sample-marker', 10),
			musicalMarker('musical-marker', { num: 1, den: 1 }),
			sampleRegion('sample-region', 20, 40),
			musicalRegion('musical-region', { num: 2, den: 1 }, { num: 3, den: 1 }),
			sampleMarker('selected-marker', 60),
		],
		selection: { annotationIds: ['selected-marker'] },
	});
}

function common(id: string) {
	return {
		id,
		sequenceId: 'main-sequence',
		name: id,
		color: 'auto' as const,
		batchId: null,
		opaqueExtensions: {},
	};
}

function sampleMarker(id: string, positionFrame: number) {
	return {
		...common(id),
		color: 'auto' as const,
		kind: 'marker' as const,
		anchor: 'sample' as const,
		positionFrame,
	};
}

function musicalMarker(id: string, positionBeat: Readonly<{ num: number; den: number }>): TimelineAnnotationV11 {
	return { ...common(id), kind: 'marker', anchor: 'musical', positionBeat };
}

function sampleRegion(id: string, startFrame: number, endFrame: number): TimelineAnnotationV11 {
	return { ...common(id), kind: 'region', anchor: 'sample', startFrame, endFrame };
}

function musicalRegion(
	id: string,
	startBeat: Readonly<{ num: number; den: number }>,
	endBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
	return { ...common(id), kind: 'region', anchor: 'musical', startBeat, endBeat };
}

function annotation(
	project: ReturnType<typeof createAudioEditorProjectV11>,
	id: string,
): TimelineAnnotationV11 {
	const result = project.timelineAnnotations.find((candidate) => candidate.id === id);
	if (!result) throw new ReferenceError(`Missing annotation fixture ${id}.`);
	return result;
}

function historyState(projectValue: object) {
	const project = projectValue as ReturnType<typeof createAudioEditorProjectV11>;
	return {
		timelineAnnotations: structuredClone(project.timelineAnnotations),
		annotationIds: [...project.selection.annotationIds],
		hasOwnedRequirement: project.featureRequirements.requirements.some(({ id }) => (
			id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations
		)),
	};
}
