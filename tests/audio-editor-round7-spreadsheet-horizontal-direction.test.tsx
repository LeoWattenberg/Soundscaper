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

async function mountedGrid(run: (dom: ReturnType<typeof installResponsivenessTestDom>, history: string[]) => Promise<void>, direction: string = 'ltr') {
	const dom = installResponsivenessTestDom();
	const view = dom.container.ownerDocument.defaultView as { getComputedStyle?: (element: unknown) => { direction: string } };
	view.getComputedStyle = () => ({ direction });
	const inputPrototype = Object.getPrototypeOf(dom.container) as object;
	const priorSelect = Object.getOwnPropertyDescriptor(inputPrototype, 'select');
	Object.defineProperty(inputPrototype, 'select', { configurable: true, value: () => undefined });
	const priorInput = Object.getOwnPropertyDescriptor(globalThis, 'HTMLInputElement');
	Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: class {} });
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
		if (priorInput) Object.defineProperty(globalThis, 'HTMLInputElement', priorInput); else Reflect.deleteProperty(globalThis, 'HTMLInputElement');
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

for (const direction of ['ltr', 'rtl']) {
	test(`ordinary horizontal arrows follow the mounted ${direction} grid`, async () => {
		await mountedGrid(async dom => {
			const name = dom.one('[data-column="name"]');
			const track = dom.one('[data-column="track"]');
			await act(async () => { reactProps(name).onMouseDown({ button: 0, shiftKey: false, preventDefault() {} }); });
			await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(name, direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')); });
			assert.equal(name.ownerDocument.activeElement, track);
			await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(track, direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft')); });
			assert.equal(name.ownerDocument.activeElement, name);
		}, direction);
	});
	test(`logical Tab and Home stay stable in the ${direction} grid`, async () => {
		await mountedGrid(async dom => {
			const name = dom.one('[data-column="name"]');
			const track = dom.one('[data-column="track"]');
			await act(async () => { reactProps(name).onMouseDown({ button: 0, shiftKey: false, preventDefault() {} }); });
			await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(name, 'Tab')); });
			assert.equal(name.ownerDocument.activeElement, track);
			await act(async () => { reactProps(dom.one('table')).onKeyDown(keyEvent(track, 'Home')); });
			assert.equal(name.ownerDocument.activeElement, name);
		}, direction);
	});
}
