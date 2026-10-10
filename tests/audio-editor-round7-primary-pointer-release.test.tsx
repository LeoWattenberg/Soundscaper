/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const cases = [
	{ name: 'primary releases with middle held', pointerType: 'mouse', pointerId: 1, button: 0, buttons: 4, complete: true },
	{ name: 'primary releases with right held', pointerType: 'mouse', pointerId: 1, button: 0, buttons: 2, complete: true },
	{ name: 'middle presses with primary held', pointerType: 'mouse', pointerId: 1, button: 1, buttons: 5, complete: false },
	{ name: 'right presses with primary held', pointerType: 'mouse', pointerId: 1, button: 2, buttons: 3, complete: false },
	{ name: 'foreign mouse releases', pointerType: 'mouse', pointerId: 2, button: 0, buttons: 4, complete: false },
	{ name: 'pen moves', pointerType: 'pen', pointerId: 1, button: 0, buttons: 0, complete: false },
	{ name: 'touch moves', pointerType: 'touch', pointerId: 1, button: 0, buttons: 0, complete: false },
	{ name: 'ordinary held movement', pointerType: 'mouse', pointerId: 1, button: -1, buttons: 1, complete: false },
] as const;

for (const scenario of cases) test(`native clip movement ownership: ${scenario.name}`, async () => {
	const dom = installReactTestDom();
	const events = new EventTarget();
	const prior = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events), IS_REACT_ACT_ENVIRONMENT: true })) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const initial = createSoundscaperProject({ id: 'primary-button-ownership', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 100, sampleRate: 48_000, channelCount: 1 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100 })],
		sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main' });
	let history = createSoundscaperProjectHistory(initial);
	const project = resolveRuntimeProjectProjection(history.present);
	const calls: AudioEditorCommand[] = [];
	const session: { current: Record<string, unknown> | null } = { current: {
		kind: 'move', clipId: 'clip', trackId: 'track', pointerId: 1, startX: 0, startY: 20,
		original: project.clips[0], preview: { trackId: 'track', timelineStartFrame: 24 },
	} };
	const noop = () => undefined;
	let flushed = 0;
	const state = { pointerSession: session, pointerMoveFlushRef: { current: () => { flushed++; } },
		scrollRef: { current: null }, touchPointers: { current: new Map() }, pinchSession: { current: null },
		setDraggingClipIds: noop, setClipDragPreview: noop, setTrackResizePreview: noop,
		setLoopPreview: noop, setSelectionPreview: noop, setBoundarySnapGuideFrames: noop };
	const controller = { actions: { clip: { move(clipId: string, trackId: string, timelineStartFrame: number) {
		const command: AudioEditorCommand = { type: 'clip/move', clipId, trackId, timelineStartFrame };
		history = executeSoundscaperProjectCommand(history, command); calls.push(command);
	} } } };
	const root = createRoot(dom.container as unknown as Element);
	function Harness() {
		useTimelinePointerFinish({ controller, snapshot: { capabilities: {} }, onRevealProjectBin: noop,
			mutationsBlocked: false, splitToolActive: false, state,
			model: { project, projectIndex: { sourceById: new Map(project.sources.map(source => [source.id, source])) },
				pixelsPerSecond: 48_000, sampleRate: 48_000, transportState: 'stopped' },
			hitTesting: { frameAtClientX: (x: number) => x, isOverOutputDock: () => false,
				setProjectBinDropActive: noop, trackAtClientY: () => 'track' },
			menuActions: { run: (operation: () => unknown) => operation() } });
		return null;
	}
	try {
		await act(async () => { root.render(<Harness />); });
		await act(async () => { events.dispatchEvent(Object.assign(new Event('pointermove'),
			{ ...scenario, clientX: 24, clientY: 20 })); });
		assert.equal(calls.length, scenario.complete ? 1 : 0);
		assert.equal(history.undoStack.length, scenario.complete ? 1 : 0);
		assert.equal(flushed, scenario.complete ? 1 : 0);
		assert.equal(session.current === null, scenario.complete);
		await act(async () => { events.dispatchEvent(Object.assign(new Event('pointerup'),
			{ pointerId: 1, clientX: 24, clientY: 20 })); });
		assert.equal(calls.length, 1);
		assert.equal(history.undoStack.length, 1);
		assert.equal(resolveRuntimeProjectProjection(history.present).clips[0]?.timelineStartFrame, 24);
	} finally {
		await act(async () => { root.unmount(); });
		for (const [key, descriptor] of prior) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
		dom.restore();
	}
});
