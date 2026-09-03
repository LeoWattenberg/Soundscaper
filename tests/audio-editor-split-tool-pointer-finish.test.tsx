/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Split Tool resolves Shift independently when a drag creates its release split', async () => {
	const fixture = await mountPointerFinish();
	try {
		for (const scenario of [
			{ name: 'Shift pressed after pointerdown', shiftKey: true, trackIds: ['track-a', 'track-b'] },
			{ name: 'Shift released after pointerdown', shiftKey: false, trackIds: ['track-b'] },
			{ name: 'Shift held by a custom activation chord', shiftKey: true, trackIds: ['track-a', 'track-b'] },
		] as const) {
			fixture.pointerSession.current = {
				kind: 'split',
				startFrame: 120,
				lane: {},
			};
			await act(async () => fixture.finishPointerSession({ clientX: 240, clientY: 150, shiftKey: scenario.shiftKey }));
			assert.deepEqual(fixture.splitCalls.at(-1), [240, scenario.trackIds], scenario.name);
		}
		const callCount = fixture.splitCalls.length;
		fixture.pointerSession.current = { kind: 'split', startFrame: 120, lane: {} };
		await act(async () => fixture.finishPointerSession({ clientX: 2_000, clientY: 150, shiftKey: false }));
		assert.equal(fixture.splitCalls.length, callCount, 'release over a gap does not create a second split');
	} finally {
		await fixture.cleanup();
	}
});

test('Split Tool release follows Audacity active-state and ten-pixel distance gates', async () => {
	const active = await mountPointerFinish();
	try {
		active.pointerSession.current = {
			kind: 'split', startFrame: 120, lane: {},
		};
		await act(async () => active.finishPointerSession({ clientX: 129, clientY: 150, shiftKey: false }));
		assert.deepEqual(active.splitCalls, [], 'a release less than ten pixels from the press does not split again');

		active.pointerSession.current = {
			kind: 'split', startFrame: 120, lane: {},
		};
		await act(async () => active.finishPointerSession({ clientX: 130, clientY: 150, shiftKey: false }));
		assert.deepEqual(active.splitCalls, [[130, ['track-b']]], 'ten pixels creates Audacity\'s second split');
	} finally {
		await active.cleanup();
	}

	const inactive = await mountPointerFinish({ splitToolActive: false });
	try {
		inactive.pointerSession.current = {
			kind: 'split', startFrame: 120, lane: {},
		};
		await act(async () => inactive.finishPointerSession({ clientX: 240, clientY: 150, shiftKey: false }));
		assert.deepEqual(inactive.splitCalls, [], 'deactivating Split Tool before release cancels its second split');
	} finally {
		await inactive.cleanup();
	}
});

test('a blank-lane Split press can make a release-only split over a clip', async () => {
	const fixture = await mountPointerFinish();
	try {
		fixture.pointerSession.current = { kind: 'split', startFrame: 50, lane: {} };
		await act(async () => fixture.finishPointerSession({ clientX: 120, clientY: 150, shiftKey: false }));
		assert.deepEqual(fixture.splitCalls, [[120, ['track-b']]]);
	} finally {
		await fixture.cleanup();
	}
});

