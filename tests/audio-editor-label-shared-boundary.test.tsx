/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createEditorLabelActionGroup } from '../src/common/editor/controller/composition/label-action-group.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

for (const selected of [false, true]) test(`shared stalk moves both adjacent edges in one undo step (selected ${String(selected)})`, async () => {
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
	const before = { id: 'before', title: 'Before', startFrame: 0, endFrame: 48_000 };
	const after = { id: 'after', title: 'After', startFrame: 48_000, endFrame: 96_000 };
	const project = createSoundscaperProject({ id: 'shared-boundary', sampleRate: 48_000,
		tracks: [createLabelTrack({ id: 'labels', labels: [before, after] })],
		sequences: [{ id: 'main', trackIds: ['labels'] }], primarySequenceId: 'main' });
	let history = createSoundscaperProjectHistory(project);
	const commits: unknown[] = [];
	const previews: unknown[] = [];
	let selections = 0;
	const actions = createEditorLabelActionGroup({
		getTrack: () => { throw new Error('not needed'); },
		getLabelService: () => { throw new Error('not needed'); },
		commit(command) {
			commits.push(command);
			history = executeSoundscaperProjectCommand(history, command as AudioEditorCommand);
		},
	});
	const controller = { getSnapshot: () => ({ project: history.present }), actions: { labels: actions,
		timeline: { selectTrack() { selections++; }, setExactSelection() {} }, edit: {} } };
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels" label={after}
			left={112} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000}
			laneRef={{ current: { getBoundingClientRect: () => ({ left: 0 }) } }}
			layout={{ row: 0, width: 100, leftNeighbor: before }} onNeighborPreview={(value: unknown) => previews.push(value)}
			selected={selected} editing={false} blocked={false} copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} onSelect={() => undefined}
			onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
		const marker = dom.one('[data-label-id]');
		const stalk = dom.one('.label-marker__left-stalk');
		assert.equal(stalk.getAttribute('data-shared-boundary'), 'true');
		assert.equal(Boolean(dom.find('.label-marker__left-ear')), selected, 'selected ears allow unlinking one label');
		const event = { button: 0, clientX: 112, target: stalk, currentTarget: marker, preventDefault() {}, stopPropagation() {} };
		await act(async () => {
			reactProps(marker).onMouseDownCapture?.(event);
			reactProps(stalk).onMouseDown?.(event);
		});
		await act(async () => dispatch(listeners.get('mousemove'), { clientX: 162 } as MouseEvent));
		assert.equal(selections, 0, 'resizing does not select the label');
		assert.deepEqual(previews.at(-1), { ...before, endFrame: 72_000 });
		assert.equal(commits.length, 0, 'motion stays a draft');
		await act(async () => dispatch(listeners.get('mouseup'), { button: 0 } as MouseEvent));
		assert.equal(commits.length, 1);
		assert.equal(history.undoStack.length, 1);
		assert.deepEqual(history.present.tracks[0]?.type === 'label' ? history.present.tracks[0].labels.map(label => [label.startFrame, label.endFrame]) : [],
			[[0, 72_000], [72_000, 96_000]]);
		assert.deepEqual(history.undoStack[0]?.project ?? history.undoStack[0], project);
		assert.equal(previews.at(-1), null);
	} finally {
		await act(async () => root.unmount());
		assert.equal(listeners.get('mousemove')?.size ?? 0, 0);
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function dispatch(listeners: Iterable<EventListenerOrEventListenerObject> | undefined, event: Event): void {
	for (const listener of [...listeners ?? []]) {
		if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
	}
}
