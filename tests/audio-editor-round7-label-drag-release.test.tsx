/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const control of ['label-box', 'left-ear', 'right-ear']) for (const button of [1, 2]) {
	test(`native label ${control} retains its primary draft after auxiliary release ${String(button)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const document = dom.container.ownerDocument as unknown as Document;
		const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (!listener) return;
			const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			entries.add(listener); listeners.set(type, entries);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (listener) listeners.get(type)?.delete(listener);
		};
		const label = { id: 'intro', title: 'Intro', startFrame: 12_000, endFrame: 36_000 };
		const initial = createSoundscaperProject({ id: `label-release-${control}-${String(button)}`, sampleRate: 48_000,
			tracks: [createLabelTrack({ id: 'labels', labels: [label] })],
			sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' });
		let history = createSoundscaperProjectHistory(initial);
		const updates: AudioEditorCommand[] = [];
		const controller = { getSnapshot: () => ({ project: history.present }), actions: {
			labels: { update(trackId: string, labelId: string, changes: Record<string, unknown>) {
				const command: AudioEditorCommand = { type: 'label/update', trackId, labelId, changes };
				history = executeSoundscaperProjectCommand(history, command); updates.push(command);
			} }, timeline: { selectTrack() {}, setExactSelection() {} }, edit: {},
		} };
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels"
				label={label} left={37} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000}
				laneRef={{ current: null }} selected editing={false} blocked={false} copy={ENGLISH_COPY}
				run={(operation: () => unknown) => operation()} onSelect={() => undefined}
				onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
			const marker = dom.one('[data-label-id]');
			const surface = dom.one(`.label-marker__${control}`);
			const mouse = { button: 0, clientX: 40, target: surface, currentTarget: marker,
				preventDefault() {}, stopPropagation() {} };
			await act(async () => {
				reactProps(marker).onMouseDownCapture?.(mouse);
				reactProps(surface).onMouseDown?.(mouse);
			});
			await act(async () => dispatch(listeners.get('mousemove'), { clientX: 52 } as MouseEvent));
			await act(async () => dispatch(listeners.get('mouseup'), { button } as MouseEvent));
			assert.equal(updates.length, 0);
			assert.equal(history.undoStack.length, 0);
			assert.deepEqual(history.present, initial);
			await act(async () => reactProps(marker).onFocus?.({ target: marker, currentTarget: marker }));
			await act(async () => dispatch(listeners.get('mousemove'), { clientX: 80 } as MouseEvent));
			await act(async () => dispatch(listeners.get('mouseup'), { button: 0 } as MouseEvent));
			assert.equal(updates.length, 1);
			assert.equal(history.undoStack.length, 1);
			if (control === 'label-box') assert.deepEqual(updates[0], { type: 'label/update', trackId: 'labels',
				labelId: 'intro', changes: { startFrame: 31_200, endFrame: 55_200 } });
		} finally {
			await act(async () => root.unmount());
			assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
			globals.React = priorReact;
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}

function dispatch(listeners: Iterable<EventListenerOrEventListenerObject> | undefined, event: Event): void {
	for (const listener of [...listeners ?? []]) {
		if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
	}
}
