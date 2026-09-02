/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EditorActionBar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import WorkspaceSwitcherControl from '../src/common/editor/ui/toolbar/WorkspaceSwitcherControl.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

// The .jsx sources compile to the classic runtime under tsx, so the controls
// need the React global that the Vite build provides automatically.
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const UI = new URL('../src/common/editor/ui/', import.meta.url);

test('the action bar shows the workspace switcher only when the toolbar button is on', () => {
	const shown = actionBarMarkup(snapshot('soundscaper', 'modern', { 'workspace-switcher': true }));
	assert.match(shown, /class="kw-audio-editor__action-bar-right"><span data-workspace-switcher/u);
	assert.match(shown, /<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>[\s\S]*?Workspace: Soundscaper/u);
	assert.match(shown, /class="[^"]*kw-audio-editor__action-bar-button kw-audio-editor__workspace-switcher/u);
	assert.match(shown, /data-workspace-switcher[\s\S]*data-edit="undo"/u, 'the switcher precedes undo/redo like Audacity row 1');

	assert.doesNotMatch(actionBarMarkup(snapshot('soundscaper', 'modern', { 'workspace-switcher': false })), /data-workspace-switcher/u);
	assert.doesNotMatch(actionBarMarkup(snapshot('soundscaper', 'modern', {})), /data-workspace-switcher/u);
	assert.match(
		actionBarMarkup(snapshot('framescaper', 'video-editor', { 'workspace-switcher': true })),
		/Workspace: Video editor/u,
	);
});

test('the switcher lists the product presets plus custom layouts and applies the choice', async () => {
	const fixture = await mountedSwitcher(snapshot('soundscaper', 'music', { 'workspace-switcher': true }, [
		{ id: 'mine', name: 'My layout', layout: {} },
	]));
	try {
		const trigger = fixture.dom.one('[data-workspace-switcher]').one('button');
		assert.equal(trigger.querySelector('.button__text')?.textContent, 'Workspace: Music');
		assert.equal(fixture.body.querySelector('[role="menu"]'), null);
		await act(async () => { reactProps(trigger).onClick({ nativeEvent: { detail: 1 } }); });
		assert.equal(trigger.getAttribute('aria-expanded'), 'true');
		const menu = fixture.body.querySelector('[role="menu"]');
		assert.ok(menu, 'the menu opens');
		assert.equal(menu.parentNode, fixture.body, 'the menu is portaled to the body, outside the transformed action bar column');
		assert.ok(menu.getAttribute('class')?.includes('kw-audio-editor__workspace-switcher-menu'));
		assert.deepEqual(menuLabels(menu), ['Soundscaper', 'Audacity', 'Music', 'Classic', 'My layout']);
		assert.deepEqual(menuLabels(menu).filter((label) => isChecked(menuItem(menu, label))), ['Music']);

		await act(async () => { reactProps(menuItem(menu, 'Classic')).onClick({ stopPropagation() {} }); });
		assert.deepEqual(fixture.calls.splice(0), ['classic']);
		assert.equal(fixture.body.querySelector('[role="menu"]'), null, 'choosing a workspace closes the menu');
		assert.equal(trigger.getAttribute('aria-expanded'), 'false');
	} finally {
		await fixture.cleanup();
	}
});

test('choosing a preset keeps keyboard focus in the action bar even when the choice hides the switcher', async () => {
	const fixture = await mountedSwitcher(snapshot('soundscaper', 'audacity', { 'workspace-switcher': true }));
	try {
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, writable: true, value: (callback: () => void) => { callback(); return 1; },
		});
		const trigger = fixture.dom.one('[data-workspace-switcher]').one('button');
		// A pointer open: a keyboard open would leave the menu's own deferred
		// autofocus timer pending, which the fake document cannot cancel.
		await act(async () => { reactProps(trigger).onClick({ nativeEvent: { detail: 1 } }); });
		const menu = fixture.body.querySelector('[role="menu"]');
		assert.ok(menu);
		// The activated item unmounts with the menu, which drops focus to the body.
		trigger.ownerDocument.activeElement = fixture.body;
		await act(async () => { reactProps(menuItem(menu, 'Soundscaper')).onClick({ stopPropagation() {} }); });
		assert.deepEqual(fixture.calls.splice(0), ['modern']);
		assert.equal(trigger.ownerDocument.activeElement, trigger, 'focus returns to the trigger while it is still mounted');
	} finally {
		await fixture.cleanup();
	}
});

