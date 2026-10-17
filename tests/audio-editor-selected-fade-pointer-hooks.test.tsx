/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { useTimelinePointerStart } from '../src/common/editor/ui/timeline/useTimelinePointerStart.js';
import { useTimelinePointerMove } from '../src/common/editor/ui/timeline/useTimelinePointerMove.js';
import { useTimelinePointerFinish } from '../src/common/editor/ui/timeline/useTimelinePointerFinish.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Kind = 'length' | 'shape';
type Preview = { readonly previews: readonly { readonly clipId: string; readonly trackId: string; readonly fadeInFrames?: number; readonly fadeOutFrames?: number; readonly fadeInShape?: number }[] } | null;
type Pointer = ReturnType<typeof pointer>;

for (const kind of ['length', 'shape'] as const) {
	test(`selected ${kind} fade previews keep their pointer and commit one native undo across tracks`, async () => {
		const fixture = await mountTimeline(kind);
		try {
			fixture.start(fixture.event());
			const owning = fixture.session.current;
			assert.ok(owning);
			assert.equal(owning.kind, kind === 'length' ? 'fade' : 'fade-shape');
			assert.deepEqual(fixture.captures, [7]);
			assert.deepEqual(fixture.rootCaptures, [], 'capture stays on the handle so native clicks retain their target');
			assert.equal(fixture.ownsCapture(), true);
			fixture.start(fixture.event(8));
			assert.equal(fixture.session.current, owning, 'a second press cannot replace the captured group');
			fixture.move(fixture.event(7, true)); fixture.flushFrames();
			const draft = fixture.preview();
			assert.ok(draft);
			assert.deepEqual(draft.previews.map(({ clipId, trackId }) => [clipId, trackId]), [['long', 'one'], ['short', 'two']]);
			assert.equal(fixture.history().undoStack.length, 0, 'drafts never publish native history');
			assert.deepEqual(fixture.history().present.clips, fixture.initial.clips);
			fixture.move(fixture.event(8)); fixture.flushFrames();
			fixture.finish(fixture.event(8), true);
			assert.equal(fixture.preview(), draft, 'foreign movement and cancellation retain the owning draft');
			assert.equal(fixture.session.current, owning);
			fixture.finish(fixture.event(7, true));
			assert.equal(fixture.session.current, null);
			assert.equal(fixture.ownsCapture(), false);
			assert.deepEqual(fixture.releases, [7]);
			assert.equal(fixture.preview(), null);
			assert.equal(fixture.commands.length, 1);
			const command = fixture.commands[0];
			assert.equal(command?.type, 'batch');
			assert.ok(command?.type === 'batch');
			assert.equal(command.commands.length, 2);
			assert.equal(fixture.history().undoStack.length, 1);
			const clips = fixture.history().present.clips;
			if (kind === 'length') {
				assert.deepEqual(clips.map(clip => [clip.fadeInFrames, clip.fadeOutFrames]), [[67_200, 28_800], [48_000, 0]]);
			} else {
				assert.ok(Number(clips[0]?.fadeInShape) > 1);
				assert.equal(clips[0]?.fadeInShape, clips[1]?.fadeInShape);
				assert.deepEqual(clips.map(clip => clip.fadeInFrames), [9_600, 9_600]);
			}
			for (const preview of draft.previews) {
				const clip = clips.find(clip => clip.id === preview.clipId);
				for (const [field, value] of Object.entries(preview)) if (field !== 'clipId' && field !== 'trackId') {
					assert.equal((clip as unknown as Record<string, unknown>)[field], value, `native commit matches ${preview.clipId} ${field} draft`);
				}
			}
			const undone = undoSoundscaperProjectCommand(fixture.history());
			assert.deepEqual(undone.present.clips, fixture.initial.clips);
			assert.deepEqual(undone.present.selection, fixture.initial.selection);
			fixture.finish(fixture.event(7, true));
			assert.equal(fixture.commands.length, 1, 'late release cannot publish the batch twice');
		} finally { await fixture.cleanup(); }
	});

	for (const cancellation of ['Escape', 'pointercancel', 'lostpointercapture'] as const) {
		test(`${cancellation} cancels the captured ${kind} fades without a native edit`, async () => {
			const fixture = await mountTimeline(kind);
			try {
				fixture.start(fixture.event()); fixture.move(fixture.event(7, true)); fixture.flushFrames();
				assert.ok(fixture.preview());
				fixture.move(fixture.event(7, true));
				fixture.dispatch(cancellation);
				assert.equal(fixture.session.current, null);
				assert.equal(fixture.ownsCapture(), false);
				assert.deepEqual(fixture.releases, cancellation === 'lostpointercapture' ? [] : [7]);
				assert.equal(fixture.preview(), null);
				fixture.flushFrames();
				fixture.finish(fixture.event(7, true));
				assert.equal(fixture.preview(), null, 'queued animation frames cannot restore a cancelled group');
				assert.deepEqual(fixture.commands, []);
				assert.equal(fixture.history().undoStack.length, 0);
				assert.deepEqual(fixture.history().present.clips, fixture.initial.clips);
			} finally { await fixture.cleanup(); }
		});
	}

	test(`selection changes retain the originally captured ${kind} fade participants`, async () => {
		const fixture = await mountTimeline(kind);
		try {
			fixture.start(fixture.event());
			await fixture.edit({ type: 'selection/set', startFrame: 0, endFrame: 0, clipIds: [], trackIds: [] });
			const undoCount = fixture.history().undoStack.length;
			fixture.move(fixture.event(7, true)); fixture.flushFrames();
			assert.deepEqual(fixture.preview()?.previews.map(preview => preview.clipId), ['long', 'short']);
			fixture.finish(fixture.event(7, true));
			const command = fixture.commands[0];
			assert.ok(command?.type === 'batch');
			assert.equal(command.commands.length, 2);
			assert.equal(fixture.history().undoStack.length, undoCount + 1);
			assert.deepEqual(fixture.history().present.selection.clipIds, []);
		} finally { await fixture.cleanup(); }
	});

	test(`a stale companion prevents the entire captured ${kind} fade commit`, async () => {
		const fixture = await mountTimeline(kind);
		try {
			fixture.start(fixture.event()); fixture.move(fixture.event(7, true)); fixture.flushFrames();
			await fixture.edit({ type: 'clip/update', clipId: 'short', changes: { fadeOutFrames: 14_401 } });
			const updated = fixture.history();
			fixture.finish(fixture.event(7, true));
			assert.equal(fixture.session.current, null);
			assert.equal(fixture.preview(), null);
			assert.deepEqual(fixture.commands, []);
			assert.equal(fixture.history(), updated, 'no partial batch follows a concurrent companion edit');
		} finally { await fixture.cleanup(); }
	});

	test(`a locked selected companion refuses a ${kind} fade press before capture`, async () => {
		const fixture = await mountTimeline(kind, true);
		try {
			fixture.start(fixture.event());
			assert.equal(fixture.session.current, null);
			assert.deepEqual(fixture.captures, []);
			fixture.move(fixture.event(7, true)); fixture.flushFrames(); fixture.finish(fixture.event(7, true));
			assert.deepEqual(fixture.commands, []);
			assert.equal(fixture.history().undoStack.length, 0);
		} finally { await fixture.cleanup(); }
	});
}

