/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	consumeTimelineAnnotationRenameKey,
	createTimelineAnnotationUiModel,
	cycleTimelineAnnotationHitId,
	planTimelineAnnotationPointerGesture,
	resolveTimelineAnnotationFrameBlur,
	resolveTimelineAnnotationKeyboardIntent,
	resolveTimelineAnnotationPointerCompletion,
	timelineAnnotationCreationAnnouncement,
	timelineAnnotationConversionRequest,
	timelineAnnotationEditBounds,
	timelineAnnotationEditIds,
	timelineAnnotationHitIds,
	timelineAnnotationIsVisible,
	timelineAnnotationPointerDelta,
	timelineAnnotationPointerEdge,
	timelineAnnotationPointerSelectionIds,
	timelineAnnotationRegionWidth,
} from '../src/common/editor/ui/timeline/timeline-annotation-ui-model.ts';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

test('annotation UI model filters the primary sequence and preserves deterministic runtime order', () => {
	const model = createTimelineAnnotationUiModel({
		annotations: [
			marker('later', 48_000),
			region('foreign', 1_000, 2_000, 'secondary'),
			region('first', 24_000, 36_000),
		],
		primarySequenceId: 'main',
		selectedAnnotationIds: ['later', 'first'],
		focusedAnnotationId: 'first',
		sampleRate: 48_000,
		locale: 'en',
		secondsUnit: 's',
	});

	assert.deepEqual(model.rows.map(({ id }) => id), ['first', 'later']);
	assert.deepEqual(model.rows.map(({ selected }) => selected), [true, true]);
	assert.equal(model.rows[0]?.focused, true);
	assert.equal(model.rows[0]?.timingLabel, '0.500–0.750 s');
	assert.equal(model.rows[1]?.timingLabel, '1.000 s');
	assert.deepEqual(model.selectedIds, ['first', 'later']);
	assert.equal(Object.isFrozen(model), true);
	assert.equal(Object.isFrozen(model.rows), true);
});

test('annotation UI model rejects unresolved or invalid runtime geometry at its boundary', () => {
	const unresolved = { ...marker('bad', 12), coordinateDomain: 'samples' };
	assert.throws(() => createTimelineAnnotationUiModel({
		annotations: [unresolved as unknown as RuntimeTimelineAnnotationProjection],
		primarySequenceId: 'main', selectedAnnotationIds: [], focusedAnnotationId: null, sampleRate: 48_000,
		locale: 'en', secondsUnit: 's',
	}), /resolved-samples/u);
	assert.throws(() => createTimelineAnnotationUiModel({
		annotations: [{ ...region('bad', 12, 24), timelineEndFrame: 12, durationFrames: 0 }],
		primarySequenceId: 'main', selectedAnnotationIds: [], focusedAnnotationId: null, sampleRate: 48_000,
		locale: 'en', secondsUnit: 's',
	}), /positive duration/u);
	assert.throws(() => createTimelineAnnotationUiModel({
		annotations: [], primarySequenceId: 'main',
		selectedAnnotationIds: 'not-an-array' as unknown as readonly string[],
		focusedAnnotationId: null, sampleRate: 48_000, locale: 'en', secondsUnit: 's',
	}), /selected annotation IDs must be an array/iu);
	assert.throws(() => createTimelineAnnotationUiModel({
		annotations: [], primarySequenceId: 'main', selectedAnnotationIds: [],
		focusedAnnotationId: ' not-canonical ', sampleRate: 48_000, locale: 'en', secondsUnit: 's',
	}), /focused annotation ID/iu);
});

test('annotation UI timing labels use the requested locale and injected unit copy', () => {
	const model = createTimelineAnnotationUiModel({
		annotations: [region('first', 24_000, 36_000)],
		primarySequenceId: 'main', selectedAnnotationIds: [], focusedAnnotationId: null, sampleRate: 48_000,
		locale: 'de', secondsUnit: 'Sek.',
	});

	assert.equal(model.rows[0]?.timingLabel, '0,500–0,750 Sek.');
});

test('annotation creation feedback localizes kind, name, and resolved timeline location', () => {
	assert.equal(timelineAnnotationCreationAnnouncement(region('first', 24_000, 36_000), {
		sampleRate: 48_000,
		locale: 'en',
		secondsUnit: 's',
		unnamed: 'Unnamed annotation',
		marker: 'Marker',
		region: 'Region',
		template: 'Created {kind}: {name}, {timing}',
	}), 'Created Region: first, 0.500–0.750 s');
	assert.equal(timelineAnnotationCreationAnnouncement(marker('punkt', 24_000), {
		sampleRate: 48_000,
		locale: 'de',
		secondsUnit: 'Sek.',
		unnamed: 'Unbenannte Annotation',
		marker: 'Marker',
		region: 'Bereich',
		template: '{kind} erstellt: {name}, {timing}',
	}), 'Marker erstellt: punkt, 0,500 Sek.');
});

