/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createTimelineAnnotationService,
	type TimelineAnnotationControllerState,
} from '../src/common/editor/controller/timeline-annotation-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const NOW = new Date('2026-08-09T12:00:00.000Z');

test('creates a musical region from the selection and a sample marker at the playhead atomically', () => {
	const fixture = serviceFixture({
		annotations: [],
		selection: { startFrame: 6_000, endFrame: 18_000, annotationIds: [] },
		positionFrame: 12_000,
		ids: ['region-created', 'marker-created'],
	});

	assert.equal(fixture.service.createRegion({ anchor: 'musical', name: 'Verse' }), 'region-created');
	assert.equal(fixture.service.createMarker({ name: 'Hit', color: 'red' }), 'marker-created');

	assert.deepEqual(fixture.commands[0], {
		type: 'batch',
		commands: [{
			type: 'timeline-annotation/add',
			annotation: {
				...common('region-created', 'Verse'),
				kind: 'region',
				anchor: 'musical',
				startBeat: { num: 1, den: 4 },
				endBeat: { num: 3, den: 4 },
			},
		}, {
			type: 'selection/set',
			startFrame: 6_000,
			endFrame: 18_000,
			trackIds: [],
			clipIds: [],
			annotationIds: ['region-created'],
			frequencyRange: null,
		}],
	});
	assert.deepEqual(fixture.commands[1], {
		type: 'batch',
		commands: [{
			type: 'timeline-annotation/add',
			annotation: {
				...common('marker-created', 'Hit'),
				color: 'red',
				kind: 'marker',
				anchor: 'sample',
				positionFrame: 12_000,
			},
		}, {
			type: 'selection/set',
			startFrame: 12_000,
			endFrame: 12_000,
			trackIds: [],
			clipIds: [],
			annotationIds: ['marker-created'],
			frequencyRange: null,
		}],
	});
	assert.equal(fixture.state.selectedAnnotationId, 'marker-created');
	assert.deepEqual(fixture.project().selection.annotationIds, ['marker-created']);
	assert.equal(fixture.commitCount(), 2);
});

test('emits the seven annotation command families through existing application ports', () => {
	const fixture = serviceFixture({ annotations: annotationFixture() });

	fixture.service.renameAnnotations(['sample-marker', 'musical-marker'], 'Renamed');
	fixture.service.setAnnotationColor(['sample-marker'], 'violet');
	fixture.service.moveAnnotations(['sample-marker', 'musical-marker'], 12_000, 'sample-marker');
	fixture.service.resizeAnnotation('musical-region', 'end', 96_000);
	fixture.service.convertAnnotation('sample-region', { kind: 'region', anchor: 'musical' });
	fixture.service.setAnnotationBatch(['sample-marker', 'musical-marker'], 'batch-a');
	fixture.service.removeAnnotations(['sample-region']);

	assert.deepEqual(fixture.commands, [{
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker', 'musical-marker'],
		changes: { name: 'Renamed' },
	}, {
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker'],
		changes: { color: 'violet' },
	}, {
		type: 'timeline-annotation/move-many',
		annotationIds: ['sample-marker', 'musical-marker'],
		delta: { sampleFrames: 12_000, beats: { num: 1, den: 2 } },
	}, {
		type: 'timeline-annotation/resize',
		annotationId: 'musical-region',
		edge: 'end',
		coordinate: { anchor: 'musical', beat: { num: 4, den: 1 } },
	}, {
		type: 'timeline-annotation/convert',
		annotationId: 'sample-region',
		coordinates: {
			kind: 'region',
			anchor: 'musical',
			startBeat: { num: 1, den: 4 },
			endBeat: { num: 1, den: 2 },
		},
	}, {
		type: 'timeline-annotation/batch-set',
		annotationIds: ['sample-marker', 'musical-marker'],
		batchId: 'batch-a',
	}, {
		type: 'timeline-annotation/remove-many',
		annotationIds: ['sample-region'],
	}]);
	assert.equal(fixture.commitCount(), 7);
	assert.deepEqual(annotation(fixture.project(), 'musical-marker'), {
		...common('musical-marker'),
		name: 'Renamed',
		batchId: 'batch-a',
		kind: 'marker',
		anchor: 'musical',
		positionBeat: { num: 5, den: 2 },
	});
	assert.equal(fixture.project().timelineAnnotations.some(({ id }) => id === 'sample-region'), false);
});

