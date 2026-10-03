/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { brandRuntimeProjectProjection, resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { useTimelineViewportModel } from '../src/common/editor/ui/timeline/useTimelineViewportModel.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('scroll and recording preview updates retain document duration without visiting every clip', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let durationReads = 0;
	const runtime = resolveRuntimeProjectProjection({
		id: 'duration-project', schemaVersion: 9, sampleRate: 1_000, tracks: [], sources: [],
		clips: Array.from({ length: 1_000 }, (_, index) => ({
			id: String(index), kind: 'audio', timelineStartFrame: index * 1_000,
			durationFrames: 500, sourceStartFrame: 0, sourceDurationFrames: 500,
		})),
	});
	const project = brandRuntimeProjectProjection({
		...runtime,
		clips: runtime.clips.map((clip) => ({
			...clip,
			get durationFrames() { durationReads += 1; return clip.durationFrames; },
		})),
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
	let durationFrames = 0;
	function Harness({ scrollX, recording = false, runtimeProject = project }: Readonly<{
		scrollX: number;
		recording?: boolean;
		runtimeProject?: typeof project;
	}>) {
		durationFrames = useTimelineViewportModel({
			controller, snapshot: {
				project: runtimeProject,
				recordingPreviews: recording ? [{ startFrame: 0, durationFrames: 3_000_000 }] : [],
			}, runtimeProject, mobile: false, showArmControls: false,
			automationVisibleTrackIds: new Set(), state: { ...state, scrollX },
		}).durationFrames;
		return null;
	}
	try {
		await act(async () => root.render(<Harness scrollX={0} />));
		assert.equal(durationFrames, 1_999_000);
		durationReads = 0;
		await act(async () => root.render(<Harness scrollX={100} />));
		assert.equal(durationReads, 0, 'exact scrolling must not reduce the whole clip array');
		await act(async () => root.render(<Harness scrollX={200} recording />));
		assert.equal(durationFrames, 3_000_000, 'live recording still extends the timeline immediately');
		assert.equal(durationReads, 0);
		const edited = brandRuntimeProjectProjection({ ...project, clips: project.clips.slice(0, 2) });
		await act(async () => root.render(<Harness scrollX={0} runtimeProject={edited} />));
		assert.equal(durationFrames, 30_000, 'new document geometry invalidates the cached duration');
		assert.ok(durationReads > 0);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
