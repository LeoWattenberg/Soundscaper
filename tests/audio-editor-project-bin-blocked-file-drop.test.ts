/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useProjectBinFileDrop } from '../src/common/editor/ui/workspace/use-project-bin-file-drop.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

// A stand-in for the drag events the browser delivers to the bin. The browser
// only treats an element as a drop target when a handler cancels the event, so
// the recorded `defaultPrevented` is exactly what decides whether the tab
// navigates to the dropped file instead of importing it.
function dragEvent(options: { types?: readonly string[]; files?: readonly unknown[] } = {}) {
	const removedAttributes: string[] = [];
	return {
		dataTransfer: {
			types: options.types ?? ['Files'],
			items: [] as readonly unknown[],
			files: options.files ?? [],
			dropEffect: '',
		},
		currentTarget: {
			removedAttributes,
			removeAttribute(name: string) { removedAttributes.push(name); },
		},
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.propagationStopped = true; },
	};
}

async function mountProjectBinDrop(blocked: boolean) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const imported: unknown[][] = [];
	let state: ReturnType<typeof useProjectBinFileDrop> | null = null;
	function Harness() {
		state = useProjectBinFileDrop({
			blocked,
			onFiles: (files: unknown[]) => { imported.push(files); },
		});
		return null;
	}
	await act(async () => { root.render(React.createElement(Harness)); });
	const current = () => {
		assert.ok(state, 'the Project Bin drop hook rendered');
		return state;
	};
	return {
		imported,
		dropActive: () => current().dropActive,
		deliver: async (name: 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop', event: unknown) => {
			await act(async () => { current().dropHandlers[name](event); });
			return event;
		},
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

test('a blocked Project Bin cancels the file drag so the browser cannot navigate to the dropped file', async () => {
	const bin = await mountProjectBinDrop(true);
	try {
		const enter = dragEvent();
		await bin.deliver('onDragEnter', enter);
		assert.equal(enter.defaultPrevented, true, 'dragenter is cancelled while blocked');

		const over = dragEvent();
		await bin.deliver('onDragOver', over);
		assert.equal(over.defaultPrevented, true, 'dragover is cancelled while blocked');
		assert.equal(over.dataTransfer.dropEffect, 'none');
		assert.equal(bin.dropActive(), false, 'the blocked bin never lights up');
	} finally {
		await bin.cleanup();
	}
});

test('a blocked Project Bin receives the drop it cancelled and refuses the import', async () => {
	const bin = await mountProjectBinDrop(true);
	try {
		await bin.deliver('onDragOver', dragEvent());
		const drop = dragEvent({ files: ['tone.wav'] });
		await bin.deliver('onDrop', drop);

		assert.equal(drop.defaultPrevented, true);
		assert.equal(drop.propagationStopped, true);
		assert.deepEqual(bin.imported, [], 'a blocked bin imports nothing');
		assert.deepEqual(drop.currentTarget.removedAttributes, ['data-drop-active']);
	} finally {
		await bin.cleanup();
	}
});

test('an unblocked Project Bin lights up, copies the drag, and imports the dropped files', async () => {
	const bin = await mountProjectBinDrop(false);
	try {
		await bin.deliver('onDragEnter', dragEvent());
		const over = dragEvent();
		await bin.deliver('onDragOver', over);
		assert.equal(over.defaultPrevented, true);
		assert.equal(over.dataTransfer.dropEffect, 'copy');
		assert.equal(bin.dropActive(), true);

		await bin.deliver('onDrop', dragEvent({ files: ['tone.wav'] }));
		assert.deepEqual(bin.imported, [['tone.wav']]);
		assert.equal(bin.dropActive(), false);
	} finally {
		await bin.cleanup();
	}
});

test('the Project Bin leaves a non-file drag to the panel-reorder handlers above it', async () => {
	for (const blocked of [true, false]) {
		const bin = await mountProjectBinDrop(blocked);
		try {
			const panelDrag = dragEvent({ types: ['application/x-scape-panel'] });
			await bin.deliver('onDragEnter', panelDrag);
			await bin.deliver('onDragOver', panelDrag);

			assert.equal(panelDrag.defaultPrevented, false, 'an internal panel drag is not claimed');
			assert.equal(panelDrag.propagationStopped, false);
			assert.equal(bin.dropActive(), false);
		} finally {
			await bin.cleanup();
		}
	}
});
