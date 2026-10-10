/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const change of ['none', 'rename', 'delete', 'delete-and-undo'] as const) {
	test(`sample-pencil finish respects native ${change} during its held stroke`, async () => {
		const dom = installReactTestDom();
		const events = new EventTarget();
		const prior = new Map<string, PropertyDescriptor | undefined>();
		for (const [key, value] of Object.entries({ addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events), IS_REACT_ACT_ENVIRONMENT: true })) {
			prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		}
		const initial = createSoundscaperProject({ id: 'sample-stroke-retirement', sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 96,
				sampleRate: 48_000, channelCount: 1 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 96 })],
			sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main' });
		let history = createSoundscaperProjectHistory(initial);
		const calls: unknown[] = [];
		const session: { current: Record<string, unknown> | null } = { current: {
			kind: 'sample-pencil', clipId: 'clip', channel: 0, pointerId: 1,
			points: [{ frame: 32, value: .5 }],
		} };
		const noop = () => undefined;
		const state = { pointerSession: session, pointerMoveFlushRef: { current: null },
			scrollRef: { current: null }, touchPointers: { current: new Map() }, pinchSession: { current: null },
			setDraggingClipIds: noop, setClipDragPreview: noop, setTrackResizePreview: noop,
			setLoopPreview: noop, setSelectionPreview: noop, setBoundarySnapGuideFrames: noop };
		const controller = { actions: { sampleEdit: { pencil: (options: unknown) => { calls.push(options); } } } };
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
				history = executeSoundscaperProjectCommand(history, change.startsWith('delete')
					? { type: 'clip/remove', clipId: 'clip' }
					: { type: 'clip/update', clipId: 'clip', changes: { title: 'Renamed recording' } });
				await act(async () => { root.render(<Harness />); });
				if (change === 'delete-and-undo') {
					history = undoSoundscaperProjectCommand(history);
					await act(async () => { root.render(<Harness />); });
				}
			}
			assert.ok(finishRef.current);
			finishRef.current({ pointerId: 1, clientX: 32, clientY: 20 });
			assert.deepEqual(calls, change.startsWith('delete') ? [] : [{ clipId: 'clip', channel: 0,
				points: [{ frame: 32, value: .5 }] }]);
			assert.equal(session.current, null);
			if (change === 'delete-and-undo') assert.deepEqual(history.present.clips, initial.clips);
		} finally {
			await act(async () => { root.unmount(); });
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		}
	});
}
