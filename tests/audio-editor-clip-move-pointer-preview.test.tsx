/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';

import { NEW_AUDIO_TRACK_DROP_TARGET } from '../src/common/editor/ui/timeline/constants.ts';
import { useTimelinePointerMove } from '../src/common/editor/ui/timeline/useTimelinePointerMove.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const capturedSelection of [false, true]) {
	test(`new-track drag previews the whole ${capturedSelection ? 'captured selection' : 'group'} below existing tracks when its lower clip is grabbed`, async () => {
		const fixture = await mountMovePreview({ capturedSelection });
		try {
			await fixture.move(150, NEW_AUDIO_TRACK_DROP_TARGET);
			assert.deepEqual(fixture.preview(), {
				clipId: 'lower',
				trackId: `${NEW_AUDIO_TRACK_DROP_TARGET}-4`,
				timelineStartFrame: 250,
				createTrack: true,
				previews: [{
					clipId: 'lower', trackId: `${NEW_AUDIO_TRACK_DROP_TARGET}-4`, timelineStartFrame: 250,
				}, {
					clipId: 'upper', trackId: `${NEW_AUDIO_TRACK_DROP_TARGET}-3`, timelineStartFrame: 150,
				}],
			});
		} finally {
			await fixture.cleanup();
		}
	});
}

test('new-track preview preserves linked video/audio order when the audio companion is grabbed', async () => {
	const fixture = await mountMovePreview({ linkedAv: true });
	try {
		await fixture.move(150, NEW_AUDIO_TRACK_DROP_TARGET);
		assert.deepEqual(fixture.preview()?.previews.map(({ clipId, trackId }) => ({ clipId, trackId })), [{
			clipId: 'lower', trackId: `${NEW_AUDIO_TRACK_DROP_TARGET}-4`,
		}, {
			clipId: 'upper', trackId: `${NEW_AUDIO_TRACK_DROP_TARGET}-3`,
		}]);
	} finally {
		await fixture.cleanup();
	}
});

test('existing-track drag keeps the grabbed clip on the requested track and clamps the whole group', async () => {
	const fixture = await mountMovePreview();
	try {
		await fixture.move(150, 'track-c');
		assert.equal(fixture.preview()?.createTrack, false);
		assert.deepEqual(fixture.preview()?.previews.map(({ clipId, trackId }) => ({ clipId, trackId })), [{
			clipId: 'lower', trackId: 'track-c',
		}, {
			clipId: 'upper', trackId: 'track-b',
		}]);
	} finally {
		await fixture.cleanup();
	}
});

interface ClipPreview {
	readonly clipId: string;
	readonly trackId: string;
	readonly timelineStartFrame: number;
}

interface MovePreview extends ClipPreview {
	readonly createTrack: boolean;
	readonly previews: readonly ClipPreview[];
}

function pointerEvent(clientX: number) {
	return {
		pointerId: 7, clientX, clientY: 400, shiftKey: false,
		target: { closest: () => null }, preventDefault: () => undefined,
	};
}

async function mountMovePreview({ capturedSelection = false, linkedAv = false } = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const globalEvents = new EventTarget();
	const priorGlobals = new Map<string, PropertyDescriptor | undefined>();
	for (const key of ['addEventListener', 'removeEventListener'] as const) {
		priorGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value: globalEvents[key].bind(globalEvents) });
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let currentPreview: MovePreview | null = null;
	let onPointerMove: ((event: ReturnType<typeof pointerEvent>) => void) | null = null;
	let requestedTrackId = NEW_AUDIO_TRACK_DROP_TARGET;
	const noOp = () => undefined;
	const session = {
		kind: 'move', clipId: 'lower', trackId: 'track-b', startX: 100,
		clipIds: ['lower', 'upper'], preview: null as MovePreview | null,
		moveOptions: capturedSelection ? { clipIds: ['lower', 'upper'] } : {},
	};
	const project = {
		tracks: [
			{ id: 'track-a', type: linkedAv ? 'video' : 'audio', clipIds: ['upper'] },
			{ id: 'track-b', type: 'audio', clipIds: ['lower'] },
			{ id: 'track-c', type: 'audio', clipIds: [] },
		],
		clips: [{
			id: 'lower', kind: 'audio', timelineStartFrame: 200, durationFrames: 100,
			groupId: capturedSelection || linkedAv ? null : 'group', avLinkId: linkedAv ? 'link' : null,
		}, {
			id: 'upper', kind: linkedAv ? 'video' : 'audio', timelineStartFrame: 100, durationFrames: 100,
			groupId: capturedSelection || linkedAv ? null : 'group', avLinkId: linkedAv ? 'link' : null,
		}],
		// Ctrl pointer-down can remove the grabbed clip from selection after the
		// drag has captured its participants. Preview must still move both clips.
		selection: { startFrame: 0, endFrame: 0, clipIds: capturedSelection ? ['upper'] : ['lower'] },
	};
	function Harness() {
		const [preview, setClipDragPreview] = useState<MovePreview | null>(null);
		currentPreview = preview;
		onPointerMove = useTimelinePointerMove({
			controller: { actions: {} }, snapshot: { capabilities: {} }, splitToolActive: false,
			state: {
				pointerSession: { current: session }, touchPointers: { current: new Map() },
				pinchSession: { current: null }, pendingPinchAnchorRef: { current: null }, scrollRef: { current: null },
				setDraggingClipIds: noOp, setClipDragPreview, setTrackResizePreview: noOp,
				setLoopPreview: noOp, setSelectionPreview: noOp,
			},
			model: { project, projectIndex: { clipById: new Map() }, panelWidth: 180, pixelsPerSecond: 1_000, sampleRate: 1_000 },
			hitTesting: {
				frameAtClientX: (clientX: number) => clientX, isOverOutputDock: () => false,
				isOverProjectBin: () => false, setProjectBinDropActive: noOp, trackAtClientY: () => requestedTrackId,
			},
			menuActions: { run: (callback: () => unknown) => callback() },
		}).onPointerMove;
		return null;
	}
	await act(async () => root.render(<Harness />));
	return {
		preview: () => currentPreview,
		async move(clientX: number, trackId: string) {
			requestedTrackId = trackId;
			await act(async () => {
				assert.ok(onPointerMove, 'The pointer move hook must be mounted.');
				onPointerMove(pointerEvent(clientX));
			});
		},
		async cleanup() {
			await act(async () => root.unmount());
			for (const [key, descriptor] of priorGlobals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