test('mixed-anchor movement derives one exact beat delta from the primary resolved position', () => {
	const fixture = serviceFixture({
		annotations: [
			sampleMarker('primary', 24_000),
			musicalMarker('musical-peer', { num: 3, den: 2 }),
			sampleRegion('sample-peer', 48_000, 60_000),
		],
	});

	fixture.service.moveAnnotations(['primary', 'musical-peer', 'sample-peer'], -6_000, 'primary');

	assert.deepEqual(fixture.commands[0], {
		type: 'timeline-annotation/move-many',
		annotationIds: ['primary', 'musical-peer', 'sample-peer'],
		delta: { sampleFrames: -6_000, beats: { num: -1, den: 4 } },
	});
	assert.equal(sampleAnnotation(fixture.project(), 'primary').positionFrame, 18_000);
	assert.deepEqual(musicalAnnotation(fixture.project(), 'musical-peer').positionBeat, { num: 5, den: 4 });
	assert.deepEqual(sampleRegionAnnotation(fixture.project(), 'sample-peer'), {
		...common('sample-peer'),
		kind: 'region',
		anchor: 'sample',
		startFrame: 42_000,
		endFrame: 54_000,
	});
});

test('selection and toggle commands preserve non-annotation selection fields and reconcile focus', () => {
	const fixture = serviceFixture({
		annotations: annotationFixture(),
		selection: {
			startFrame: 200,
			endFrame: 400,
			trackIds: [],
			clipIds: [],
			annotationIds: ['musical-marker'],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
		},
	});

	assert.deepEqual(fixture.service.selectAnnotation('sample-region'), ['sample-region']);
	assert.deepEqual(fixture.commands[0], {
		type: 'selection/set',
		startFrame: 6_000,
		endFrame: 12_000,
		trackIds: [],
		clipIds: [],
		annotationIds: ['sample-region'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
	});
	assert.deepEqual(fixture.service.toggleAnnotation('musical-marker'), ['sample-region', 'musical-marker']);
	assert.equal(fixture.state.selectedAnnotationId, 'musical-marker');
	assert.deepEqual(
		fixture.service.selectAnnotation('sample-region', true),
		['sample-region', 'musical-marker'],
		'additive selection preserves peers when the requested ID is already selected',
	);
	assert.deepEqual(fixture.service.toggleAnnotation('musical-marker'), ['sample-region']);
	assert.equal(fixture.state.selectedAnnotationId, 'sample-region');

	fixture.state.selectedAnnotationId = 'stale';
	assert.equal(fixture.service.synchronizeFocus(), 'sample-region');
	fixture.service.removeAnnotations(['sample-region']);
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection.annotationIds, []);
});

test('previous and next navigation use projected order within the requested sequence', () => {
	const fixture = serviceFixture({
		positionFrame: 15,
		annotations: [
			sampleMarker('late', 30),
			sampleMarker('foreign', 16, 'secondary'),
			sampleRegion('middle-region', 20, 25),
			sampleMarker('early', 10),
		],
		sequences: [{ id: 'main-sequence' }, { id: 'secondary' }],
	});

	assert.equal(fixture.service.navigateNextAnnotation()?.id, 'middle-region');
	assert.equal(fixture.service.navigateNextAnnotation()?.id, 'late');
	assert.equal(fixture.service.navigateNextAnnotation(), null);
	assert.equal(fixture.state.selectedAnnotationId, 'late');
	assert.equal(fixture.service.navigatePreviousAnnotation()?.id, 'middle-region');
	assert.deepEqual(fixture.commands.at(-1), {
		type: 'selection/set',
		startFrame: 20,
		endFrame: 25,
		trackIds: [],
		clipIds: [],
		annotationIds: ['middle-region'],
		frequencyRange: null,
	});
	assert.equal(fixture.service.navigateNextAnnotation('secondary')?.id, 'foreign');
});

