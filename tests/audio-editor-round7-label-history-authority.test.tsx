/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const mutation of ['range', 'title'] as const) {
	test(`label draft observes native ${mutation} Undo without overwriting its authority`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
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
		const initial = createSoundscaperProject({ id: `label-history-${mutation}`, sampleRate: 48_000,
			tracks: [createLabelTrack({ id: 'labels', labels: [{ id: 'intro', title: 'Intro', startFrame: 12_000, endFrame: 36_000 }] })],
			sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' });
		let history = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(initial), {
			type: 'label/update', trackId: 'labels', labelId: 'intro',
			changes: mutation === 'range' ? { startFrame: 24_000, endFrame: 48_000 } : { title: 'Draft title' },
		});
		const readLabel = () => {
			const track = history.present.tracks.find(candidate => candidate.id === 'labels');
			assert.ok(track);
			const labels: unknown = Reflect.get(track, 'labels');
			assert.ok(Array.isArray(labels));
			const label: unknown = labels[0];
			assert.ok(label && typeof label === 'object' && 'id' in label && 'title' in label
				&& 'startFrame' in label && 'endFrame' in label);
			assert.equal(typeof label.id, 'string'); assert.equal(typeof label.title, 'string');
			assert.equal(typeof label.startFrame, 'number'); assert.equal(typeof label.endFrame, 'number');
			return { id: String(label.id), title: String(label.title), startFrame: Number(label.startFrame), endFrame: Number(label.endFrame) };
		};
		const updates: AudioEditorCommand[] = [];
		const controller = { getSnapshot: () => ({ project: history.present }), actions: {
			labels: { update(trackId: string, labelId: string, changes: Record<string, unknown>) {
				const command: AudioEditorCommand = { type: 'label/update', trackId, labelId, changes };
				history = executeSoundscaperProjectCommand(history, command); updates.push(command);
			} }, timeline: { selectTrack() {}, setExactSelection() {} }, edit: {},
		} };
		const root = createRoot(dom.container as unknown as Element);
		const render = async () => {
			const label = readLabel();
			await act(async () => { root.render(<AudacityLabelMarker controller={controller} trackId="labels"
				label={label} left={12 + label.startFrame / 48_000 * 100} trackHeight={100}
				pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }} selected editing={false}
				blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />); });
		};
		const dispatch = (type: string, fields: Readonly<Record<string, number>>) => {
			const event = Object.assign(new Event(type), fields);
			for (const listener of [...listeners.get(type) ?? []]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
		};
		try {
			await render();
			const marker = dom.one('[data-label-id]'), surface = dom.one('.label-marker__label-box');
			const mouse = { button: 0, clientX: 40, target: surface, currentTarget: marker, preventDefault() {}, stopPropagation() {} };
			await act(async () => {
				reactProps(marker).onMouseDownCapture(mouse); reactProps(surface).onMouseDown(mouse);
			});
			await act(async () => { dispatch('mousemove', { clientX: 52 }); });
			history = undoSoundscaperProjectCommand(history);
			await render();
			assert.equal(history.redoStack.length, 1);
			await act(async () => { dispatch('mousemove', { clientX: 80 }); dispatch('mouseup', { button: 0 }); });
			if (mutation === 'range') {
				assert.equal(updates.length, 0, 'the prior movement Undo retains its range authority');
				assert.equal(readLabel().startFrame, 12_000);
				assert.equal(history.redoStack.length, 1);
				history = redoSoundscaperProjectCommand(history);
				assert.equal(readLabel().startFrame, 24_000);
				await render();
				await act(async () => {
					reactProps(marker).onMouseDownCapture(mouse); reactProps(surface).onMouseDown(mouse);
				});
				await act(async () => { dispatch('mousemove', { clientX: 52 }); dispatch('mouseup', { button: 0 }); });
				assert.equal(updates.length, 1, 'a later ordinary gesture owns the restored current range');
				assert.equal(readLabel().startFrame, 29_760);
				history = undoSoundscaperProjectCommand(history);
				assert.equal(readLabel().startFrame, 24_000);
				history = redoSoundscaperProjectCommand(history);
				assert.equal(readLabel().startFrame, 29_760);
			} else {
				assert.equal(updates.length, 1, 'unrelated title Undo preserves the ordinary movement');
				assert.equal(readLabel().title, 'Intro'); assert.equal(readLabel().startFrame, 31_200);
				history = undoSoundscaperProjectCommand(history);
				assert.equal(readLabel().startFrame, 12_000);
				history = redoSoundscaperProjectCommand(history);
				assert.equal(readLabel().startFrame, 31_200);
			}
		} finally {
			await act(async () => { root.unmount(); });
			globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		}
	});
}
