/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	navigateTimelineAnnotation,
	nextTimelineAnnotation,
	previousTimelineAnnotation,
} from '../src/common/editor/timeline-annotation-navigation.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
} from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const project: RuntimeTimelineAnnotationProject = {
	sampleRate: 48_000,
	tempoMap: {
		mode: 'musical',
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	},
	sequences: [{ id: 'main' }, { id: 'secondary' }],
	timelineAnnotations: [
		marker('third', 'main', 30),
		marker('other', 'secondary', 15),
		marker('first', 'main', 10),
		marker('second', 'main', 20),
	],
};
const projected = resolveRuntimeTimelineAnnotationsProjection(project);

test('selected-ID navigation is sequence-scoped, ordered, and nonwrapping', () => {
	assert.equal(nextTimelineAnnotation(projected, { sequenceId: 'main', selectedAnnotationId: 'first' })?.id, 'second');
	assert.equal(previousTimelineAnnotation(projected, { sequenceId: 'main', selectedAnnotationId: 'third' })?.id, 'second');
	assert.equal(previousTimelineAnnotation(projected, { sequenceId: 'main', selectedAnnotationId: 'first' }), null);
	assert.equal(nextTimelineAnnotation(projected, { sequenceId: 'main', selectedAnnotationId: 'third' }), null);
	assert.throws(
		() => nextTimelineAnnotation(projected, { sequenceId: 'main', selectedAnnotationId: 'other' }),
		/selected annotation.*main/iu,
	);
});

test('playhead navigation includes the current start, stays sequence-scoped, and does not wrap', () => {
	assert.equal(previousTimelineAnnotation(projected, { sequenceId: 'main', playheadFrame: 20 })?.id, 'second');
	assert.equal(nextTimelineAnnotation(projected, { sequenceId: 'main', playheadFrame: 20 })?.id, 'second');
	assert.equal(previousTimelineAnnotation(projected, { sequenceId: 'main', playheadFrame: 0 }), null);
	assert.equal(nextTimelineAnnotation(projected, { sequenceId: 'main', playheadFrame: 40 }), null);
	assert.equal(nextTimelineAnnotation(projected, { sequenceId: 'secondary', playheadFrame: 0 })?.id, 'other');
	assert.equal(navigateTimelineAnnotation(projected, {
		sequenceId: 'main', direction: 'next', playheadFrame: 10,
	})?.id, 'first');
	assert.throws(
		() => navigateTimelineAnnotation(projected, { sequenceId: 'main', direction: 'next' }),
		/playheadFrame/iu,
	);
});

function marker(id: string, sequenceId: string, positionFrame: number): TimelineAnnotationV11 {
	return {
		id,
		sequenceId,
		name: id,
		color: 'auto',
		batchId: null,
		opaqueExtensions: {},
		kind: 'marker',
		anchor: 'sample',
		positionFrame,
	};
}
