/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TIMELINE_ANNOTATION_COMMAND_TYPES,
	defineTimelineAnnotationCommandHandlers,
	type TimelineAnnotationCommand,
} from '../src/common/editor/commands/timeline-annotation.ts';
import {
	applyTimelineAnnotationCommand,
	createTimelineAnnotationRuntimeHandlers,
	type MutableTimelineAnnotationProject,
} from '../src/common/editor/commands/timeline-annotation-runtime.ts';
import {
	createTimelineAnnotationsV11,
	type TimelineAnnotationCollectionContext,
	type TimelineAnnotationV11,
} from '../src/common/editor/timeline-annotation.ts';

const CONTEXT: TimelineAnnotationCollectionContext = {
	sampleRate: 48_000,
	tempoMap: {
		mode: 'musical',
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	},
	sequenceIds: ['main', 'secondary'],
};

test('the standalone command domain is exhaustive and rejects malformed registries', () => {
	assert.deepEqual(TIMELINE_ANNOTATION_COMMAND_TYPES, [
		'timeline-annotation/add',
		'timeline-annotation/update-many',
		'timeline-annotation/move-many',
		'timeline-annotation/resize',
		'timeline-annotation/convert',
		'timeline-annotation/remove-many',
		'timeline-annotation/batch-set',
	]);
	const handlers = createTimelineAnnotationRuntimeHandlers();
	assert.equal(Object.isFrozen(handlers), true);
	assert.deepEqual(Object.keys(handlers), TIMELINE_ANNOTATION_COMMAND_TYPES);
	assert.throws(
		() => defineTimelineAnnotationCommandHandlers({} as never),
		/not exhaustive.*missing/iu,
	);
});

test('add and update-many preserve document order and update only names and colors', () => {
	const project = fixtureProject();
	apply(project, {
		type: 'timeline-annotation/add',
		annotation: marker('last', 'main', 99),
	});
	apply(project, {
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker', 'musical-region'],
		changes: { name: 'Shared name', color: 'violet' },
	});

	assert.deepEqual(project.timelineAnnotations.map(({ id }) => id), [
		'sample-marker', 'musical-marker', 'sample-region', 'musical-region', 'secondary-marker', 'last',
	]);
	for (const id of ['sample-marker', 'musical-region']) {
		const annotation = requireAnnotation(project, id);
		assert.equal(annotation.name, 'Shared name');
		assert.equal(annotation.color, 'violet');
	}
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker'],
		changes: { name: 'No', batchId: 'smuggled' },
	} as unknown as TimelineAnnotationCommand), /unsupported.*batchId/iu);
});

test('move-many applies one domain-specific sample and beat delta atomically', () => {
	const project = fixtureProject();
	apply(project, {
		type: 'timeline-annotation/move-many',
		annotationIds: ['sample-marker', 'musical-marker', 'sample-region', 'musical-region'],
		delta: { sampleFrames: 10, beats: { num: 1, den: 2 } },
	});

	assert.equal(requireVariant(project, 'sample-marker', 'marker', 'sample').positionFrame, 20);
	assert.deepEqual(requireVariant(project, 'musical-marker', 'marker', 'musical').positionBeat, { num: 3, den: 2 });
	assert.deepEqual(
		pick(requireVariant(project, 'sample-region', 'region', 'sample'), ['startFrame', 'endFrame']),
		{ startFrame: 30, endFrame: 50 },
	);
	assert.deepEqual(
		pick(requireVariant(project, 'musical-region', 'region', 'musical'), ['startBeat', 'endBeat']),
		{ startBeat: { num: 5, den: 2 }, endBeat: { num: 7, den: 2 } },
	);

	const before = structuredClone(project.timelineAnnotations);
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/move-many',
		annotationIds: ['sample-marker', 'sample-region'],
		delta: { sampleFrames: -100, beats: { num: 0, den: 1 } },
	}), /non-negative/iu);
	assert.deepEqual(project.timelineAnnotations, before);
});

