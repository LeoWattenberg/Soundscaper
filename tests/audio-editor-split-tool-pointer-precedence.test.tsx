/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useTimelinePointerStart } from '../src/common/editor/ui/timeline/useTimelinePointerStart.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('active Split Tool owns clip presses ahead of automation and sample-pencil tools', async () => {
	for (const competingTool of ['automation', 'sample-pencil'] as const) {
		const fixture = await mountPointerStart(competingTool);
		try {
			await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
			assert.deepEqual(fixture.splitCalls, [[120, ['track-a']]], competingTool);
			assert.equal(fixture.pointerSession.current?.kind, 'split', competingTool);
			assert.equal(fixture.pointerEvent.defaultPrevented, true, competingTool);
		} finally {
			await fixture.cleanup();
		}
	}
});

test('live Shift remains Split-all even when the activation shortcut is a shifted chord', async () => {
	const fixture = await mountPointerStart('none', { shiftKey: true });
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
		assert.deepEqual(fixture.splitCalls, [[120, ['track-a', 'track-b']]]);
	} finally {
		await fixture.cleanup();
	}
});

test('active Split Tool owns a blank splittable lane press for a possible release split', async () => {
	const fixture = await mountPointerStart('none', { overClip: false });
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
		assert.deepEqual(fixture.splitCalls, [], 'a blank press has no clip to split');
		assert.equal(fixture.pointerSession.current?.kind, 'split');
		assert.equal(fixture.pointerEvent.defaultPrevented, true);
	} finally {
		await fixture.cleanup();
	}
});

test('active Split Tool yields a label-track press to ordinary selection routing', async () => {
	const fixture = await mountPointerStart('none', { laneTrackType: 'label', overClip: false });
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
		assert.deepEqual(fixture.splitCalls, []);
		assert.equal(fixture.pointerSession.current?.kind, 'selection');
	} finally {
		await fixture.cleanup();
	}
});

test('active Split Tool yields an Alt-modified press to ordinary pointer routing', async () => {
	const fixture = await mountPointerStart('none', { altKey: true });
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
		assert.deepEqual(fixture.splitCalls, []);
		assert.equal(fixture.pointerSession.current?.kind, 'selection');
		assert.equal(fixture.pointerEvent.defaultPrevented, false);
	} finally {
		await fixture.cleanup();
	}
});

test('Split press stores and commits its snapped guideline frame', async () => {
	const fixture = await mountPointerStart('none', { annotationEdge: 124, rawFrame: 120 });
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent); });
		assert.deepEqual(fixture.splitCalls, [[124, ['track-a']]]);
		assert.equal(fixture.pointerSession.current?.startFrame, 124);
	} finally {
		await fixture.cleanup();
	}
});

async function mountPointerStart(
	competingTool: 'automation' | 'sample-pencil' | 'none',
	options: Readonly<{
		altKey?: boolean;
		annotationEdge?: number;
		laneTrackType?: 'audio' | 'label';
		overClip?: boolean;
		rawFrame?: number;
		shiftKey?: boolean;
	}> = {},
) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const splitCalls: Array<[number, string[]]> = [];
	const pointerSession: { current: { kind: string; startFrame?: number } | null } = { current: null };
	let onPointerDown: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	const project = {
		snap: { enabled: false, unit: 'samples', mode: 'nearest' },
		timelineAnnotations: options.annotationEdge === undefined ? [] : [{
			timelineStartFrame: options.annotationEdge,
			timelineEndFrame: options.annotationEdge,
		}],
		clips: [{
			id: 'clip-a',
			kind: 'audio',
			sourceId: 'source-a',
			timelineStartFrame: 0,
			durationFrames: 48_000,
			sourceDurationFrames: 48_000,
		}],
		sources: [{ id: 'source-a', channelCount: 1 }],
		tracks: [
			{ id: 'track-a', type: options.laneTrackType ?? 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', type: 'audio', clipIds: [] },
		],
	};

	function Harness() {
		onPointerDown = useTimelinePointerStart({
			controller: {
				actions: {
					edit: { splitAt: (frame: number, trackIds: string[]) => { splitCalls.push([frame, trackIds]); } },
					timeline: { selectClip: () => undefined, selectTrack: () => undefined },
				},
			},
			snapshot: {
				sampleEdit: competingTool === 'sample-pencil' ? { available: true, mode: 'pencil' } : null,
			},
			automationToolEnabled: competingTool === 'automation',
			showArmControls: false,
			automationVisibleTrackIds: new Set(),
			splitToolActive: true,
			mutationsBlocked: false,
			state: {
				pointerSession,
				touchPointers: { current: new Map() },
				pinchSession: { current: null },
				scrollRef: { current: null },
				setDraggingClipIds: () => undefined,
				setSelectionPreview: () => undefined,
			},
			model: {
				project,
				pixelsPerSecond: 48_000,
				sampleRate: 48_000,
				timelineView: 'waveform',
				visualTrackHeight: () => 100,
			},
			hitTesting: { frameAtClientX: () => options.rawFrame ?? 120 },
			menuActions: { run: (callback: () => unknown) => callback() },
		}).onPointerDown;
		return null;
	}

	await act(async () => root.render(<Harness />));
	return {
		splitCalls,
		pointerSession,
		pointerEvent: pointerEvent(options.shiftKey, options.overClip ?? true, options.altKey),
		onPointerDown: () => {
			assert.ok(onPointerDown);
			return onPointerDown;
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function pointerEvent(shiftKey = false, overClip = true, altKey = false) {
	const lane = {
		dataset: { trackId: 'track-a' },
		getBoundingClientRect: () => ({ top: 0, height: 100 }),
	};
	const clip = {
		dataset: { clipId: 'clip-a' },
		classList: { contains: () => false },
		getBoundingClientRect: () => ({ left: 0, right: 200 }),
	};
	let prevented = false;
	return {
		button: 0,
		pointerId: 7,
		pointerType: 'mouse',
		isPrimary: true,
		clientX: 100,
		clientY: 50,
		altKey,
		ctrlKey: false,
		metaKey: false,
		shiftKey,
		target: {
			closest: (selector: string) => {
				if (selector === '[data-clip-id]') return overClip ? clip : null;
				if (selector === '[data-track-lane]') return lane;
				return null;
			},
		},
		currentTarget: { setPointerCapture: () => undefined },
		get defaultPrevented() { return prevented; },
		preventDefault: () => { prevented = true; },
		stopPropagation: () => undefined,
	};
}