test('Split release compares and commits the snapped guideline rather than raw pointer frame', async () => {
	const fixture = await mountPointerFinish({
		project: {
			sampleRate: 48_000,
			snap: { enabled: false, unit: 'samples', mode: 'nearest' },
			tracks: [
				{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
				{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
				{ id: 'output', type: 'output' },
			],
			clips: [
				{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 130 },
				{ id: 'clip-b', timelineStartFrame: 0, durationFrames: 1_000 },
			],
		},
	});
	try {
		fixture.pointerSession.current = { kind: 'split', startFrame: 120, lane: {} };
		await act(async () => fixture.finishPointerSession({ clientX: 126, clientY: 150, shiftKey: false }));
		assert.deepEqual(fixture.splitCalls, [[130, ['track-b']]], '126 snaps four pixels to 130 and reaches ten pixels');
	} finally {
		await fixture.cleanup();
	}
});

test('Split release hover hit uses the raw pointer while grid guideline supplies the split frame', async () => {
	const fixture = await mountPointerFinish({
		project: {
			sampleRate: 48_000,
			snap: { enabled: true, unit: 'milliseconds', mode: 'nearest' },
			tracks: [
				{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
				{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
			],
			clips: [
				{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 1_000 },
				{ id: 'clip-b', timelineStartFrame: 0, durationFrames: 127 },
			],
		},
	});
	try {
		fixture.pointerSession.current = { kind: 'split', startFrame: 96, lane: {} };
		await act(async () => fixture.finishPointerSession({ clientX: 126, clientY: 150, shiftKey: false }));
		assert.deepEqual(
			fixture.splitCalls,
			[[144, ['track-b']]],
			'raw 126 still hovers the clip even though its grid guideline is frame 144',
		);
	} finally {
		await fixture.cleanup();
	}
});

interface PointerFinishProject {
	readonly sampleRate?: number;
	readonly snap?: Readonly<Record<string, unknown>>;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
}

async function mountPointerFinish(options: Readonly<{
	project?: PointerFinishProject;
	splitToolActive?: boolean;
}> = {}) {
	const dom = installReactTestDom();
	const globalEvents = installGlobalEventTarget();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const splitCalls: Array<[number, string[]]> = [];
	const pointerSession: { current: Record<string, unknown> | null } = { current: null };
	let finishPointerSession: ((event: { clientX: number; clientY: number; shiftKey: boolean }) => void) | null = null;
	const noOp = () => undefined;
	const project = options.project ?? {
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
			{ id: 'output', type: 'output' },
		],
		clips: [
			{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 1_000 },
			{ id: 'clip-b', timelineStartFrame: 0, durationFrames: 1_000 },
		],
	};

	function Harness() {
		finishPointerSession = useTimelinePointerFinish({
			controller: { actions: { edit: { splitAt: (frame: number, trackIds: string[]) => splitCalls.push([frame, trackIds]) } } },
			snapshot: { capabilities: {}, timeline: {} },
			splitToolActive: options.splitToolActive ?? true,
			onRevealProjectBin: noOp,
			state: {
				pointerSession,
				touchPointers: { current: new Map() },
				pinchSession: { current: null },
				setDraggingClipIds: noOp,
				setClipDragPreview: noOp,
				setTrackResizePreview: noOp,
				setLoopPreview: noOp,
				setSelectionPreview: noOp,
			},
			model: { project, pixelsPerSecond: 48_000, sampleRate: 48_000, transportState: 'stopped' },
			hitTesting: {
				frameAtClientX: (clientX: number) => clientX,
				isOverOutputDock: () => false,
				setProjectBinDropActive: noOp,
				trackAtClientY: (clientY: number) => clientY >= 100 && clientY < 200 ? 'track-b' : 'track-a',
			},
			menuActions: { run: (callback: () => unknown) => callback() },
		}).finishPointerSession;
		return null;
	}

	await act(async () => root.render(<Harness />));
	return {
		finishPointerSession: (event: { clientX: number; clientY: number; shiftKey: boolean }) => {
			if (!finishPointerSession) throw new Error('Pointer finish hook did not mount.');
			return finishPointerSession(event);
		},
		pointerSession,
		splitCalls,
		cleanup: async () => {
			await act(async () => root.unmount());
			globalEvents.restore();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function installGlobalEventTarget() {
	const addDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
	const removeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
	Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => undefined });
	Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: () => undefined });
	return {
		restore() {
			if (addDescriptor) Object.defineProperty(globalThis, 'addEventListener', addDescriptor);
			else Reflect.deleteProperty(globalThis, 'addEventListener');
			if (removeDescriptor) Object.defineProperty(globalThis, 'removeEventListener', removeDescriptor);
			else Reflect.deleteProperty(globalThis, 'removeEventListener');
		},
	};
}
