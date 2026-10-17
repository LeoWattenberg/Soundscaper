/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { useTimelineViewportModel } from '../src/common/editor/ui/timeline/useTimelineViewportModel.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const scenario of [
	{ name: 'dense point labels', count: 9, fontSizePt: 9, height: 96, autoFit: false, expected: 234 },
	{ name: 'large text in fitted tracks', count: 3, fontSizePt: 48, height: 96, autoFit: true, expected: 334 },
	{ name: 'a taller manual track', count: 3, fontSizePt: 48, height: 500, autoFit: false, expected: 500 },
]) test(`label row height reserves every packed banner for ${scenario.name}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const labels = Array.from({ length: scenario.count }, (_, index) => ({
		id: `cue-${String(index)}`, title: `Cue ${String(index + 1)}`,
		startFrame: 24_000 + index * 480, endFrame: 24_000 + index * 480,
	}));
	const project = resolveRuntimeProjectProjection({
		id: 'label-heights', schemaVersion: 9, sampleRate: 48_000, sources: [], clips: [],
		tracks: [{ id: 'labels', type: 'label', height: scenario.height, labels },
			{ id: 'audio', type: 'audio', height: 96, clipIds: [] }],
	});
	const controller = {
		getTelemetrySnapshot: () => ({ transportState: 'stopped' }),
		subscribeTelemetry: () => () => undefined,
		actions: { timeline: { setViewportWidth: () => undefined } },
	};
	const state = {
		timelineSize: { width: 800, height: 600 }, timelineScrollSize: { width: 800, height: 600 },
		pendingPinchAnchorRef: { current: null }, scrollRef: { current: null },
		waveformCacheRef: { current: new Map() }, selectionPreview: null, trackResizePreview: null,
	};
	let labelHeight = 0, audioHeight = 0, totalTrackHeight = 0;
	function Harness({ scrollX }: Readonly<{ scrollX: number }>) {
		const model = useTimelineViewportModel({
			controller, snapshot: { project,
				preferences: { appearance: { labelTextSizePt: scenario.fontSizePt } },
				timeline: { autoFitTrackHeight: scenario.autoFit, pixelsPerSecond: 120 },
			}, runtimeProject: project, mobile: false, showArmControls: false,
			automationVisibleTrackIds: new Set(), state: { ...state, scrollX },
		});
		labelHeight = model.visualTrackHeight(project.tracks[0]);
		audioHeight = model.visualTrackHeight(project.tracks[1]);
		totalTrackHeight = model.totalTrackHeight;
		return null;
	}
	try {
		await act(async () => root.render(<Harness scrollX={0} />));
		assert.equal(labelHeight, scenario.expected, 'the last banner must fit inside its label lane');
		assert.equal(totalTrackHeight, labelHeight + audioHeight, 'timeline scrolling and following tracks use the grown height');
		await act(async () => root.render(<Harness scrollX={200} />));
		assert.equal(labelHeight, scenario.expected, 'horizontal scrolling keeps the track geometry stable');
		assert.equal(project.tracks[0]?.height, scenario.height, 'content fitting preserves the saved track height');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
