/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSpreadsheetPanel from '../src/common/editor/ui/clip-spreadsheet/ClipSpreadsheetPanel.tsx';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { installResponsivenessTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

async function mountedGrid(run: (dom: ReturnType<typeof installResponsivenessTestDom>, history: string[]) => Promise<void>) {
	const dom = installResponsivenessTestDom();
	const inputPrototype = Object.getPrototypeOf(dom.container) as object;
	const priorSelect = Object.getOwnPropertyDescriptor(inputPrototype, 'select');
	Object.defineProperty(inputPrototype, 'select', { configurable: true, value: () => undefined });
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'HTMLButtonElement');
	Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: class {} });
	const project = applyEditorCommand(createCurrentAudioEditorProject({ id: 'grid', sampleRate: 48_000 }), {
		type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 } },
			{ type: 'track/add', track: { id: 'track', name: 'Voice' } },
			{ type: 'clip/add', trackId: 'track', clip: { id: 'clip', sourceId: 'source', title: 'Voice', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 } },
		],
	});
	const history: string[] = [];
	const controller = { actions: { clip: { editSpreadsheet: () => undefined, pasteSpreadsheet: () => Promise.resolve() },
		edit: { undo: () => { history.push('undo'); }, redo: () => { history.push('redo'); } } } };
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<ClipSpreadsheetPanel controller={controller} snapshot={{ project }} copy={ENGLISH_COPY} />); });
		await run(dom, history);
	} finally {
		await act(async () => { root.unmount(); });
		if (priorSelect) Object.defineProperty(inputPrototype, 'select', priorSelect); else Reflect.deleteProperty(inputPrototype, 'select');
		if (prior) Object.defineProperty(globalThis, 'HTMLButtonElement', prior); else Reflect.deleteProperty(globalThis, 'HTMLButtonElement');
		dom.restore();
	}
}

function keyEvent(target: unknown, key: string, modifiers: Readonly<{ ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }> = {}) {
	let prevented = false;
	let stopped = false;
	return { key, code: key === ' ' ? 'Space' : key, target, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
		...modifiers, get defaultPrevented() { return prevented; }, get stopped() { return stopped; },
		preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
}

test('the production grid and its docked wrapper release an unrelated accepted project command', async () => {
	await mountedGrid(async dom => {
		const cell = dom.one('[data-column="name"]');
		for (const owner of [dom.one('table'), dom.one('.audio-editor-clip-spreadsheet__content')]) {
			const event = keyEvent(cell, 'l', { ctrlKey: true, altKey: true });
			await act(async () => { reactProps(owner).onKeyDown(event); });
			assert.equal(event.stopped, false, 'an unhandled project chord must reach its workspace owner');
			assert.equal(event.defaultPrevented, false);
		}
	});
});

test('the production grid keeps its navigation, clipboard and scoped history inside the spreadsheet', async () => {
	await mountedGrid(async (dom, history) => {
		const cell = dom.one('[data-column="name"]');
		for (const [key, modifiers] of [['ArrowRight', {}], ['a', { ctrlKey: true }], ['c', { ctrlKey: true }],
			['v', { metaKey: true }], ['z', { ctrlKey: true }], ['z', { ctrlKey: true, shiftKey: true }]] as const) {
			const event = keyEvent(cell, key, modifiers);
			await act(async () => { reactProps(dom.one('table')).onKeyDown(event); });
			assert.equal(event.stopped, true);
		}
		assert.deepEqual(history, ['undo', 'redo']);
	});
});

test('a native cell draft retains editing ownership and Escape restores its cell', async () => {
	await mountedGrid(async dom => {
		const cell = dom.one('[data-column="name"]');
		await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(cell, 'F2')); });
		const input = dom.one('[aria-label="Name"]');
		const command = keyEvent(input, 'l', { ctrlKey: true, altKey: true });
		for (const owner of [dom.one('table'), dom.one('.audio-editor-clip-spreadsheet__content')]) {
			await act(async () => { reactProps(owner).onKeyDown(command); });
		}
		assert.equal(command.stopped, true);
		assert.equal(command.defaultPrevented, false, 'native draft shortcuts remain native');
		await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(input, 'Escape')); });
		assert.equal(dom.find('[aria-label="Name"]'), null);
		assert.equal(cell.ownerDocument.activeElement, cell);
	});
});

test('native spreadsheet copying still serializes its selected cell', async () => {
	await mountedGrid(async dom => {
		const cell = dom.one('[data-column="name"]');
		await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(cell, 'F2')); });
		await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(dom.one('[aria-label="Name"]'), 'Escape')); });
		const clipboard: string[] = [];
		const event = { ...keyEvent(cell, 'c', { ctrlKey: true }), clipboardData: {
			setData(type: string, value: string) { clipboard.push(type, value); },
		} };
		await act(async () => { reactProps(dom.one('table')).onCopy(event); });
		assert.deepEqual(clipboard, ['text/plain', 'Voice']);
	});
});