test('resize matches its anchor while explicit conversion replaces kind and authoritative coordinates', () => {
	const project = fixtureProject();
	apply(project, {
		type: 'timeline-annotation/resize',
		annotationId: 'sample-region',
		edge: 'start',
		coordinate: { anchor: 'sample', frame: 15 },
	});
	assert.equal(requireVariant(project, 'sample-region', 'region', 'sample').startFrame, 15);

	apply(project, {
		type: 'timeline-annotation/convert',
		annotationId: 'sample-marker',
		coordinates: { kind: 'marker', anchor: 'musical', positionBeat: { num: 3, den: 2 } },
	});
	const convertedMarker = requireVariant(project, 'sample-marker', 'marker', 'musical');
	assert.deepEqual(convertedMarker.positionBeat, { num: 3, den: 2 });
	assert.equal(Object.hasOwn(convertedMarker, 'positionFrame'), false);

	apply(project, {
		type: 'timeline-annotation/convert',
		annotationId: 'musical-region',
		coordinates: { kind: 'region', anchor: 'sample', startFrame: 100, endFrame: 200 },
	});
	assert.deepEqual(
		pick(requireVariant(project, 'musical-region', 'region', 'sample'), ['startFrame', 'endFrame']),
		{ startFrame: 100, endFrame: 200 },
	);

	const before = structuredClone(project.timelineAnnotations);
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/resize',
		annotationId: 'musical-marker',
		edge: 'end',
		coordinate: { anchor: 'musical', beat: { num: 2, den: 1 } },
	}), /region/iu);
	assert.deepEqual(project.timelineAnnotations, before);

	apply(project, {
		type: 'timeline-annotation/convert',
		annotationId: 'sample-region',
		coordinates: { kind: 'marker', anchor: 'sample', positionFrame: 5 },
	});
	assert.equal(requireVariant(project, 'sample-region', 'marker', 'sample').positionFrame, 5);
	apply(project, {
		type: 'timeline-annotation/convert',
		annotationId: 'musical-marker',
		coordinates: {
			kind: 'region', anchor: 'musical',
			startBeat: { num: 4, den: 1 }, endBeat: { num: 5, den: 1 },
		},
	});
	assert.deepEqual(
		pick(requireVariant(project, 'musical-marker', 'region', 'musical'), ['startBeat', 'endBeat']),
		{ startBeat: { num: 4, den: 1 }, endBeat: { num: 5, den: 1 } },
	);

	const converted = structuredClone(project.timelineAnnotations);
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/convert',
		annotationId: 'sample-region',
		coordinates: { kind: 'region', anchor: 'sample', startFrame: 20, endFrame: 20 },
	}), /positive sample region/iu);
	assert.deepEqual(project.timelineAnnotations, converted);
});

test('batch-set and remove-many validate the complete collection before one commit', () => {
	const project = fixtureProject();
	apply(project, {
		type: 'timeline-annotation/batch-set',
		annotationIds: ['sample-marker', 'sample-region'],
		batchId: 'batch-a',
	});
	assert.equal(requireAnnotation(project, 'sample-marker').batchId, 'batch-a');
	assert.equal(requireAnnotation(project, 'sample-region').batchId, 'batch-a');

	const before = structuredClone(project.timelineAnnotations);
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/batch-set',
		annotationIds: ['musical-marker', 'secondary-marker'],
		batchId: 'batch-cross-sequence',
	}), /batch.*one sequence/iu);
	assert.deepEqual(project.timelineAnnotations, before);

	apply(project, {
		type: 'timeline-annotation/remove-many',
		annotationIds: ['sample-region', 'musical-region'],
	});
	assert.deepEqual(project.timelineAnnotations.map(({ id }) => id), [
		'sample-marker', 'musical-marker', 'secondary-marker',
	]);
	assert.throws(() => apply(project, {
		type: 'timeline-annotation/remove-many', annotationIds: ['missing'],
	}), /unknown timeline annotation.*missing/iu);
});

