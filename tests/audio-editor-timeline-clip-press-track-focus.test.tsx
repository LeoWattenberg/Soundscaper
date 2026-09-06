/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useTimelinePointerStart } from '../src/common/editor/ui/timeline/useTimelinePointerStart.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a clip-body press moves the focused track onto the pressed clip', async () => {
	const fixture = await mountPointerStart();
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent()); });
		assert.deepEqual(fixture.selectTrackCalls, ['track-b']);
		assert.deepEqual(fixture.selectClipCalls, [[null, undefined]]);
		assert.equal(fixture.pointerSession.current?.kind, 'selection');
	} finally {
		await fixture.cleanup();
	}
});

test('a clip-body press focuses the pressed track before the range is drawn', async () => {
	const fixture = await mountPointerStart();
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent()); });
		assert.deepEqual(fixture.order, ['selectTrack', 'selectClip']);
	} finally {
		await fixture.cleanup();
	}
});

test('a clip-header press carries the focus through the clip selection itself', async () => {
	const fixture = await mountPointerStart();
	try {
		await act(async () => { fixture.onPointerDown()(fixture.pointerEvent({ overHeader: true })); });
		assert.deepEqual(fixture.selectTrackCalls, [], 'selectClip already focuses the clip’s track');
		assert.deepEqual(fixture.selectClipCalls, [['clip-b', undefined]]);
	} finally {
		await fixture.cleanup();
	}
});

async function mountPointerStart() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const selectTrackCalls: (string | null)[] = [];
	const selectClipCalls: [string | null, unknown][] = [];
	const order: string[] = [];
	const pointerSession: { current: { kind: string } | null } = { current: null };
	let onPointerDown: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	// Track A is focused while the press lands on track B's clip: the stale
	// focus is what used to leak into the next edit.
	const project = {
		snap: { enabled: false, unit: 'samples', mode: 'nearest' },
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: [] },
		clips: [{
			id: 'clip-b',
			kind: 'audio',
			sourceId: 'source-a',
			timelineStartFrame: 0,
			durationFrames: 48_000,
			sourceDurationFrames: 48_000,
		}],
		sources: [{ id: 'source-a', channelCount: 1 }],
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: [] },
			{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
		],
	};

	function Harness() {
		onPointerDown = useTimelinePointerStart({
			controller: {
				actions: {
					timeline: {
						selectTrack: (trackId: string | null) => {
							order.push('selectTrack');
							selectTrackCalls.push(trackId);
						},
						selectClip: (clipId: string | null, options?: unknown) => {
							order.push('selectClip');
							selectClipCalls.push([clipId, options]);
						},
					},
				},
			},
			snapshot: { sampleEdit: null },
			automationToolEnabled: false,
			showArmControls: false,
			automationVisibleTrackIds: new Set(),
			splitToolActive: false,
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
				pixelsPerSecond: 100,
				sampleRate: 48_000,
				timelineView: 'waveform',
				visualTrackHeight: () => 100,
			},
			hitTesting: { frameAtClientX: () => 4_800 },
			menuActions: { run: (callback: () => unknown) => callback() },
		}).onPointerDown;
		return null;
	}

	await act(async () => root.render(<Harness />));
	return {
		order,
		pointerSession,
		selectClipCalls,
		selectTrackCalls,
		pointerEvent,
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

function pointerEvent(options: Readonly<{ overHeader?: boolean }> = {}) {
	const lane = {
		dataset: { trackId: 'track-b' },
		querySelector: () => null,
		getBoundingClientRect: () => ({ top: 0, height: 100 }),
	};
	const clip = {
		dataset: { clipId: 'clip-b' },
		classList: { contains: () => false },
		getBoundingClientRect: () => ({ left: 0, right: 200 }),
	};
	const header = { classList: { contains: () => false } };
	return {
		button: 0,
		pointerId: 7,
		pointerType: 'mouse',
		isPrimary: true,
		// Centred in a 200px clip, so neither trim edge claims the press.
		clientX: 100,
		clientY: 50,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		target: {
			closest: (selector: string) => {
				if (selector === '[data-clip-id]') return clip;
				if (selector === '[data-track-lane]') return lane;
				if (selector === '.clip-display') return clip;
				if (selector === '.clip-header') return options.overHeader ? header : null;
				return null;
			},
		},
		currentTarget: { setPointerCapture: () => undefined },
		preventDefault: () => undefined,
		stopPropagation: () => undefined,
	};
}
