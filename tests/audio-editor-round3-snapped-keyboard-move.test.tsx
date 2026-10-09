/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioTrackRowNavigation } from '../src/common/editor/ui/timeline/useAudioTrackRowNavigation.js';
import { snapAudioEditorFrameWithProject } from '../src/common/editor/snap-grid.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { keyboardClipMoveFrame } from '../src/common/editor/keyboard-clip-move.ts';

test('snapped keyboard moves respect off-grid direction, rational video lines and the project start', () => {
	const seconds = { sampleRate: 48_000, snap: { enabled: true, unit: 'seconds' } };
	assert.equal(keyboardClipMoveFrame(seconds, 9_600, 4_800), 48_000);
	assert.equal(keyboardClipMoveFrame(seconds, 38_400, -4_800), 0);
	assert.equal(keyboardClipMoveFrame(seconds, 0, -4_800), 0);
	const video = { ...seconds, snap: { enabled: true, unit: 'video-ntsc' } };
	assert.equal(keyboardClipMoveFrame(video, 0, 4_800), 1_602);
	assert.equal(keyboardClipMoveFrame(video, 1_602, 4_800), 3_203);
	assert.equal(keyboardClipMoveFrame(video, 3_203, -4_800), 1_602);
});

for (const enabled of [true, false]) test(`horizontal keyboard moves ${enabled ? 'advance snapped cells' : 'retain the ordinary tenth-second increment'}`, async () => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const project = { sampleRate: 48_000, snap: { enabled, grid: 'seconds' }, tracks: [{ id: 'track', type: 'audio' }] };
	const clips = new Map([['clip', { id: 'clip', kind: 'audio', timelineStartFrame: 0 }]]);
	const controller = { actions: { clip: { move: (_id: string, _track: string, frame: number) => {
		clips.set('clip', { ...clips.get('clip')!, timelineStartFrame: snapAudioEditorFrameWithProject(frame, project) });
	} }, timeline: { selectClip() {} } } };
	const navigation: { current: ReturnType<typeof useAudioTrackRowNavigation> | null } = { current: null };
	function Probe() {
		navigation.current = useAudioTrackRowNavigation({ controller, project, track: project.tracks[0], trackWindowRef: { current: null },
			projectedClips: [], clipLookup: clips, sourceLookup: new Map(), trackIndex: 0, trackCount: 1,
			isFlatNavigation: false, trackBaseTabIndex: 0, sampleRate: 48_000, blocked: false, canonicalVideoTrim: false,
			run: (operation: () => unknown) => operation(), onFocusTimelineRuler: () => false, onFocusTrackContainer: () => false,
			onFocusTrackPanelControl: () => false, onFocusTrackClip: () => false, onFocusTrackRuler: () => false, onFocusSelectionToolbar: () => false });
		return null;
	}
	try {
		await act(async () => root.render(<Probe />)); assert.ok(navigation.current);
		navigation.current.moveClipBySeconds('clip', 0.1);
		assert.equal(clips.get('clip')!.timelineStartFrame, enabled ? 48_000 : 4_800);
		navigation.current.moveClipBySeconds('clip', 0.1);
		assert.equal(clips.get('clip')!.timelineStartFrame, enabled ? 96_000 : 9_600);
		navigation.current.moveClipBySeconds('clip', -0.1);
		assert.equal(clips.get('clip')!.timelineStartFrame, enabled ? 48_000 : 4_800);
	} finally { await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act; }
});
