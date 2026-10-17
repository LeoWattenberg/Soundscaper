/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { clipFixture, createHarness, projectFixture } from './helpers/project-bin-service-harness.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Project Bin pointer drop retains its captured clips after selection clears and Escape cancels', async () => {
	const fixture = await mountProjectBinDrop();
	try {
		fixture.startDrop();
		const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
		await act(async () => { fixture.events.dispatchEvent(escape); });
		assert.equal(escape.defaultPrevented, true);
		assert.equal(fixture.pointerSession.current, null);
		await act(async () => fixture.finish(7));
		assert.deepEqual(fixture.service.commits, [], 'release after Escape does not move either clip');

		fixture.startDrop();
		assert.deepEqual(fixture.service.project.selection?.clipIds, [], 'dragging already cleared the visible clip selection');
		await act(async () => fixture.finish(7));
		assert.deepEqual(fixture.service.commits, [{
			command: { type: 'project-bin/move-from-timeline', clipIds: ['first', 'second'] },
			selection: { selectClipId: null },
		}], 'the native service receives both ungrouped clips in one history command');
		assert.equal(fixture.revealCount(), 1);
	} finally {
		await fixture.cleanup();
	}
});

test('Project Bin drop ignores a foreign pointer and retains native edit admission', async () => {
	const fixture = await mountProjectBinDrop();
	try {
		fixture.startDrop();
		await act(async () => fixture.finish(8));
		assert.ok(fixture.pointerSession.current, 'a foreign release leaves the owned gesture active');
		assert.deepEqual(fixture.service.commits, []);
		fixture.setEditingBlocked(true);
		await act(async () => fixture.finish(7));
		assert.equal(fixture.pointerSession.current, null);
		assert.deepEqual(fixture.service.commits, [], 'the native editing lock still rejects the whole captured set');
	} finally {
		await fixture.cleanup();
	}
});

async function mountProjectBinDrop() {
	const dom = installReactTestDom();
	const events = new EventTarget();
	const eventDescriptors = new Map(['addEventListener', 'removeEventListener'].map((key) => [
		key, Object.getOwnPropertyDescriptor(globalThis, key),
	]));
	Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: events.addEventListener.bind(events) });
	Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: events.removeEventListener.bind(events) });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let editingBlocked = false;
	const project = projectFixture({
		clips: [
			clipFixture({ id: 'first' }),
			clipFixture({ id: 'second', timelineStartFrame: 2_000 }),
		],
		selectionClipIds: [],
	});
	const service = createHarness(project, { editingBlocked: () => editingBlocked });
	const pointerSession: { current: Record<string, unknown> | null } = { current: null };
	let finishPointerSession: ((event: { pointerId: number; clientX: number; clientY: number }) => void) | null = null;
	let reveals = 0;
	const noOp = () => undefined;

	function Harness() {
		finishPointerSession = useTimelinePointerFinish({
			controller: { actions: { projectBin: { moveFromTimeline: service.service.moveClipsToProjectBin } } },
			snapshot: { capabilities: {}, timeline: {} },
			splitToolActive: false,
			onRevealProjectBin: () => { reveals += 1; },
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
			model: {
				project, projectIndex: { sourceById: new Map(project.sources.map((source) => [source.id, source])) },
				pixelsPerSecond: 100, sampleRate: 48_000, transportState: 'stopped',
			},
			hitTesting: {
				frameAtClientX: (x: number) => x,
				isOverOutputDock: () => false,
				setProjectBinDropActive: noOp,
				trackAtClientY: () => 'track',
			},
			menuActions: { run: (operation: () => unknown) => operation() },
		}).finishPointerSession;
		return null;
	}

	await act(async () => root.render(<Harness />));
	return {
		events, service, pointerSession,
		revealCount: () => reveals,
		setEditingBlocked: (value: boolean) => { editingBlocked = value; },
		startDrop() {
			pointerSession.current = {
				kind: 'move', pointerId: 7, clipId: 'first', clipIds: ['first', 'second'],
				original: project.clips[0],
				startX: 100, startY: 100, dragStarted: true, projectBinDrop: true,
			};
		},
		finish(pointerId: number) {
			assert.ok(finishPointerSession, 'Pointer finish hook mounted.');
			finishPointerSession({ pointerId, clientX: 200, clientY: 100 });
		},
		async cleanup() {
			await act(async () => root.unmount());
			for (const [key, descriptor] of eventDescriptors) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