test('annotation keyboard intents keep move, resize, rename, remove, and list navigation distinct', () => {
	const item = region('region', 100, 200);
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowRight' }, 48_000), {
		type: 'move', deltaFrames: 1,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowLeft', ctrlKey: true }, 48_000), {
		type: 'move', deltaFrames: -100,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowRight', shiftKey: true }, 48_000), {
		type: 'resize', edge: 'end', frame: 201,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowLeft', shiftKey: true }, 48_000), {
		type: 'resize', edge: 'end', frame: 199,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowRight', shiftKey: true, altKey: true }, 48_000), {
		type: 'resize', edge: 'start', frame: 101,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, {
		key: 'ArrowRight', shiftKey: true, altKey: true, ctrlKey: true,
	}, 48_000), {
		type: 'resize', edge: 'start', frame: 199,
	});
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'Enter' }, 48_000), { type: 'rename' });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'Delete' }, 48_000), { type: 'remove' });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: ' ' }, 48_000), { type: 'toggle' });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowDown' }, 48_000), { type: 'focus', offset: 1 });
	assert.equal(resolveTimelineAnnotationKeyboardIntent(marker('marker', 1), { key: 'ArrowRight', shiftKey: true }, 48_000), null);
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(item, { key: 'ArrowLeft' }, 48_000, {
		minimumStartFrame: 0,
		maximumEndFrame: 200,
	}), { type: 'move', deltaFrames: 0 });
	assert.deepEqual(resolveTimelineAnnotationKeyboardIntent(marker('near-maximum', Number.MAX_SAFE_INTEGER - 2), {
		key: 'ArrowRight', ctrlKey: true,
	}, 48_000, {
		minimumStartFrame: Number.MAX_SAFE_INTEGER - 2,
		maximumEndFrame: Number.MAX_SAFE_INTEGER - 2,
	}), { type: 'move', deltaFrames: 2 });
});

test('rename editing contains shortcuts while only explicit completion restores row focus', () => {
	for (const key of ['Tab', 'ArrowLeft', 'Delete', 'm', 'r', 'b']) {
		const calls: string[] = [];
		const intent = consumeTimelineAnnotationRenameKey({
			key,
			stopPropagation: () => calls.push('stop'),
			preventDefault: () => calls.push('prevent'),
		});
		assert.equal(intent, null);
		assert.deepEqual(calls, ['stop']);
	}
	for (const [key, save] of [['Enter', true], ['Escape', false]] as const) {
		const calls: string[] = [];
		assert.deepEqual(consumeTimelineAnnotationRenameKey({
			key,
			stopPropagation: () => calls.push('stop'),
			preventDefault: () => calls.push('prevent'),
		}), { save, restoreFocus: true });
		assert.deepEqual(calls, ['stop', 'prevent']);
	}
});

test('annotation pointer, edit-set, and conversion helpers clamp and preserve UI intent', () => {
	assert.equal(timelineAnnotationPointerDelta(100, 125, 100, 48_000, 2_000), 12_000);
	assert.equal(timelineAnnotationPointerDelta(100, 50, 100, 48_000, 2_000), -2_000);
	assert.equal(
		timelineAnnotationPointerDelta(-Number.MAX_VALUE, Number.MAX_VALUE, 1, 48_000, 2_000, 10_000),
		Number.MAX_SAFE_INTEGER - 10_000,
	);
	assert.equal(
		timelineAnnotationPointerDelta(Number.MAX_VALUE, -Number.MAX_VALUE, 1, 48_000, 2_000, 10_000),
		-2_000,
	);
	assert.deepEqual(timelineAnnotationEditIds('a', ['b', 'a', 'c']), ['b', 'a', 'c']);
	assert.deepEqual(timelineAnnotationEditIds('a', ['b']), ['a']);
	assert.deepEqual(timelineAnnotationEditBounds('first', ['later', 'first'], [
		marker('later', 400), region('first', 100, 200),
	]), { ids: ['first', 'later'], minimumStartFrame: 100, maximumEndFrame: 400 });
	assert.deepEqual(timelineAnnotationPointerSelectionIds('a', ['b', 'a'], {}), ['a']);
	assert.deepEqual(timelineAnnotationPointerSelectionIds('c', ['b', 'a'], { additive: true }), ['b', 'a', 'c']);
	assert.deepEqual(timelineAnnotationPointerSelectionIds('a', ['b', 'a'], { toggle: true }), ['b']);
	assert.deepEqual(timelineAnnotationConversionRequest(marker('marker', 100), {
		kind: 'region', anchor: 'musical',
	}, 48_000), { kind: 'region', anchor: 'musical', regionEndFrame: 48_100 });
	assert.deepEqual(timelineAnnotationConversionRequest(region('region', 100, 200), {
		kind: 'marker', anchor: 'sample',
	}, 48_000), { kind: 'marker', anchor: 'sample' });
});

