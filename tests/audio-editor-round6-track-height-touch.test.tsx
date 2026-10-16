/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useTimelinePointerMove } from '../src/common/editor/ui/timeline/useTimelinePointerMove.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const mode of ['mouse', 'touch', 'pinch', 'selection'] as const) {
	void test(`header resize movement preserves ${mode} pointer ownership`, async () => {
		const dom = installReactTestDom();
		const globals = new Map<string, PropertyDescriptor | undefined>();
		const events = new EventTarget();
		for (const key of ['addEventListener', 'removeEventListener'] as const) {
			globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { configurable: true, value: events[key].bind(events) });
		}
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let preview: { trackId: string; height: number } | null = null;
		let zoomCalls = 0;
		const noOp = () => undefined;
		const session = { kind: mode === 'selection' ? 'selection' : 'track-resize', trackId: 'track',
			edge: 'bottom', startY: 400, originalVisualHeight: 264, originalHeight: 264,
			minimumHeight: 88, maximumHeight: 500, height: 264 };
		const touches = new Map<number, { x: number; y: number }>();
		if (mode !== 'mouse') touches.set(1, { x: 100, y: 400 });
		if (mode === 'pinch') touches.set(2, { x: 110, y: 400 });
		const event = { pointerId: 1, clientX: 100, clientY: 424, preventDefault: noOp,
			target: { closest: () => null } };
		let move: ((input: typeof event) => void) | null = null;
		function Harness() {
			move = useTimelinePointerMove({
				controller: { actions: { timeline: { setZoom: () => { zoomCalls++; return 120; } } } },
				snapshot: { capabilities: {} }, splitToolActive: false,
				state: { pointerSession: { current: session }, touchPointers: { current: touches },
					pinchSession: { current: mode === 'pinch' ? { distance: 10, pixelsPerSecond: 120,
						midpoint: 105, scrollLeft: 0 } : null }, pendingPinchAnchorRef: { current: null },
					scrollRef: { current: null }, setDraggingClipIds: noOp, setClipDragPreview: noOp,
					setTrackResizePreview: (value: typeof preview) => { preview = value; },
					setLoopPreview: noOp, setSelectionPreview: noOp },
				model: { project: { tracks: [], clips: [] }, panelWidth: 180, pixelsPerSecond: 120, sampleRate: 48_000 },
				hitTesting: { frameAtClientX: (x: number) => x, isOverOutputDock: () => false,
					isOverProjectBin: () => false, setProjectBinDropActive: noOp, trackAtClientY: () => null },
				menuActions: { run: (callback: () => unknown) => callback() },
			}).onPointerMove;
			return null;
		}
		try {
			await act(async () => root.render(<Harness />));
			await act(async () => { assert.ok(move); move(event); });
			if (mode === 'mouse' || mode === 'touch') {
				assert.deepEqual(preview, { trackId: 'track', height: 288 });
				assert.equal(session.height, 288);
			} else assert.equal(preview, null);
			assert.equal(zoomCalls, mode === 'pinch' ? 1 : 0);
		} finally {
			await act(async () => root.unmount());
			for (const [key, descriptor] of globals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