async function mountTimeline(kind: Kind, locked = false) {
	const dom = installReactTestDom();
	const events = new EventTarget();
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
		requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
		cancelAnimationFrame: (id: number) => { frames.delete(id); }, IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const initial = createSoundscaperProject({ id: 'captured-selected-fades', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 384_000, sampleRate: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'long', sourceId: 'source', durationFrames: 96_000, fadeInFrames: 9_600, fadeOutFrames: 72_000, fadeInShape: 1 }),
			createAudioClip({ id: 'short', sourceId: 'source', timelineStartFrame: 240_000, durationFrames: 48_000, fadeInFrames: 9_600, fadeOutFrames: 14_400, fadeInShape: 1 })],
		tracks: [createAudioTrack({ id: 'one', clipIds: ['long'] }), createAudioTrack({ id: 'two', clipIds: ['short'], locked })],
		selection: { startFrame: 0, endFrame: 0, clipIds: ['long', 'short'], trackIds: ['one', 'two'] },
	});
	let history = createSoundscaperProjectHistory(initial);
	const commands: AudioEditorCommand[] = [];
	const captures: number[] = [];
	const rootCaptures: number[] = [];
	const releases: number[] = [];
	const ownedPointers = new Set<number>();
	const session: { current: Record<string, unknown> | null } = { current: null };
	const pointerMoveFlushRef = { current: null as ((cancelled?: boolean) => void) | null };
	let preview: Preview = null;
	let start = (_event: Pointer) => {};
	let move = (_event: Pointer) => {};
	let finish = (_event: Pointer, _cancelled = false) => {};
	const noop = () => undefined;
	const controller = { getTelemetrySnapshot: () => ({ positionFrame: 0 }), actions: { edit: { commit(command: AudioEditorCommand) {
		history = executeSoundscaperProjectCommand(history, command); commands.push(command);
	} } } };
	const state = { pointerSession: session, pointerMoveFlushRef, touchPointers: { current: new Map() }, pinchSession: { current: null },
		pendingPinchAnchorRef: { current: null }, scrollRef: { current: null }, setDraggingClipIds: noop,
		setClipDragPreview: (value: Preview) => { preview = value; }, setTrackResizePreview: noop, setLoopPreview: noop,
		setSelectionPreview: noop, setBoundarySnapGuideFrames: noop };
	const root = createRoot(dom.container as unknown as Element);
	function Harness() {
		const project = history.present;
		const projectIndex = { clipById: new Map(project.clips.map(clip => [clip.id, clip])), sourceById: new Map(project.sources.map(source => [source.id, source])) };
		const shared = { controller, snapshot: { capabilities: {} }, splitToolActive: false, mutationsBlocked: false, state,
			model: { project, projectIndex, panelWidth: 180, pixelsPerSecond: 100, sampleRate: 48_000, timelineView: 'waveform', visualTrackHeight: () => 100, transportState: 'stopped' },
			hitTesting: { frameAtClientX: (x: number) => x * 480, trackAtClientY: () => 'one', isOverOutputDock: () => false, isOverProjectBin: () => false, setProjectBinDropActive: noop },
			menuActions: { run: (operation: () => unknown) => operation() } };
		start = useTimelinePointerStart({ ...shared, automationToolEnabled: false, showArmControls: false, automationVisibleTrackIds: new Set() }).onPointerDown;
		move = useTimelinePointerMove(shared).onPointerMove;
		finish = useTimelinePointerFinish({ ...shared, onRevealProjectBin: noop }).finishPointerSession;
		return <div data-track-lane data-track-id="one"><div data-clip-id="long"><div className="audio-editor-clip-fade">
			<button data-clip-fade-handle="in" /><button data-clip-fade-shape-handle="in" data-fade-shape-base-gain={Math.SQRT1_2} data-fade-shape-start-gain={Math.SQRT1_2} />
		</div></div></div>;
	}
	const render = () => act(async () => { root.render(<Harness />); });
	await render();
	const control = dom.one(kind === 'length' ? '[data-clip-fade-handle]' : '[data-clip-fade-shape-handle]');
	Object.assign(control, {
		setPointerCapture: (id: number) => { captures.push(id); ownedPointers.add(id); },
		hasPointerCapture: (id: number) => ownedPointers.has(id),
		releasePointerCapture: (id: number) => { releases.push(id); ownedPointers.delete(id); },
	});
	Object.assign(dom.one('.audio-editor-clip-fade'), { getBoundingClientRect: () => ({ height: 100 }) });
	const currentTarget = { setPointerCapture: (id: number) => rootCaptures.push(id) };
	return { initial, commands, captures, rootCaptures, releases, ownsCapture: () => ownedPointers.has(7), session, history: () => history, preview: () => preview,
		event: (pointerId = 7, moved = false) => pointer(control, currentTarget, pointerId, moved),
		start: (event: Pointer) => start(event), move: (event: Pointer) => move(event), finish: (event: Pointer, cancelled = false) => finish(event, cancelled),
		flushFrames: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); },
		dispatch: (type: string) => {
			if (type === 'lostpointercapture') ownedPointers.delete(7);
			return events.dispatchEvent(Object.assign(new Event(type === 'Escape' ? 'keydown' : type), { key: type, pointerId: 7, pointerType: 'pen' }));
		},
		edit: async (command: AudioEditorCommand) => { history = executeSoundscaperProjectCommand(history, command); await render(); },
		cleanup: async () => {
			await act(async () => root.unmount());
			for (const [key, descriptor] of previous) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		},
	};
}

function pointer(target: unknown, currentTarget: unknown, pointerId: number, moved: boolean) {
	return { target, currentTarget, pointerId, pointerType: 'pen', button: 0, buttons: 1, isPrimary: true,
		clientX: moved ? 220 : 100, clientY: moved ? 120 : 100, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
		preventDefault() {}, stopPropagation() {},
	};
}