test('plain selected-group gestures preserve drag IDs and collapse only on click completion', () => {
	const plan = planTimelineAnnotationPointerGesture('a', ['a', 'b'], {});
	assert.deepEqual(plan, {
		annotationId: 'a', dragIds: ['a', 'b'], selectOnPointerDown: false, collapseOnClick: true,
	});
	assert.deepEqual(resolveTimelineAnnotationPointerCompletion(plan, 12), {
		type: 'move', ids: ['a', 'b'], deltaFrames: 12,
	});
	assert.deepEqual(resolveTimelineAnnotationPointerCompletion(plan, 0), { type: 'select', ids: ['a'] });
	assert.equal(resolveTimelineAnnotationPointerCompletion(plan, 12, true), null);

	const capIds = Array.from({ length: 4_096 }, (_, index) => `annotation-${index}`);
	const capPlan = planTimelineAnnotationPointerGesture('annotation-2048', capIds, {});
	const completion = resolveTimelineAnnotationPointerCompletion(capPlan, 1);
	assert.equal(completion?.type, 'move');
	assert.equal(completion?.ids.length, 4_096);
});

test('visual hit helpers retain both short-region edges, cull offscreen rows, and cycle overlaps', () => {
	assert.equal(timelineAnnotationRegionWidth(1, 1, 48_000), 16);
	assert.equal(
		timelineAnnotationRegionWidth(Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, 1),
		Number.MAX_SAFE_INTEGER,
	);
	assert.equal(timelineAnnotationPointerEdge('start'), 'start');
	assert.equal(timelineAnnotationPointerEdge('end'), 'end');
	assert.equal(timelineAnnotationPointerEdge('middle'), null);
	const overlapping = [region('first', 100, 101), region('second', 100, 200), marker('third', 100)];
	assert.deepEqual(timelineAnnotationHitIds(overlapping, 0.21, 100, 48_000, 0), ['third', 'first', 'second']);
	assert.equal(cycleTimelineAnnotationHitId(['first', 'second'], 'second', null), 'second');
	assert.equal(cycleTimelineAnnotationHitId(['first', 'second'], 'second', 'second'), 'first');
	assert.equal(cycleTimelineAnnotationHitId(['first', 'second'], 'second', 'first'), 'second');
	assert.equal(timelineAnnotationIsVisible(marker('visible', 48_000), 100, 48_000, 90, 20), true);
	assert.equal(timelineAnnotationIsVisible(marker('offscreen', 96_000), 100, 48_000, 0, 20), false);
});

test('overlap cycling resolves body rename and both resize edges to the same deterministic target', () => {
	const identical = [region('first', 100, 101), region('second', 100, 101)];
	const bodyHits = timelineAnnotationHitIds(identical, 1, 100, 48_000, 0);
	const startHits = timelineAnnotationHitIds(identical, 1, 100, 48_000, 0, 'start');
	const endHits = timelineAnnotationHitIds(identical, 15, 100, 48_000, 0, 'end');
	assert.deepEqual(bodyHits, ['first', 'second']);
	assert.deepEqual(startHits, bodyHits);
	assert.deepEqual(endHits, bodyHits);
	for (const hits of [bodyHits, startHits, endHits]) {
		const firstPointerTarget = cycleTimelineAnnotationHitId(hits, 'second', null);
		const secondPointerTarget = cycleTimelineAnnotationHitId(hits, 'second', firstPointerTarget);
		assert.equal(firstPointerTarget, 'second');
		assert.equal(secondPointerTarget, 'first');
	}
});

test('frame blur rejects blank, fractional, and bounded values while restoring canonical text', () => {
	for (const draft of ['', ' ', '10.5', '-1', '201', 'not-a-frame']) {
		assert.deepEqual(resolveTimelineAnnotationFrameBlur(draft, 100, 0, 200), {
			frame: null, restoredDraft: '100',
		});
	}
	assert.deepEqual(resolveTimelineAnnotationFrameBlur('125', 100, 0, 200), {
		frame: 125, restoredDraft: '100',
	});
	assert.deepEqual(resolveTimelineAnnotationFrameBlur('100', 100, 0, 200), {
		frame: null, restoredDraft: '100',
	});
});

function marker(
	id: string,
	positionFrame: number,
	sequenceId = 'main',
): RuntimeTimelineAnnotationProjection {
	return Object.freeze({
		id, sequenceId, name: id, color: 'auto', batchId: null, opaqueExtensions: {},
		kind: 'marker', anchor: 'sample', positionFrame,
		timelineStartFrame: positionFrame, timelineEndFrame: positionFrame,
		durationFrames: 0, coordinateDomain: 'resolved-samples',
	});
}

function region(
	id: string,
	startFrame: number,
	endFrame: number,
	sequenceId = 'main',
): RuntimeTimelineAnnotationProjection {
	return Object.freeze({
		id, sequenceId, name: id, color: 'blue', batchId: null, opaqueExtensions: {},
		kind: 'region', anchor: 'sample', startFrame, endFrame,
		timelineStartFrame: startFrame, timelineEndFrame: endFrame,
		durationFrames: endFrame - startFrame, coordinateDomain: 'resolved-samples',
	});
}
