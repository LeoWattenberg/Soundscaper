/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { resolveTimelineAnnotationKeyboardIntent } from '../src/common/editor/ui/timeline/timeline-annotation-ui-model.ts';

const region: RuntimeTimelineAnnotationProjection = {
	id: 'verse', sequenceId: 'main', name: 'Verse', color: 'auto', batchId: null,
	opaqueExtensions: {}, kind: 'region', anchor: 'sample', startFrame: 100, endFrame: 200,
	timelineStartFrame: 100, timelineEndFrame: 200, durationFrames: 100,
	coordinateDomain: 'resolved-samples',
};

for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
	test(`marker list editing releases ${modifier} project shortcuts`, () => {
		for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'F2', 'Delete', 'Backspace', ' ']) {
			assert.equal(resolveTimelineAnnotationKeyboardIntent(region, { key, [modifier]: true }, 48_000), null, key);
		}
	});
}

test('marker list editing respects an already handled event', () => {
	assert.equal(resolveTimelineAnnotationKeyboardIntent(region, { key: 'ArrowDown', defaultPrevented: true }, 48_000), null);
});

test('marker navigation retains plain focus and its authored move and resize chords', () => {
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(region, { key: 'ArrowDown' }, 48_000), { type: 'focus', offset: 1 });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(region, { key: 'ArrowLeft', ctrlKey: true }, 48_000), { type: 'move', deltaFrames: -100 });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(region, { key: 'ArrowRight', metaKey: true }, 48_000), { type: 'move', deltaFrames: 48_000 });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(region, { key: 'ArrowRight', shiftKey: true, altKey: true, ctrlKey: true }, 48_000), { type: 'resize', edge: 'start', frame: 199 });
});