test('Framescaper offers only the video-editor workspace', async () => {
	const fixture = await mountedSwitcher(snapshot('framescaper', 'video-editor', { 'workspace-switcher': true }));
	try {
		const trigger = fixture.dom.one('[data-workspace-switcher]').one('button');
		assert.equal(trigger.querySelector('.button__text')?.textContent, 'Workspace: Video editor');
		await act(async () => { reactProps(trigger).onClick({ nativeEvent: { detail: 0 } }); });
		const menu = fixture.body.querySelector('[role="menu"]');
		assert.ok(menu);
		assert.deepEqual(menuLabels(menu), ['Video editor']);
		assert.equal(isChecked(menuItem(menu, 'Video editor')), true);
	} finally {
		await fixture.cleanup();
	}
});

test('the customize flyout and the action bar wire the switcher through the toolbar button', async () => {
	const [toolbar, transport, control] = await Promise.all([
		readFile(new URL('toolbar/EditorToolToolbar.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/AudioEditorTransportControls.jsx', UI), 'utf8'),
		readFile(new URL('toolbar/WorkspaceSwitcherControl.jsx', UI), 'utf8'),
	]);
	assert.match(toolbar, /\{ id: 'workspace-switcher', label: copy\.workspace, icon: iconNameToChar\('WORKSPACE'\) \}/u);
	assert.match(transport, /toolbarButtons\?\.\['workspace-switcher'\] === true && <WorkspaceSwitcherControl/u);
	assert.match(control, /createPortal\(/u);
	assert.match(control, /workspaceSwitcherOptions\(/u);
	assert.match(control, /preferences\.setWorkspace\(/u);
});

function snapshot(
	productId: string,
	activeId: string,
	toolbarButtons: Record<string, boolean>,
	custom: readonly Record<string, unknown>[] = [],
) {
	return {
		productId,
		project: null,
		history: { canUndo: false, canRedo: false },
		preferences: { workspace: { activeId, custom, toolbarButtons, panels: {} } },
	};
}

function actionBarMarkup(value: ReturnType<typeof snapshot>) {
	return renderToStaticMarkup(<EditorActionBar
		copy={ENGLISH_COPY}
		snapshot={value}
		controller={{ actions: { preferences: { setWorkspace: () => undefined } } }}
		showAup4={false}
		run={(operation: () => unknown) => operation()}
		editBlocked={false}
		blocked={false}
		executeEdit={() => undefined}
		onSaveAup4={() => undefined}
		onExportAudio={() => undefined}
		onToggleMixer={() => undefined}
	/>);
}

function menuLabels(menu: ReactTestElement): string[] {
	return menu.childNodes
		.filter((node): node is ReactTestElement => node instanceof ReactTestElement && node.getAttribute('role') === 'menuitem')
		.map((item) => item.querySelector('.context-menu-item-label')?.textContent ?? '');
}

function isChecked(item: ReactTestElement): boolean {
	const checkmark = item.querySelector('.context-menu-item-checkmark');
	assert.ok(checkmark, 'workspace items always render a checkmark cell');
	return checkmark.querySelectorAll('.icon').length === 1;
}

function menuItem(menu: ReactTestElement, label: string): ReactTestElement {
	const item = menu.childNodes.find((node): node is ReactTestElement => (
		node instanceof ReactTestElement
		&& node.getAttribute('role') === 'menuitem'
		&& node.querySelector('.context-menu-item-label')?.textContent === label
	));
	assert.ok(item, `Missing menu item ${label}`);
	return item;
}

async function mountedSwitcher(value: ReturnType<typeof snapshot>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: string[] = [];
	const controller = { actions: { preferences: { setWorkspace: (id: string) => { calls.push(id); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<WorkspaceSwitcherControl
		copy={ENGLISH_COPY}
		snapshot={value}
		controller={controller}
		run={(operation: () => unknown) => operation()}
	/>));
	const body = (globalThis as unknown as { document: { body: ReactTestElement } }).document.body;
	return {
		dom: {
			one: (selector: string) => {
				const found = dom.one(selector);
				return Object.assign(found, { one: (inner: string) => {
					const child = found.querySelector(inner);
					assert.ok(child, `Missing ${inner} under ${selector}`);
					return child;
				} });
			},
		},
		body,
		calls,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