test('supplied validation context takes precedence and every failed multi-edit is atomic', () => {
	const project = fixtureProject();
	const before = structuredClone(project.timelineAnnotations);
	assert.throws(() => applyTimelineAnnotationCommand(project, {
		type: 'timeline-annotation/add', annotation: marker('invalid-owner', 'secondary', 1),
	}, { ...CONTEXT, sequenceIds: ['main'] }), /missing sequence secondary/iu);
	assert.deepEqual(project.timelineAnnotations, before);

	assert.throws(() => apply(project, {
		type: 'timeline-annotation/update-many',
		annotationIds: ['sample-marker', 'missing'],
		changes: { name: 'Must not partially apply' },
	}), /unknown timeline annotation.*missing/iu);
	assert.deepEqual(project.timelineAnnotations, before);
});

function apply(project: MutableTimelineAnnotationProject, command: TimelineAnnotationCommand): void {
	applyTimelineAnnotationCommand(project, command, CONTEXT);
}

function fixtureProject(): MutableTimelineAnnotationProject {
	return {
		sampleRate: CONTEXT.sampleRate,
		tempoMap: CONTEXT.tempoMap,
		sequences: [{ id: 'main' }, { id: 'secondary' }],
		timelineAnnotations: Array.from(structuredClone(createTimelineAnnotationsV11([
			marker('sample-marker', 'main', 10),
			musicalMarker('musical-marker', 'main', { num: 1, den: 1 }),
			region('sample-region', 'main', 20, 40),
			musicalRegion('musical-region', 'main', { num: 2, den: 1 }, { num: 3, den: 1 }),
			marker('secondary-marker', 'secondary', 50),
		], CONTEXT))),
	};
}

function common(id: string, sequenceId: string) {
	return { id, sequenceId, name: id, color: 'auto' as const, batchId: null, opaqueExtensions: {} };
}

function marker(id: string, sequenceId: string, positionFrame: number): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'marker', anchor: 'sample', positionFrame };
}

function musicalMarker(
	id: string,
	sequenceId: string,
	positionBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'marker', anchor: 'musical', positionBeat };
}

function region(id: string, sequenceId: string, startFrame: number, endFrame: number): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'sample', startFrame, endFrame };
}

function musicalRegion(
	id: string,
	sequenceId: string,
	startBeat: Readonly<{ num: number; den: number }>,
	endBeat: Readonly<{ num: number; den: number }>,
): TimelineAnnotationV11 {
	return { ...common(id, sequenceId), kind: 'region', anchor: 'musical', startBeat, endBeat };
}

function requireAnnotation(project: MutableTimelineAnnotationProject, id: string): TimelineAnnotationV11 {
	const annotation = project.timelineAnnotations.find((candidate) => candidate.id === id);
	if (!annotation) throw new ReferenceError(`Missing annotation fixture: ${id}.`);
	return annotation;
}

function requireVariant<
	Kind extends TimelineAnnotationV11['kind'],
	Anchor extends TimelineAnnotationV11['anchor'],
>(
	project: MutableTimelineAnnotationProject,
	id: string,
	kind: Kind,
	anchor: Anchor,
): Extract<TimelineAnnotationV11, { kind: Kind; anchor: Anchor }> {
	const annotation = requireAnnotation(project, id);
	if (annotation.kind !== kind || annotation.anchor !== anchor) {
		throw new TypeError(`Annotation ${id} has the wrong fixture variant.`);
	}
	return annotation as Extract<TimelineAnnotationV11, { kind: Kind; anchor: Anchor }>;
}

function pick<
	Value extends object,
	Key extends keyof Value,
>(value: Value, keys: readonly Key[]): Pick<Value, Key> {
	return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<Value, Key>;
}
