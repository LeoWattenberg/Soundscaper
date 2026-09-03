/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SPLIT_TOOL_DOUBLE_SPLIT_DISTANCE_PIXELS,
	SPLIT_TOOL_ITEM_SNAP_TOLERANCE_PIXELS,
	resolveSplitToolGuidelineFrame,
	resolveTimelineToolPrecedence,
	splitToolGuidelineDistancePixels,
	splitToolTargetTrackIds,
	splitToolTrackHasClipAt,
} from '../src/common/editor/ui/timeline/timeline-tool-precedence.ts';

test('momentary or persistent Split Tool suppresses competing timeline tools and overlays', () => {
	assert.deepEqual(resolveTimelineToolPrecedence({
		splitToolActive: true,
		automationToolEnabled: true,
		spectralBrushEnabled: true,
	}), {
		automationToolEnabled: false,
		spectralBrushEnabled: false,
		showAutomationOverlay: false,
	});

	assert.deepEqual(resolveTimelineToolPrecedence({
		splitToolActive: false,
		automationToolEnabled: true,
		spectralBrushEnabled: true,
	}), {
		automationToolEnabled: true,
		spectralBrushEnabled: true,
		showAutomationOverlay: true,
	});
});

test('each Split action resolves its own current Shift modifier', () => {
	const tracks = [
		{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
		{ id: 'track-b', type: 'audio', clipIds: [] },
		{ id: 'labels', type: 'label', clipIds: [] },
		{ id: 'output' },
	];
	assert.deepEqual(splitToolTargetTrackIds(tracks, 'track-a', false), ['track-a']);
	assert.deepEqual(splitToolTargetTrackIds(tracks, 'track-a', true), ['track-a', 'track-b']);
});

test('Split release targeting requires a clip beneath the current pointer', () => {
	const tracks = [
		{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
		{ id: 'track-b', type: 'audio', clipIds: [] },
		{ id: 'labels', type: 'label', clipIds: ['clip-a'] },
	];
	const clips = [{ id: 'clip-a', timelineStartFrame: 100, durationFrames: 200 }];
	assert.equal(splitToolTrackHasClipAt(tracks, clips, 'track-a', 250), true);
	assert.equal(splitToolTrackHasClipAt(tracks, clips, 'track-a', 400), false);
	assert.equal(splitToolTrackHasClipAt(tracks, clips, 'track-b', 250), false);
	assert.equal(splitToolTrackHasClipAt(tracks, clips, 'labels', 250), false);
});

test('Split guideline follows enabled project grid snapping', () => {
	const project = {
		sampleRate: 1_000,
		snap: { enabled: true, unit: 'centiseconds', mode: 'nearest' },
		tracks: [{ id: 'track-a', clipIds: ['clip-a'] }],
		clips: [{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 1_000 }],
	};
	assert.equal(resolveSplitToolGuidelineFrame({
		frame: 126,
		pixelsPerSecond: 1_000,
		project,
		sampleRate: 1_000,
	}), 130);
});

test('Split guideline snaps to clip and label edges within four pixels only when grid is disabled', () => {
	const project = {
		sampleRate: 1_000,
		snap: { enabled: false, unit: 'samples', mode: 'nearest' },
		timelineAnnotations: [{ timelineStartFrame: 400, timelineEndFrame: 425 }],
		tracks: [
			{ id: 'track-a', clipIds: ['clip-a'] },
			{ id: 'labels', labels: [{ id: 'label-a', startFrame: 300, endFrame: 325 }] },
		],
		clips: [{ id: 'clip-a', timelineStartFrame: 100, durationFrames: 100 }],
	};
	const guideline = (frame: number) => resolveSplitToolGuidelineFrame({
		frame,
		pixelsPerSecond: 1_000,
		project,
		sampleRate: 1_000,
	});
	assert.equal(SPLIT_TOOL_ITEM_SNAP_TOLERANCE_PIXELS, 4);
	assert.equal(guideline(96), 100, 'the exact four-pixel tolerance snaps');
	assert.equal(guideline(95), 95, 'outside the tolerance remains unsnapped');
	assert.equal(guideline(197), 200, 'clip ends participate in item snapping');
	assert.equal(guideline(297), 300, 'label boundaries participate in item snapping');
	assert.equal(guideline(396), 400, 'runtime annotation boundaries participate in item snapping');
});

test('Split double-split distance compares snapped guideline pixels at the exact threshold', () => {
	assert.equal(SPLIT_TOOL_DOUBLE_SPLIT_DISTANCE_PIXELS, 10);
	assert.equal(splitToolGuidelineDistancePixels(120, 129, 1_000, 1_000), 9);
	assert.equal(splitToolGuidelineDistancePixels(120, 130, 1_000, 1_000), 10);
});
