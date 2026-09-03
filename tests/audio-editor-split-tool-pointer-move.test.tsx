/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';

import { SplitToolGuideline } from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';
import { useTimelinePointerMove } from '../src/common/editor/ui/timeline/useTimelinePointerMove.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('active Split Tool publishes its snapped hover guideline and follows live Shift state', async () => {
	const fixture = await mountPointerMove();
	try {
		await act(async () => fixture.onPointerMove(pointerEvent(120, false)));
		assert.deepEqual(fixture.guideline(), {
			frame: 124,
			allTracks: false,
			singleTop: 100,
			singleHeight: 80,
			allTop: 34,
			allHeight: 240,
		});

		await act(async () => fixture.dispatch('keydown', { key: 'Shift' }));
		assert.equal(fixture.guideline()?.allTracks, true, 'Shift expands the live line without pointer movement');
		await act(async () => fixture.dispatch('keyup', { key: 'Shift' }));
		assert.equal(fixture.guideline()?.allTracks, false);

		await act(async () => fixture.onPointerMove(pointerEvent(2_000, false)));
		assert.equal(fixture.guideline(), null, 'the line hides when the pointer is not over a clip');
	} finally {
		await fixture.cleanup();
	}
});

test('Split Tool reveals the current hover and Shift span when activated under a stationary pointer', async () => {
	const fixture = await mountPointerMove(false);
	try {
		await act(async () => fixture.onPointerMove(pointerEvent(120, false)));
		assert.equal(fixture.guideline(), null, 'inactive hover remains hidden');
		await act(async () => fixture.dispatch('keydown', { key: 'Shift' }));
		await fixture.setActive(true);
		assert.equal(fixture.guideline()?.frame, 124);
		assert.equal(fixture.guideline()?.allTracks, true);
	} finally {
		await fixture.cleanup();
	}
});

test('Split Tool keeps tracking the hovered lane after pointer capture retargets drag moves', async () => {
	const fixture = await mountPointerMove();
	try {
		fixture.startCapturedSplit();
		await act(async () => fixture.onPointerMove(capturedPointerEvent(240, 230)));
		assert.equal(fixture.guideline()?.frame, 240);
		assert.equal(fixture.guideline()?.singleTop, 180, 'the guideline follows the second hovered row');
	} finally {
		await fixture.cleanup();
	}
});

test('Split Tool resets an all-track span when blur loses the Shift keyup', async () => {
	const fixture = await mountPointerMove();
	try {
		await act(async () => fixture.onPointerMove(pointerEvent(120, true)));
		assert.equal(fixture.guideline()?.allTracks, true);
		await act(async () => fixture.dispatch('blur', {}));
		await fixture.setActive(false);
		await fixture.setActive(true);
		assert.equal(fixture.guideline()?.allTracks, false);
	} finally {
		await fixture.cleanup();
	}
});

