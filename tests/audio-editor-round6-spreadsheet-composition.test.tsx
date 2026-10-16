/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSpreadsheetPanel from '../src/common/editor/ui/clip-spreadsheet/ClipSpreadsheetPanel.tsx';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { ClipSpreadsheetEdit } from '../src/common/editor/clip-spreadsheet.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { installResponsivenessTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

async function mountedGrid(run: (dom: ReturnType<typeof installResponsivenessTestDom>, commits: readonly ClipSpreadsheetEdit[][]) => Promise<void>) {
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
	const commits: ClipSpreadsheetEdit[][] = [];
	const controller = { actions: { clip: { editSpreadsheet: (_projectId: string, edits: readonly ClipSpreadsheetEdit[]) => { commits.push([...edits]); }, pasteSpreadsheet: () => Promise.resolve() },
		edit: { undo: () => undefined, redo: () => undefined } } };
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<ClipSpreadsheetPanel controller={controller} snapshot={{ project }} copy={ENGLISH_COPY} />); });
		await run(dom, commits);
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

for (const key of ['Enter', 'Escape', 'Tab'] as const) test(`spreadsheet native name editing releases composing ${key}`, async () => {
	await mountedGrid(async (dom, commits) => {
		const table = dom.one('table');
		const cell = dom.one('[data-column="name"]');
		await act(async () => reactProps(table).onKeyDown(keyEvent(cell, 'F2')));
		const input = dom.one('[aria-label="Name"]');
		await act(async () => reactProps(input).onChange({ currentTarget: { value: 'とう' }, target: { value: 'とう' } }));
		const event = { ...keyEvent(input, key), nativeEvent: { isComposing: true } };
		// Preserve the live default-prevention getter instead of its spread snapshot.
		let prevented = false;
		event.preventDefault = () => { prevented = true; };
		await act(async () => reactProps(table).onKeyDown(event));
		assert.equal(prevented, false);
		assert.equal(dom.one('[aria-label="Name"]'), input);
		assert.equal(input.value, 'とう');
		assert.equal(commits.length, 0);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '東京' }, target: { value: '東京' } }));
		await act(async () => reactProps(table).onKeyDown(keyEvent(input, 'Enter')));
		assert.equal(commits.length, 1, 'completed confirmation publishes exactly one edit');
		assert.equal(dom.find('[aria-label="Name"]'), null);
	});
});
