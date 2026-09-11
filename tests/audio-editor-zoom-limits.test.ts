/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSelectionViewService,
	type SelectionViewServiceRuntime,
} from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import { applyAudacityZoomToggle } from '../src/common/editor/audacity-zoom-toggle-runtime.ts';
import { audioEditorZoomPresetPixelsPerSecond } from '../src/common/editor/editing-preferences.ts';

test('dynamic fit zoom reaches Audacity minimum independently of the minutes preset', () => {
	const state = {
		analysisProcessing: false,
		selectedTrackId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		showRms: false,
		showVerticalRulers: false,
		scrollViewToPlayhead: true,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		timelineViewportWidth: 960,
		pixelsPerSecond: 120,
	};
	const project = { id: 'long-project', tracks: [], clips: [] };
	const service = createSelectionViewService({
		DEFAULT_PIXELS_PER_SECOND: 120,
		MAX_PIXELS_PER_SECOND: 6_000_000,
		state,
		getProject: () => project,
		editorTimelineDurationFrames: () => 960_000_000,
		projectSampleRate: () => 1_000,
		synchronizeAutomaticSampleEditMode: () => undefined,
		engine: { getPositionFrames: () => 0 },
		updatePlayhead: () => undefined,
		publishDocumentSnapshot: () => undefined,
	} as unknown as SelectionViewServiceRuntime);

	assert.equal(service.setZoom(0.001, { allowBelowProjectFit: true }), 0.001);
	assert.equal(service.setZoom(0.0001, { allowBelowProjectFit: true }), 0.001);
	assert.equal(audioEditorZoomPresetPixelsPerSecond('minutes', {
		currentPixelsPerSecond: 120,
		sampleRate: 1_000,
		projectDurationFrames: 960_000_000,
		selection: null,
		viewportWidth: 960,
		defaultPixelsPerSecond: 120,
		maximumPixelsPerSecond: 6_000_000,
	}), 5 / 60);
});

test('zoom toggle anchors the viewport with the post-clamp zoom scale', () => {
	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const maximumPixelsPerSecond = 6_000_000;
	const applied = applyAudacityZoomToggle({
		getSnapshot: () => ({
			project: {
				sampleRate: 48_000,
				tracks: [],
				clips: [],
				selection: { startFrame: 100, endFrame: 101, trackIds: [], clipIds: [] },
			},
			preferences: { editing: {
				zoomTogglePreset1: 'zoom-default',
				zoomTogglePreset2: 'zoom-to-selection',
			} },
			timeline: { pixelsPerSecond: 120, viewportWidth: 960 },
		}),
		actions: { timeline: {
			setZoom: (requestedPixelsPerSecond: number) => Math.min(
				maximumPixelsPerSecond,
				requestedPixelsPerSecond,
			),
		} },
		}, {
			issue: (_type, payload) => {
				requests.push(payload);
			},
		}, null);

	assert.equal(applied, maximumPixelsPerSecond);
	assert.equal(requests[0]?.pixelsPerSecond, maximumPixelsPerSecond);
});
