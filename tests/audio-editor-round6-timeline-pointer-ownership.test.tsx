/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useTimelinePointerStart } from '../src/common/editor/ui/timeline/useTimelinePointerStart.js';
import { useTimelinePointerMove } from '../src/common/editor/ui/timeline/useTimelinePointerMove.js';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

void test('a clip press records its pointer identity and refuses a foreign press', async () => {
	const fixture = await mountTimeline();
	try {
		fixture.start(fixture.event(7, 'pen', 100));
		const original = fixture.session.current;
		assert.equal(original?.pointerId, 7);
		fixture.start(fixture.event(1, 'mouse', 110));
		assert.equal(fixture.session.current, original);
		assert.deepEqual(fixture.captures, [7]);
	} finally { await fixture.cleanup(); }
});

void test('a foreign pointer cannot replace the owning clip movement queued for a frame', async () => {
	const fixture = await mountTimeline();
	try {
		fixture.start(fixture.event(7, 'pen', 100));
		assert.ok(fixture.session.current);
		fixture.session.current.pointerId = 7;
		fixture.move(fixture.event(7, 'pen', 136));
		fixture.move(fixture.event(1, 'mouse', 180));
		fixture.flush.current?.();
		assert.equal(fixture.preview()?.timelineStartFrame, 36);
	} finally { await fixture.cleanup(); }
});

for (const cancelled of [false, true]) {
	void test(`foreign pointer ${cancelled ? 'cancellation' : 'release'} preserves an owning clip session`, async () => {
		const fixture = await mountTimeline();
		try {
			fixture.start(fixture.event(7, 'pen', 100));
			const original = fixture.session.current;
			assert.ok(original);
			original.pointerId = 7;
			fixture.move(fixture.event(7, 'pen', 136));
			fixture.finish(fixture.event(1, 'mouse', 110), cancelled);
			assert.equal(fixture.session.current, original);
			assert.deepEqual(fixture.commits, []);
			fixture.finish(fixture.event(7, 'pen', 136));
			assert.deepEqual(fixture.commits, [['clip', 'track', 36]]);
			assert.equal(fixture.session.current, null);
		} finally { await fixture.cleanup(); }
	});
}

void test('the owning pointer completes its movement and deliberate two-touch pinch cancels editing', async () => {
	const fixture = await mountTimeline();
	try {
		fixture.start(fixture.event(7, 'pen', 100));
		fixture.move(fixture.event(7, 'pen', 136));
		fixture.finish(fixture.event(7, 'pen', 136));
		assert.deepEqual(fixture.commits, [['clip', 'track', 36]]);
		fixture.start(fixture.event(11, 'touch', 100));
		assert.equal(fixture.session.current?.kind, 'move');
		fixture.start(fixture.event(12, 'touch', 110));
		assert.equal(fixture.session.current, null);
		assert.equal(fixture.touches.current.size, 2);
		assert.ok(fixture.pinch.current);
		fixture.finish(fixture.event(11, 'touch', 140));
		assert.equal(fixture.commits.length, 1);
	} finally { await fixture.cleanup(); }
});

async function mountTimeline() {
	const dom = installReactTestDom();
	const globals = new Map<string, PropertyDescriptor | undefined>();
	const events = new EventTarget();
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const globalValues = {
		addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events),
		requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
		cancelAnimationFrame: (id: number) => { frames.delete(id); },
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(globalValues)) {
		globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const noOp = () => undefined;
	const captures: number[] = [];
	const commits: Array<[string, string, number]> = [];
	const session: { current: Record<string, unknown> | null } = { current: null };
	const flush: { current: ((cancel?: boolean) => void) | null } = { current: null };
	const touches = { current: new Map<number, { x: number; y: number }>() };
	const pinch: { current: object | null } = { current: null };
	let preview: { timelineStartFrame?: number } | null = null;
	let start: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	let move: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	let finish: ((event: ReturnType<typeof pointerEvent>, cancelled?: boolean) => void) | null = null;
	const clip = { id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
		durationFrames: 48_000, sourceDurationFrames: 48_000 };
	const track = { id: 'track', type: 'audio', clipIds: ['clip'] };
	const source = { id: 'source', channelCount: 1, frameCount: 48_000 };
	const project = { clips: [clip], tracks: [track], sources: [source], timelineAnnotations: [],
		snap: { enabled: false, unit: 'samples', mode: 'nearest' }, selection: { clipIds: ['clip'] } };
	const state = {
		pointerSession: session, pointerMoveFlushRef: flush, touchPointers: touches, pinchSession: pinch,
		pendingPinchAnchorRef: { current: null }, scrollRef: { current: null },
		setDraggingClipIds: noOp,
		setClipDragPreview: (value: typeof preview | ((prior: typeof preview) => typeof preview)) => {
			preview = typeof value === 'function' ? value(preview) : value;
		},
		setTrackResizePreview: noOp, setLoopPreview: noOp, setSelectionPreview: noOp,
	};
	const model = { project, projectIndex: { clipById: new Map([['clip', clip]]),
		sourceById: new Map([['source', source]]), trackByClipId: new Map([['clip', track]]) },
		panelWidth: 180, pixelsPerSecond: 48_000, sampleRate: 48_000, timelineView: 'waveform',
		visualTrackHeight: () => 100, transportState: 'stopped' };
	const controller = { actions: { timeline: { selectClip: noOp, selectTrack: noOp }, clip: {
		move: (clipId: string, trackId: string, frame: number) => { commits.push([clipId, trackId, frame]); },
	} } };
	const hitTesting = { frameAtClientX: (x: number) => x, trackAtClientY: () => 'track',
		isOverOutputDock: () => false, isOverProjectBin: () => false, setProjectBinDropActive: noOp };
	const menuActions = { run: (callback: () => unknown) => callback() };
	function Harness() {
		const shared = { controller, snapshot: { capabilities: {} }, state, model, hitTesting,
			menuActions, splitToolActive: false };
		start = useTimelinePointerStart({ ...shared, automationToolEnabled: false,
			showArmControls: false, automationVisibleTrackIds: new Set(), mutationsBlocked: false }).onPointerDown;
		move = useTimelinePointerMove(shared).onPointerMove;
		finish = useTimelinePointerFinish({ ...shared, onRevealProjectBin: noOp }).finishPointerSession;
		return null;
	}
	await act(async () => root.render(<Harness />));
	return {
		session, flush, touches, pinch, captures, commits, preview: () => preview,
		event: (id: number, type: string, x: number) => pointerEvent(id, type, x, captures),
		start: (event: ReturnType<typeof pointerEvent>) => { assert.ok(start); start(event); },
		move: (event: ReturnType<typeof pointerEvent>) => { assert.ok(move); move(event); },
		finish: (event: ReturnType<typeof pointerEvent>, cancelled = false) => { assert.ok(finish); finish(event, cancelled); },
		cleanup: async () => {
			await act(async () => root.unmount());
			for (const [key, descriptor] of globals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		},
	};
}

function pointerEvent(pointerId: number, pointerType: string, clientX: number, captures: number[]) {
	const lane = { dataset: { trackId: 'track' } };
	const clip = { dataset: { clipId: 'clip' } };
	return { button: 0, pointerId, pointerType, clientX, clientY: 50, isPrimary: true,
		altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
		target: { closest: (selector: string) => {
			if (selector === '[data-clip-id]') return clip;
			if (selector === '[data-track-lane]') return lane;
			if (selector === '.clip-header') return {};
			return null;
		} }, currentTarget: { setPointerCapture: (id: number) => { captures.push(id); } },
		preventDefault() {}, stopPropagation() {},
	};
}
