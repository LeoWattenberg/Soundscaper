/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('formatting a selected note restores its textarea selection and focus after a controlled update', async () => {
	const fixture = await mountedNotes('first take');
	try {
		fixture.select(6, 10);
		await fixture.click('bold');
		assert.equal(fixture.value(), 'first **take**');
		assert.deepEqual(fixture.selection(), [8, 12]);
		assert.equal(document.activeElement, fixture.textarea() as unknown as Element);
		assert.deepEqual(fixture.updates, ['first **take**']);
	} finally { await fixture.cleanup(); }
});

test('line formatting updates all selected lines without replacing the textarea or its caret on ordinary typing', async () => {
	const fixture = await mountedNotes('first\nsecond');
	try {
		const editor = fixture.textarea();
		fixture.select(0, 12);
		await fixture.click('bullets');
		assert.equal(fixture.value(), '- first\n- second');
		assert.equal(fixture.textarea(), editor);
		fixture.select(3, 3);
		await fixture.type('- fXirst\n- second');
		assert.equal(fixture.textarea(), editor);
		assert.deepEqual(fixture.selection(), [3, 3], 'typing must not restore a stale formatting selection');
	} finally { await fixture.cleanup(); }
});

test('notes keyboard formatting supports Control and Command while leaving native text undo untouched', async () => {
	const fixture = await mountedNotes('take');
	try {
		fixture.select(0, 4);
		assert.equal(await fixture.key('b', true, false), true);
		assert.equal(fixture.value(), '**take**');
		assert.equal(await fixture.key('i', false, true), true);
		assert.equal(fixture.value(), '***take***');
		assert.equal(await fixture.key('z', true, false), false);
		assert.equal(fixture.value(), '***take***');
	} finally { await fixture.cleanup(); }
});

test('notes preview renders supported Markdown and keeps HTML and link payloads as text', async () => {
	const fixture = await mountedNotes('# Session\n\n**bold** *soft* `code`\n\n- clean\n- quiet\n\n<img src=x onerror=alert(1)> [open](javascript:alert(1))');
	try {
		const editor = fixture.textarea();
		fixture.select(3, 7);
		await fixture.toggle();
		assert.equal(fixture.textarea(), editor);
		assert.equal(editor.hasAttribute('hidden'), true);
		const preview = fixture.dom.one('[data-recording-notes-preview]');
		assert.equal(preview.getAttribute('aria-label'), 'Recording notes preview');
		assert.equal(preview.querySelector('h1')?.textContent, 'Session');
		assert.equal(preview.querySelector('strong')?.textContent, 'bold');
		assert.equal(preview.querySelector('em')?.textContent, 'soft');
		assert.equal(preview.querySelector('code')?.textContent, 'code');
		assert.equal(preview.querySelectorAll('li').length, 2);
		assert.equal(preview.querySelector('img'), null);
		assert.equal(preview.querySelector('a'), null);
		assert.match(preview.textContent, /<img src=x onerror=alert\(1\)>/u);
		await fixture.toggle();
		assert.equal(fixture.textarea(), editor, 'preview must retain the textarea and its native undo history');
		assert.equal(editor.hasAttribute('hidden'), false);
		assert.deepEqual(fixture.selection(), [3, 7]);
		assert.equal(reactProps(fixture.textarea()).value, fixture.value());
	} finally { await fixture.cleanup(); }
});

test('read-only notes retain their preview and disable edit controls', async () => {
	const fixture = await mountedNotes('**saved**', true);
	try {
		assert.equal(fixture.textarea().hasAttribute('disabled'), true);
		for (const button of fixture.dom.container.querySelectorAll('[data-recording-notes-format]')) {
			assert.equal(button.hasAttribute('disabled'), true);
		}
		await fixture.toggle();
		assert.equal(fixture.dom.one('[data-recording-notes-preview]').querySelector('strong')?.textContent, 'saved');
		assert.deepEqual(fixture.updates, []);
	} finally { await fixture.cleanup(); }
});

async function mountedNotes(initialValue: string, disabled = false) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let value = initialValue;
	const updates: string[] = [];
	const render = () => root.render(<RecordingNotesPanel value={value} disabled={disabled}
		copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en}
		onChange={(next) => { updates.push(next); value = next; render(); }} />);
	await act(async () => { render(); });
	const textarea = () => dom.one('[data-recording-notes-editor]');
	let start = 0;
	let end = 0;
	const installSelection = (element: ReactTestElement) => {
		Object.defineProperties(element, {
			selectionStart: { configurable: true, get: () => start },
			selectionEnd: { configurable: true, get: () => end },
			setSelectionRange: { configurable: true, value: (nextStart: number, nextEnd: number) => {
				start = nextStart; end = nextEnd;
			} },
		});
	};
	installSelection(textarea());
	return {
		dom, updates, textarea, value: () => value,
		select: (nextStart: number, nextEnd: number) => { start = nextStart; end = nextEnd; },
		selection: () => [start, end],
		click: async (format: string) => {
			await act(async () => { reactProps(dom.one(`[data-recording-notes-format="${format}"]`)).onClick(); });
		},
		type: async (next: string) => {
			await act(async () => { reactProps(textarea()).onChange({ currentTarget: { value: next } }); });
		},
		key: async (key: string, ctrlKey: boolean, metaKey: boolean) => {
			let prevented = false;
			await act(async () => { reactProps(textarea()).onKeyDown({
				key, ctrlKey, metaKey, altKey: false, shiftKey: false,
				preventDefault: () => { prevented = true; },
			}); });
			return prevented;
		},
		toggle: async () => {
			await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick(); });
			const editor = dom.find('[data-recording-notes-editor]');
			if (editor) installSelection(editor);
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		},
	};
}
