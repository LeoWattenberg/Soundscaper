/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand, redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const change of ['none', 'rename', 'undo', 'undo-and-redo'] as const) {
	test(`track height finish respects native ${change} during its held resize`, async () => {
		const dom = installReactTestDom();
		const events = new EventTarget();
		const prior = new Map<string, PropertyDescriptor | undefined>();
		for (const [key, value] of Object.entries({ addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events), IS_REACT_ACT_ENVIRONMENT: true })) {
			prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		}
		const base = createSoundscaperProject({ id: 'track-resize-retirement', sampleRate: 48_000,
			tracks: [createAudioTrack({ id: 'first', height: 144 })],
			sequences: [{ id: 'main', trackIds: ['first'] }], primarySequenceId: 'main' });
		let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(base), {
			type: 'track/add', track: createAudioTrack({ id: 'track', height: 114 }),
		});
		const initial = history.present;
		const calls: unknown[] = [];
		const session: { current: Record<string, unknown> | null } = { current: {
			kind: 'track-resize', trackId: 'track', pointerId: 1,
			height: 138, originalHeight: 114, fittedHeights: { first: 144, track: 114 },
		} };
		const noop = () => undefined;
		const state = { pointerSession: session, pointerMoveFlushRef: { current: null },
			scrollRef: { current: null }, touchPointers: { current: new Map() }, pinchSession: { current: null },
			setDraggingClipIds: noop, setClipDragPreview: noop, setTrackResizePreview: noop,
			setLoopPreview: noop, setSelectionPreview: noop, setBoundarySnapGuideFrames: noop };
		const controller = { actions: { timeline: { resizeTrackHeight: (trackId: string, height: number, fittedHeights: unknown) => {
			calls.push({ trackId, height, fittedHeights });
			history = executeSoundscaperProjectCommand(history, { type: 'track/update', trackId, changes: { height } });
		} } } };
		const root = createRoot(dom.container as unknown as Element);
		const finishRef: { current: ((event: Readonly<{ pointerId: number; clientX: number; clientY: number }>) => void) | null } = { current: null };
		function Harness() {
			const project = resolveRuntimeProjectProjection(history.present);
			finishRef.current = useTimelinePointerFinish({ controller, snapshot: { capabilities: {} }, onRevealProjectBin: noop,
				mutationsBlocked: false, splitToolActive: false, state,
				model: { project, projectIndex: {}, pixelsPerSecond: 48_000, sampleRate: 48_000, transportState: 'stopped' },
				hitTesting: { frameAtClientX: (x: number) => x, isOverOutputDock: () => false,
					setProjectBinDropActive: noop, trackAtClientY: () => 'track' },
				menuActions: { run: (operation: () => unknown) => operation() },
			}).finishPointerSession;
			return null;
		}
		try {
			await act(async () => { root.render(<Harness />); });
			if (change !== 'none') {
				history = change.startsWith('undo') ? undoSoundscaperProjectCommand(history)
					: executeSoundscaperProjectCommand(history, { type: 'track/update', trackId: 'track', changes: { name: 'Renamed' } });
				await act(async () => { root.render(<Harness />); });
				if (change === 'undo-and-redo') {
					history = redoSoundscaperProjectCommand(history);
					await act(async () => { root.render(<Harness />); });
				}
			}
			assert.ok(finishRef.current);
			finishRef.current({ pointerId: 1, clientX: 32, clientY: 20 });
			assert.deepEqual(calls, change.startsWith('undo') ? [] : [{ trackId: 'track', height: 138,
				fittedHeights: { first: 144, track: 114 } }]);
			assert.equal(session.current, null);
			if (change === 'undo-and-redo') assert.deepEqual(history.present.tracks, initial.tracks);

		} finally {
			await act(async () => { root.unmount(); });
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		}
	});
}
