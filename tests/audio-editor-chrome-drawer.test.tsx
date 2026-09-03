/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderApplicationMenuItem } from '../src/common/editor/ui/application-menu-items.jsx';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import WorkspaceChromeDrawer from '../src/common/editor/ui/workspace/WorkspaceChromeDrawer.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

const menus = [
	{ id: 'file', label: 'File', items: [] },
	{ id: 'edit', label: 'Edit', items: [] },
	{ id: 'view', label: 'View', items: [] },
];

function renderMenuBar(compact: boolean, chromeDrawer: { isOpen: boolean; toggle(): void; close(): void } | null) {
	return renderToStaticMarkup(
		<AudioEditorMenuBar
			appName="Soundscaper"
			chromeDrawer={chromeDrawer}
			compact={compact}
			compactBarSlot={compact ? <span data-test-compact-slot="true" /> : null}
			copy={ENGLISH_COPY}
			drawerSlot={compact ? <span data-test-drawer-slot="true" /> : null}
			locale="en"
			menus={menus}
			onAssistanceSearchClose={() => undefined}
			onFullscreen={() => undefined}
			onSearchActivate={() => undefined}
			projectTabs={<nav data-test-project-tabs="true" />}
			projectName="Untitled"
			saveState="saved"
			saveText={ENGLISH_COPY.projectSaved}
		/>,
	);
}

test('the desktop menubar renders in the header row without a drawer or toggle', () => {
	const markup = renderMenuBar(false, null);
	assert.doesNotMatch(markup, /data-chrome-drawer-toggle/u);
	assert.doesNotMatch(markup, /data-chrome-drawer/u);
	assert.match(markup, /data-chrome-layout="desktop"/u);
	assert.match(markup, /role="menubar"(?![^>]*aria-orientation)/u);
	assert.match(markup, /Untitled — Soundscaper/u);
	// The project tabs sit in the titlebar and search in the menu row.
	assert.ok(markup.indexOf('data-test-project-tabs') < markup.indexOf('data-application-menu-row'));
});

test('the compact menubar puts the menus, tabs and drawer slot in the drawer and the toggle in the bar', () => {
	const drawer = { isOpen: false, toggle: () => undefined, close: () => undefined };
	const markup = renderMenuBar(true, drawer);
	const toggle = /<button[^>]*data-chrome-drawer-toggle[^>]*>/u.exec(markup)?.[0] ?? '';
	assert.ok(toggle, 'renders the toggle');
	assert.match(toggle, /aria-expanded="false"/u);
	assert.match(toggle, new RegExp(`aria-label="${ENGLISH_COPY.chromeMenu}"`, 'u'));
	const controls = /aria-controls="([^"]+)"/u.exec(toggle)?.[1];
	assert.ok(controls, 'the toggle names the drawer panel');
	const panel = new RegExp(`<div[^>]*id="${controls.replace(/[.*+?^${}()|[\]\\«»]/gu, '\\$&')}"[^>]*>`, 'u').exec(markup)?.[0] ?? '';
	assert.ok(panel, 'the drawer panel carries that id');
	assert.match(panel, /aria-hidden="true"/u);
	assert.match(panel, /inert=""/u);
	assert.match(panel, new RegExp(`aria-label="${ENGLISH_COPY.chromeMenu}"`, 'u'));

	const panelStart = markup.indexOf(panel);
	assert.ok(panelStart < markup.indexOf('role="menubar"'), 'the menubar is inside the drawer');
	assert.match(markup, /role="menubar"[^>]*aria-orientation="vertical"/u);
	assert.ok(panelStart < markup.indexOf('data-test-project-tabs'), 'project tabs move into the drawer');
	assert.ok(panelStart < markup.indexOf('data-test-drawer-slot'), 'the drawer slot renders inside the drawer');
	assert.ok(markup.indexOf('data-test-compact-slot') < panelStart, 'the compact slot renders in the bar');
	assert.ok(markup.indexOf('data-editor-search-trigger') < panelStart, 'search sits in the compact bar');
	assert.doesNotMatch(markup, /Untitled — Soundscaper/u);
	assert.match(markup, /data-chrome-layout="compact"/u);
});

test('an open drawer exposes its panel and labels the toggle as the close control', () => {
	const drawer = { isOpen: true, toggle: () => undefined, close: () => undefined };
	const markup = renderMenuBar(true, drawer);
	const toggle = /<button[^>]*data-chrome-drawer-toggle[^>]*>/u.exec(markup)?.[0] ?? '';
	assert.match(toggle, /aria-expanded="true"/u);
	assert.match(toggle, new RegExp(`aria-label="${ENGLISH_COPY.chromeMenuClose}"`, 'u'));
	const panel = /<div[^>]*class="kw-audio-editor__chrome-drawer-panel"[^>]*>/u.exec(markup)?.[0] ?? '';
	assert.ok(panel);
	assert.doesNotMatch(panel, /aria-hidden/u);
	assert.doesNotMatch(panel, /inert/u);
	assert.match(markup, /data-chrome-drawer[^>]*data-open="true"/u);
});

test('activating a menu item closes the menu, then the drawer, then runs the command', () => {
	const order: string[] = [];
	const element = renderApplicationMenuItem(
		{ id: 'x', label: 'Do it', onClick: () => { order.push('command'); return 'done'; } },
		'x',
		{ closeMenu: () => order.push('menu'), onActivate: () => order.push('drawer') },
	);
	const result = (element.props as { onClick: () => unknown }).onClick();
	assert.equal(result, 'done');
	assert.deepEqual(order, ['menu', 'drawer', 'command']);

	const disabled = renderApplicationMenuItem(
		{ id: 'y', label: 'No', disabled: true, onClick: () => order.push('never') },
		'y',
		{ closeMenu: () => order.push('menu') },
	);
	assert.equal((disabled.props as { onClick?: unknown }).onClick, undefined);
});

test('the drawer scrim closes it and the closed panel is inert', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let closed = 0;
	const render = async (open: boolean) => {
		await act(async () => root.render(
			<WorkspaceChromeDrawer id="drawer" open={open} onClose={() => { closed += 1; }} label="Menu" closeLabel="Close menu">
				<button type="button" data-inside="true">Inside</button>
			</WorkspaceChromeDrawer>,
		));
	};
	try {
		await render(false);
		const panel = dom.one('.kw-audio-editor__chrome-drawer-panel');
		assert.equal(panel.getAttribute('aria-hidden'), 'true');
		assert.equal(panel.hasAttribute('inert'), true);
		await render(true);
		assert.equal(panel.getAttribute('aria-hidden'), null);
		assert.equal(panel.hasAttribute('inert'), false);
		const scrim = dom.one('.kw-audio-editor__chrome-drawer-scrim');
		await act(async () => { reactProps(scrim).onClick?.({}); });
		assert.equal(closed, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
