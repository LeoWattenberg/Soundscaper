/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { useAudioTrackRowViewModel } from '../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js';

void test('an unrelated drag keeps a dense row projection stable without rereading its clips', () => {
	let geometryReads = 0;
	const clips = Array.from({ length: 1_000 }, (_, ordinal) => ({ id: `clip-${ordinal}`, sourceId: 'source',
		get timelineStartFrame() { geometryReads += 1; return ordinal * 1_000; }, durationFrames: 100,
		sourceStartFrame: 0, sourceDurationFrames: 100, envelope: [],
	}));
	const track = { id: 'static', type: 'audio', color: 'blue' };
	const project = { id: 'project', sampleRate: 48_000, clips, sources: [], tracks: [track] };
	const controller = { actions: { clip: { update() {} }, timeline: {} }, getClipVisualData: () => null };
	const emptySet = new Set();
	const emptyMap = new Map();
	const observed: ReturnType<typeof useAudioTrackRowViewModel>[] = [];
	const clipLookup = new Map(clips.map(clip => [clip.id, clip]));
	let updateReads = 0;
	function Harness() {
		const [stage, setStage] = useState(0);
		geometryReads = 0;
		observed.push(useAudioTrackRowViewModel({ controller, project, track, trackClips: clips, clipLookup,
			sourceLookup: emptyMap, trackWindowRef: { current: null }, renderViewportStartFrame: 0,
			viewportDurationFrames: 100, viewModelRevision: project, pixelsPerSecond: 120, sampleRate: 48_000,
			selection: null, selectedClipId: null, selectedClipIdSet: emptySet, displayMode: 'waveform', showRms: false,
			recordingPreview: null, clipDragPreview: stage ? { clipId: 'other', trackId: 'other', timelineStartFrame: 10 } : null,
			projectBinDragPreview: null, waveformCache: emptyMap, draggingClipIds: emptySet,
			copy: {}, run: (operation: () => unknown) => operation(), blocked: false, automationToolEnabled: false,
		}));
		if (stage) updateReads = geometryReads;
		else setStage(1);
		return null;
	}
	renderToString(<Harness />);
	assert.equal(observed.length, 2);
	assert.equal(observed[0]!.projection, observed[1]!.projection);
	assert.equal(updateReads, 0, 'no offscreen/static geometry is revisited for another track drag');
});

void test('drag overlays add offscreen clips entering the window and remove clips leaving their track', () => {
	const clips = Array.from({ length: 1_000 }, (_, ordinal) => ({ id: `clip-${ordinal}`, sourceId: 'source',
		timelineStartFrame: ordinal * 1_000, durationFrames: 100, sourceStartFrame: 0,
		sourceDurationFrames: 100, envelope: [],
	}));
	const track = { id: 'track', type: 'audio', color: 'blue' };
	const project = { id: 'project', sampleRate: 48_000, clips, sources: [], tracks: [track] };
	const controller = { actions: { clip: { update() {} }, timeline: {} }, getClipVisualData: () => null };
	const emptySet = new Set();
	const emptyMap = new Map();
	const clipLookup = new Map(clips.map(clip => [clip.id, clip]));
	const visible: string[][] = [];
	function Harness() {
		const [stage, setStage] = useState(0);
		const clipDragPreview = stage === 1 ? { clipId: 'clip-999', trackId: 'track', timelineStartFrame: 50 }
			: stage === 2 ? { clipId: 'clip-0', trackId: 'other', timelineStartFrame: 50 } : null;
		const model = useAudioTrackRowViewModel({ controller, project, track, trackClips: clips, clipLookup,
			sourceLookup: emptyMap, trackWindowRef: { current: null }, renderViewportStartFrame: 0,
			viewportDurationFrames: 100, viewModelRevision: project, pixelsPerSecond: 120, sampleRate: 48_000,
			selection: null, selectedClipId: null, selectedClipIdSet: emptySet, displayMode: 'waveform', showRms: false,
			recordingPreview: null, clipDragPreview, projectBinDragPreview: null, waveformCache: emptyMap,
			draggingClipIds: emptySet, copy: {}, run: (operation: () => unknown) => operation(),
			blocked: false, automationToolEnabled: false,
		});
		visible.push(model.projection.clips.map((clip: { id: string }) => clip.id));
		if (stage < 2) setStage(stage + 1);
		return null;
	}
	renderToString(<Harness />);
	assert.deepEqual(visible, [['clip-0'], ['clip-0', 'clip-999'], []]);
});
