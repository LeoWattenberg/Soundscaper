/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { crossfadeIntersection } from '../src/common/editor/ui/timeline/crossfade-visual-geometry.ts';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('crossfade pointer release ignores clicks and tremor but commits a real drag atomically', async () => {
	const initialOutShape = 0.37;
	const initialInShape = 3.41;
	const intersection = crossfadeIntersection(initialOutShape, initialInShape);
	const outgoing = {
		id: 'out', kind: 'audio', sourceId: 'out-source', timelineStartFrame: 0,
		durationFrames: 1_000, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		fadeOutShape: initialOutShape,
	};
	const incoming = {
		id: 'in', kind: 'audio', sourceId: 'in-source', timelineStartFrame: 500,
		durationFrames: 1_000, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		fadeInShape: initialInShape,
	};
	const fixture = await mountPointerFinish([outgoing, incoming]);
	const begin = () => {
		fixture.pointerSession.current = {
			kind: 'crossfade-shape', pointerId: 7, outgoingClipId: outgoing.id, incomingClipId: incoming.id,
			outgoingOriginal: { ...outgoing }, incomingOriginal: { ...incoming },
			initialOutShape, initialInShape,
			initialPosition: intersection.position, initialGain: intersection.gain,
			startX: 100, startY: 100, width: 240, height: 120, trackId: 'track',
		};
	};
	try {
		begin();
		await act(async () => fixture.finishPointerSession({ pointerId: 7, clientX: 100, clientY: 100 }));
		begin();
		await act(async () => fixture.finishPointerSession({ pointerId: 7, clientX: 100.5, clientY: 100.5 }));
		assert.equal(fixture.commits.length, 0, 'no meaningful movement creates no undo entry');

		begin();
		await act(async () => fixture.finishPointerSession({ pointerId: 7, clientX: 102, clientY: 100 }));
		assert.equal(fixture.commits.length, 1);
		const commit = fixture.commits[0];
		assert.ok(commit);
		assert.equal(commit.type, 'batch');
		assert.deepEqual(commit.commands.map((command: { type: string }) => command.type), [
			'clip/update', 'clip/update',
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('an Alt-started crossfade drag rolls both inner edges in one trim batch', async () => {
	const outgoing = {
		id: 'out', kind: 'audio', sourceId: 'out-source', timelineStartFrame: 0,
		durationFrames: 1_000, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		fadeOutShape: 1,
	};
	const incoming = {
		id: 'in', kind: 'audio', sourceId: 'in-source', timelineStartFrame: 500,
		durationFrames: 1_000, sourceStartFrame: 0, sourceDurationFrames: 1_000,
		fadeInShape: 1,
	};
	const fixture = await mountPointerFinish([outgoing, incoming]);
	fixture.pointerSession.current = {
		kind: 'crossfade-shape', rollMode: true, pointerId: 7,
		outgoingClipId: outgoing.id, incomingClipId: incoming.id,
		outgoingOriginal: { ...outgoing }, incomingOriginal: { ...incoming },
		initialOutShape: 1, initialInShape: 1,
		initialPosition: 0.5, initialGain: Math.SQRT1_2,
		startX: 100, startY: 100, width: 240, height: 120, trackId: 'track',
	};
	try {
		await act(async () => fixture.finishPointerSession({ pointerId: 7, clientX: 110, clientY: 140 }));
		assert.equal(fixture.commits.length, 1);
		assert.deepEqual(fixture.commits[0]?.commands.map(command => command.type), [
			'clip/trim', 'clip/trim',
		]);
		assert.equal(fixture.commits[0]?.commands[0]?.durationFrames, 1_100);
		assert.equal(fixture.commits[0]?.commands[1]?.timelineStartFrame, 600);
		assert.equal(fixture.commits[0]?.commands[1]?.durationFrames, 900);
	} finally {
		await fixture.cleanup();
	}
});

async function mountPointerFinish(clips: ReadonlyArray<Readonly<Record<string, unknown>>>) {
	const dom = installReactTestDom();
	const globalEvents = installGlobalEventTarget();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: Array<{
		type: string;
		commands: Array<{ type: string; timelineStartFrame?: number; durationFrames?: number }>;
	}> = [];
	const pointerSession: { current: Record<string, unknown> | null } = { current: null };
	let finishPointerSession: ((event: { pointerId: number; clientX: number; clientY: number }) => void) | null = null;
	const noOp = () => undefined;
	const project = {
		tracks: [{ id: 'track', type: 'audio', clipIds: ['out', 'in'] }],
		clips,
	};
	const projectIndex = {
		clipById: new Map(clips.map(clip => [String(clip.id), clip])),
		sourceById: new Map(clips.map(clip => [String(clip.sourceId), {
			id: String(clip.sourceId), frameCount: 4_000,
		}])),
		clipsByTrackId: new Map([['track', clips]]),
		trackByClipId: new Map(clips.map(clip => [String(clip.id), project.tracks[0]])),
	};

	function Harness() {
		finishPointerSession = useTimelinePointerFinish({
			controller: { actions: { edit: { commit: (command: typeof commits[number]) => { commits.push(command); } } } },
			snapshot: { capabilities: {}, timeline: {} },
			mutationsBlocked: false,
			splitToolActive: false,
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
			model: { project, projectIndex, pixelsPerSecond: 100, sampleRate: 1_000, transportState: 'stopped' },
			hitTesting: {
				frameAtClientX: (clientX: number) => clientX,
				isOverOutputDock: () => false,
				setProjectBinDropActive: noOp,
				trackAtClientY: () => 'track',
			},
			menuActions: { run: (callback: () => unknown) => callback() },
		}).finishPointerSession;
		return null;
	}

	await act(async () => root.render(<Harness />));
	return {
		commits,
		pointerSession,
		finishPointerSession: (event: { pointerId: number; clientX: number; clientY: number }) => {
			if (!finishPointerSession) throw new Error('Pointer finish hook did not mount.');
			return finishPointerSession(event);
		},
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