test('Split Tool guideline renders its snapped frame over one track or the complete track list', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SplitToolGuideline
			guideline={{
				frame: 124,
				allTracks: false,
				singleTop: 100,
				singleHeight: 80,
				allTop: 34,
				allHeight: 240,
			}}
			panelWidth={180}
			pixelsPerSecond={1_000}
			sampleRate={1_000}
		/>));
		let line = dom.one('[data-split-tool-guideline]');
		let style = line.style as unknown as Readonly<{ left: string; top: string; height: string }>;
		assert.equal(line.getAttribute('data-split-tool-scope'), 'track');
		assert.equal(style.left, 'calc(316px + var(--timeline-render-origin-x, 0px))');
		assert.equal(style.top, '100px');
		assert.equal(style.height, '80px');

		await act(async () => root.render(<SplitToolGuideline
			guideline={{
				frame: 124,
				allTracks: true,
				singleTop: 100,
				singleHeight: 80,
				allTop: 34,
				allHeight: 240,
			}}
			panelWidth={180}
			pixelsPerSecond={1_000}
			sampleRate={1_000}
		/>));
		line = dom.one('[data-split-tool-guideline]');
		style = line.style as unknown as Readonly<{ left: string; top: string; height: string }>;
		assert.equal(line.getAttribute('data-split-tool-scope'), 'all-tracks');
		assert.equal(style.top, '34px');
		assert.equal(style.height, '240px');
	} finally {
		await act(async () => root.unmount());
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

interface Guideline {
	readonly frame: number;
	readonly allTracks: boolean;
	readonly singleTop: number;
	readonly singleHeight: number;
	readonly allTop: number;
	readonly allHeight: number;
}

async function mountPointerMove(initiallyActive = true) {
	const dom = installReactTestDom();
	const globalEvents = installGlobalEventTarget();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let currentGuideline: Guideline | null = null;
	let onPointerMove: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	const noOp = () => undefined;
	const pointerSession: { current: Record<string, unknown> | null } = { current: null };
	const inner = { getBoundingClientRect: () => ({ top: 10, height: 400 }) };
	const trackList = { getBoundingClientRect: () => ({ top: 44, height: 240 }) };
	const firstRow = { getBoundingClientRect: () => ({ top: 110, height: 80 }) };
	const secondRow = { getBoundingClientRect: () => ({ top: 190, height: 80 }) };
	const firstLane = timelineLane('track-a', firstRow);
	const secondLane = timelineLane('track-b', secondRow);
	const scrollRef = {
		current: {
			querySelector: (selector: string) => selector === '.audio-editor-timeline-inner' ? inner
				: selector === '[data-track-list]' ? trackList : null,
			querySelectorAll: (selector: string) => selector.includes('[data-track-lane]')
				? [firstLane, secondLane] : [],
		},
	};
	const project = {
		sampleRate: 1_000,
		snap: { enabled: false, unit: 'samples', mode: 'nearest' },
		timelineAnnotations: [{ timelineStartFrame: 124, timelineEndFrame: 124 }],
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
		],
		clips: [
			{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 1_000 },
			{ id: 'clip-b', timelineStartFrame: 0, durationFrames: 1_000 },
		],
		sources: [],
	};

	function Harness({ splitToolActive }: Readonly<{ splitToolActive: boolean }>) {
		const [guideline, setSplitToolGuideline] = useState<Guideline | null>(null);
		currentGuideline = guideline;
		onPointerMove = useTimelinePointerMove({
			controller: { actions: {} },
			snapshot: { capabilities: {} },
			splitToolActive,
			state: {
				pointerSession,
				touchPointers: { current: new Map() },
				pinchSession: { current: null },
				pendingPinchAnchorRef: { current: null },
				scrollRef,
				setDraggingClipIds: noOp,
				setClipDragPreview: noOp,
				setTrackResizePreview: noOp,
				setLoopPreview: noOp,
				setSelectionPreview: noOp,
				setSplitToolGuideline,
			},
			model: {
				project,
				projectIndex: { clipById: new Map() },
				panelWidth: 180,
				pixelsPerSecond: 1_000,
				sampleRate: 1_000,
			},
			hitTesting: {
				frameAtClientX: (clientX: number) => clientX,
				isOverOutputDock: () => false,
				isOverProjectBin: () => false,
				setProjectBinDropActive: noOp,
				trackAtClientY: () => 'track-a',
			},
			menuActions: { run: (callback: () => unknown) => callback() },
		}).onPointerMove;
		return null;
	}

	await act(async () => root.render(<Harness splitToolActive={initiallyActive} />));
	return {
		guideline: () => currentGuideline,
		onPointerMove: (event: ReturnType<typeof pointerEvent>) => {
			if (!onPointerMove) throw new Error('Pointer move hook did not mount.');
			onPointerMove(event);
		},
		dispatch: globalEvents.dispatch,
		startCapturedSplit: () => {
			pointerSession.current = { kind: 'split', lane: firstLane };
		},
		setActive: async (splitToolActive: boolean) => {
			await act(async () => root.render(<Harness splitToolActive={splitToolActive} />));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			globalEvents.restore();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function pointerEvent(clientX: number, shiftKey: boolean) {
	const row = { getBoundingClientRect: () => ({ top: 110, height: 80 }) };
	const lane = timelineLane('track-a', row);
	return {
		pointerId: 7,
		pointerType: 'mouse',
		clientX,
		clientY: 150,
		shiftKey,
		target: {
			closest: (selector: string) => selector.includes('[data-track-lane]') ? lane : null,
		},
		preventDefault: () => undefined,
	};
}

function capturedPointerEvent(clientX: number, clientY: number) {
	return {
		pointerId: 7,
		pointerType: 'mouse',
		clientX,
		clientY,
		shiftKey: false,
		target: { closest: () => null },
		preventDefault: () => undefined,
	};
}

function timelineLane(trackId: string, row: Readonly<{ getBoundingClientRect(): Readonly<{
	readonly top: number;
	readonly height: number;
}> }>) {
	return {
		dataset: { trackId },
		closest: (selector: string) => selector === '[data-track-row]' ? row : null,
		getBoundingClientRect: row.getBoundingClientRect,
	};
}

function installGlobalEventTarget() {
	const listeners = new Map<string, Set<(event: { key?: string; type: string }) => void>>();
	const addDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
	const removeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
	Object.defineProperty(globalThis, 'addEventListener', {
		configurable: true,
		value: (type: string, listener: (event: { key?: string; type: string }) => void) => {
			const entries = listeners.get(type) ?? new Set();
			entries.add(listener);
			listeners.set(type, entries);
		},
	});
	Object.defineProperty(globalThis, 'removeEventListener', {
		configurable: true,
		value: (type: string, listener: (event: { key?: string; type: string }) => void) => listeners.get(type)?.delete(listener),
	});
	return {
		dispatch(type: string, event: { key?: string }) {
			for (const listener of listeners.get(type) ?? []) listener({ ...event, type });
		},
		restore() {
			if (addDescriptor) Object.defineProperty(globalThis, 'addEventListener', addDescriptor);
			else Reflect.deleteProperty(globalThis, 'addEventListener');
			if (removeDescriptor) Object.defineProperty(globalThis, 'removeEventListener', removeDescriptor);
			else Reflect.deleteProperty(globalThis, 'removeEventListener');
		},
	};
}