test('blocked navigation retains view focus without changing durable selection', () => {
	const fixture = serviceFixture({
		editingBlocked: true,
		positionFrame: 15,
		annotations: [sampleMarker('late', 30), sampleRegion('middle-region', 20, 25), sampleMarker('early', 10)],
	});

	assert.equal(fixture.service.navigateNextAnnotation()?.id, 'middle-region');
	assert.equal(fixture.state.selectedAnnotationId, 'middle-region');
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.service.createMarker(), null);
	assert.equal(fixture.service.selectAnnotation('early'), null);
});

test('older and future projects clear focus without traversing annotation state', () => {
	let annotationReads = 0;
	const future = {
		schemaVersion: 15,
		get timelineAnnotations() {
			annotationReads += 1;
			throw new Error('future annotations must remain opaque');
		},
	};
	const state: TimelineAnnotationControllerState = { selectedAnnotationId: 'future-focus' };
	const service = createTimelineAnnotationService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => future,
		editingBlocked: () => false,
		createId: () => 'new-annotation',
		getPositionFrames: () => 0,
		commit: () => { throw new Error('must not commit'); },
		updateSelection: () => { throw new Error('must not select'); },
		publishProjectState: () => undefined,
	});

	assert.equal(service.synchronizeFocus(), null);
	assert.equal(state.selectedAnnotationId, null);
	assert.throws(() => service.createMarker(), /schema V11 or V12/iu);
	assert.throws(() => service.navigateNextAnnotation(), /schema V11 or V12/iu);
	assert.equal(annotationReads, 0);

	const older = { schemaVersion: 10 };
	Object.defineProperty(older, 'timelineAnnotations', {
		get: () => { annotationReads += 1; throw new Error('older annotations must remain opaque'); },
	});
	const olderService = createTimelineAnnotationService({
		lifetime: { assertActive: () => undefined },
		state: { selectedAnnotationId: 'older-focus' },
		getProject: () => older,
		editingBlocked: () => false,
		createId: () => 'new-annotation',
		getPositionFrames: () => 0,
		commit: () => { throw new Error('must not commit'); },
		updateSelection: () => { throw new Error('must not select'); },
		publishProjectState: () => undefined,
	});
	assert.equal(olderService.synchronizeFocus(), null);
	assert.equal(annotationReads, 0);
});

test('conversion preserves resolved geometry and requires an endpoint when expanding a marker', () => {
	const fixture = serviceFixture({ annotations: annotationFixture() });

	fixture.service.convertAnnotation('musical-region', { kind: 'region', anchor: 'sample' });
	fixture.service.convertAnnotation('musical-marker', { kind: 'marker', anchor: 'sample' });
	assert.throws(
		() => fixture.service.convertAnnotation('sample-marker', { kind: 'region', anchor: 'sample' }),
		/regionEndFrame/iu,
	);
	fixture.service.convertAnnotation('sample-marker', {
		kind: 'region',
		anchor: 'sample',
		regionEndFrame: 36_000,
	});

	assert.deepEqual(fixture.commands, [{
		type: 'timeline-annotation/convert',
		annotationId: 'musical-region',
		coordinates: { kind: 'region', anchor: 'sample', startFrame: 48_000, endFrame: 72_000 },
	}, {
		type: 'timeline-annotation/convert',
		annotationId: 'musical-marker',
		coordinates: { kind: 'marker', anchor: 'sample', positionFrame: 48_000 },
	}, {
		type: 'timeline-annotation/convert',
		annotationId: 'sample-marker',
		coordinates: { kind: 'region', anchor: 'sample', startFrame: 24_000, endFrame: 36_000 },
	}]);
});

test('focus rolls back when a mutation or durable-selection application port rejects', () => {
	const project = createCurrentAudioEditorProject({
		id: 'annotation-service-rollback',
		now: NOW,
		timelineAnnotations: [sampleMarker('existing', 10)],
		selection: { annotationIds: ['existing'] },
	});
	const state: TimelineAnnotationControllerState = { selectedAnnotationId: 'existing' };
	let failSelection = false;
	const service = createTimelineAnnotationService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => project,
		editingBlocked: () => false,
		createId: () => 'created',
		getPositionFrames: () => 20,
		commit: () => { throw new Error('commit rejected'); },
		updateSelection: () => {
			failSelection = true;
			throw new Error('selection rejected');
		},
		publishProjectState: () => undefined,
	});

	assert.throws(() => service.createMarker(), /commit rejected/iu);
	assert.equal(state.selectedAnnotationId, 'existing');
	assert.throws(() => service.selectAnnotations([], null), /selection rejected/iu);
	assert.equal(failSelection, true);
	assert.equal(state.selectedAnnotationId, 'existing');
	assert.deepEqual(project.timelineAnnotations.map(({ id }) => id), ['existing']);
});

