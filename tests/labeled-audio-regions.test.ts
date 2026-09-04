/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	labeledAudioSpanRegions,
	mergeLabeledAudioRegions,
	selectLabeledAudioEditTrackIds,
	selectLabeledAudioRegions,
	selectLabeledAudioTargets,
} from '../src/common/editor/labeled-audio-regions.ts';

const label = (startFrame: number, endFrame: number, id = `label-${startFrame}`) => ({
	id, anchor: 'sample' as const, startFrame, endFrame, startBeat: null, endBeat: null,
});

const project = (labels: readonly ReturnType<typeof label>[], extra: readonly unknown[] = []) => ({
	tracks: [
		{ id: 'audio-1', type: 'audio', clipIds: ['clip-1'] },
		{ id: 'audio-2', type: 'audio', clipIds: [] },
		{ id: 'labels-1', type: 'label', labels },
		...extra,
	] as never,
});

test('only labels wholly inside the time selection become regions', () => {
	const regions = selectLabeledAudioRegions(
		project([label(100, 200), label(50, 150), label(400, 500), label(900, 1_100)]),
		{ startFrame: 80, endFrame: 1_000 },
	);
	assert.deepEqual(regions, [{ startFrame: 100, endFrame: 200 }, { startFrame: 400, endFrame: 500 }]);
});

test('a point selection or a missing project yields no regions', () => {
	assert.deepEqual(selectLabeledAudioRegions(project([label(0, 10)]), { startFrame: 5, endFrame: 5 }), []);
	assert.deepEqual(selectLabeledAudioRegions(null, { startFrame: 0, endFrame: 100 }), []);
	assert.deepEqual(selectLabeledAudioRegions(project([label(0, 10)]), null), []);
});

test('selecting label tracks narrows the labels that contribute', () => {
	const document = project([label(10, 20)], [
		{ id: 'labels-2', type: 'label', labels: [label(30, 40, 'other')] },
	]);
	assert.deepEqual(
		selectLabeledAudioRegions(document, { startFrame: 0, endFrame: 100 }),
		[{ startFrame: 10, endFrame: 20 }, { startFrame: 30, endFrame: 40 }],
	);
	assert.deepEqual(
		selectLabeledAudioRegions(document, { startFrame: 0, endFrame: 100 }, ['labels-2']),
		[{ startFrame: 30, endFrame: 40 }],
	);
	assert.deepEqual(
		selectLabeledAudioRegions(document, { startFrame: 0, endFrame: 100 }, ['audio-1']),
		[{ startFrame: 10, endFrame: 20 }, { startFrame: 30, endFrame: 40 }],
	);
});

test('overlapping regions merge while touching regions stay apart', () => {
	assert.deepEqual(
		mergeLabeledAudioRegions([
			{ startFrame: 0, endFrame: 100 },
			{ startFrame: 50, endFrame: 80 },
			{ startFrame: 90, endFrame: 150 },
			{ startFrame: 150, endFrame: 200 },
		]),
		[{ startFrame: 0, endFrame: 150 }, { startFrame: 150, endFrame: 200 }],
	);
});

test('point labels survive as zero-length regions and are dropped by span operations', () => {
	const regions = selectLabeledAudioRegions(
		project([label(100, 100), label(300, 400)]),
		{ startFrame: 0, endFrame: 1_000 },
	);
	assert.deepEqual(regions, [{ startFrame: 100, endFrame: 100 }, { startFrame: 300, endFrame: 400 }]);
	assert.deepEqual(labeledAudioSpanRegions(regions), [{ startFrame: 300, endFrame: 400 }]);
});

test('edited tracks are the selected media tracks, or every media track', () => {
	const document = project([label(0, 10)]);
	assert.deepEqual(selectLabeledAudioEditTrackIds(document), ['audio-1', 'audio-2']);
	assert.deepEqual(selectLabeledAudioEditTrackIds(document, ['audio-2']), ['audio-2']);
	assert.deepEqual(selectLabeledAudioEditTrackIds(document, ['labels-1']), ['audio-1', 'audio-2']);
});

test('targets resolve together and collapse to null when either half is empty', () => {
	const document = project([label(10, 20)]);
	assert.deepEqual(selectLabeledAudioTargets(document, { startFrame: 0, endFrame: 100 }), {
		regions: [{ startFrame: 10, endFrame: 20 }],
		trackIds: ['audio-1', 'audio-2'],
	});
	assert.equal(selectLabeledAudioTargets(document, { startFrame: 50, endFrame: 100 }), null);
	assert.equal(selectLabeledAudioTargets({ tracks: [] }, { startFrame: 0, endFrame: 100 }), null);
});