type TestProject = ReturnType<typeof createCurrentAudioEditorProject>;

interface ServiceFixtureOptions {
	readonly annotations?: readonly TimelineAnnotationV11[];
	readonly selection?: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
		readonly trackIds?: readonly string[];
		readonly clipIds?: readonly string[];
		readonly annotationIds?: readonly string[];
		readonly frequencyRange?: Readonly<{
			readonly minimumFrequency: number;
			readonly maximumFrequency: number;
		}> | null;
	}>;
	readonly sequences?: readonly Readonly<{ readonly id: string }>[];
	readonly positionFrame?: number;
	readonly ids?: readonly string[];
	readonly editingBlocked?: boolean;
}

function serviceFixture(options: ServiceFixtureOptions = {}) {
	let project = createCurrentAudioEditorProject({
		id: 'annotation-service-test',
		now: NOW,
		sequences: options.sequences,
		timelineAnnotations: options.annotations ?? annotationFixture(),
		selection: options.selection,
	});
	const commands: AudioEditorCommand[] = [];
	const state: TimelineAnnotationControllerState = { selectedAnnotationId: null };
	const ids = [...(options.ids ?? [])];
	let commits = 0;
	const apply = (command: AudioEditorCommand) => {
		commands.push(structuredClone(command));
		project = applyEditorCommand(project, command, { now: NOW });
		return project;
	};
	const service = createTimelineAnnotationService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => project,
		editingBlocked: () => options.editingBlocked === true,
		createId: () => ids.shift() ?? `annotation-${String(commands.length + 1)}`,
		getPositionFrames: () => options.positionFrame ?? 0,
		commit: (command) => {
			commits += 1;
			return apply(command);
		},
		updateSelection: apply,
		publishProjectState: () => undefined,
	});
	return {
		commands,
		commitCount: () => commits,
		project: () => project,
		service,
		state,
	};
}

function annotationFixture(): readonly TimelineAnnotationV11[] {
	return [
		sampleMarker('sample-marker', 24_000),
		musicalMarker('musical-marker', { num: 2, den: 1 }),
		sampleRegion('sample-region', 6_000, 12_000),
		musicalRegion('musical-region', { num: 2, den: 1 }, { num: 3, den: 1 }),
	];
}

function common(id: string, name = id, sequenceId = 'main-sequence') {
	return {
		id,
		sequenceId,
		name,
		color: 'auto' as const,
		batchId: null,
		opaqueExtensions: {},
	};
}

function sampleMarker(id: string, positionFrame: number, sequenceId = 'main-sequence'): TimelineAnnotationV11 {
	return { ...common(id, id, sequenceId), kind: 'marker', anchor: 'sample', positionFrame };
}

function musicalMarker(
	id: string,
	positionBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
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

function annotation(project: TestProject, id: string): TimelineAnnotationV11 {
	const value = project.timelineAnnotations.find((candidate) => candidate.id === id);
	if (!value) throw new ReferenceError(`Missing annotation ${id}.`);
	return value;
}

function sampleAnnotation(
	project: TestProject,
	id: string,
): Extract<TimelineAnnotationV11, { kind: 'marker'; anchor: 'sample' }> {
	const value = annotation(project, id);
	if (value.kind !== 'marker' || value.anchor !== 'sample') throw new TypeError('Expected sample marker.');
	return value;
}

function musicalAnnotation(
	project: TestProject,
	id: string,
): Extract<TimelineAnnotationV11, { kind: 'marker'; anchor: 'musical' }> {
	const value = annotation(project, id);
	if (value.kind !== 'marker' || value.anchor !== 'musical') throw new TypeError('Expected musical marker.');
	return value;
}

function sampleRegionAnnotation(
	project: TestProject,
	id: string,
): Extract<TimelineAnnotationV11, { kind: 'region'; anchor: 'sample' }> {
	const value = annotation(project, id);
	if (value.kind !== 'region' || value.anchor !== 'sample') throw new TypeError('Expected sample region.');
	return value;
}
