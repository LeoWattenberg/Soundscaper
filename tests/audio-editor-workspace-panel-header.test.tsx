/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';

import WorkspacePanelHeader from '../src/common/editor/ui/workspace/WorkspacePanelHeader.jsx';
import {
	FOCUS_ATTEMPTS,
	closeWorkspacePanelAndRestoreFocus,
	focusWorkspacePanelMenuButton,
} from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const WORKSPACE_ROOT = new URL('../src/common/editor/ui/workspace/', import.meta.url);
// The header is a .jsx module, so its props arrive untyped; the tests mount it
// with a spread of whatever the case under test needs.
const Header = WorkspacePanelHeader as unknown as React.ComponentType<Record<string, unknown>>;
const COPY = Object.freeze({
	panelMenu: 'Panel menu',
	close: 'Close',
	dockLeft: 'Left',
	dockRight: 'Right',
	dockBottom: 'Bottom',
	dockFloating: 'Floating',
	workspaceMove: 'Move workspace item',
	resizeFor: 'Resize {name}',
});

interface MountedHeader {
	readonly dom: ReturnType<typeof installReactTestDom>;
	readonly menuButton: ReactTestElement;
	menuItems(): ReactTestElement[];
	findMenu(): ReactTestElement | null;
	menu(): ReactTestElement;
	menuItemLabels(): string[];
	openMenu(detail?: number): Promise<void>;
	unmount(): Promise<void>;
}

async function mountHeader(props: Record<string, unknown>): Promise<MountedHeader> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	// .jsx modules compile to the classic runtime under node, so React must be global.
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	// The design system's stylesheet is scoped to the editor root, so the menu
	// portals there; the container stands in for it.
	dom.container.setAttribute('data-audio-editor', 'true');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<Header
		panelId="history"
		label="History"
		copy={COPY}
		{...props}
	/>));
	const menuButton = dom.one('[data-workspace-panel-menu="history"]').querySelector('button');
	assert.ok(menuButton, 'the header mounts a menu button');
	// The menu is portaled to the editor root so it clears the dock's stacking
	// context while keeping the design system's scoped styles.
	const body = dom.container.ownerDocument.body;
	const menuItems = () => body.querySelectorAll('[role="menuitem"]');
	const findMenu = () => body.querySelector('[role="menu"]');
	return {
		dom,
		menuButton,
		menuItems,
		findMenu,
		menu: () => {
			const menu = findMenu();
			assert.ok(menu, 'the menu is open');
			return menu;
		},
		menuItemLabels: () => menuItems().map((item) => item.querySelector('.context-menu-item-label')?.textContent ?? ''),
		async openMenu(detail = 1) {
			await act(async () => reactProps(menuButton).onClick({ detail, currentTarget: menuButton }));
		},
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

test('the panel header carries a labelled overflow menu button instead of a dock picker and close button', async () => {
	const mounted = await mountHeader({ currentDock: 'right', onDock() {}, onClose() {} });
	try {
		const { dom, menuButton } = mounted;
		assert.equal(menuButton.getAttribute('aria-label'), 'Panel menu: History');
		assert.equal(menuButton.getAttribute('aria-haspopup'), 'menu');
		assert.equal(menuButton.getAttribute('aria-expanded'), 'false');
		assert.equal(menuButton.getAttribute('type'), 'button');
		assert.ok(menuButton.querySelector('.icon'), 'the button shows the design-system menu glyph');
		assert.ok(!dom.find('select'), 'no dock <select> remains');
		assert.ok(!dom.find('.kw-audio-editor__workspace-panel-close'), 'no × button remains');
		assert.ok(!mounted.findMenu(), 'the menu is closed until asked for');
		assert.equal(dom.one('h2').textContent, 'History');
		assert.ok(!dom.find('.kw-audio-editor__workspace-drag-handle'), 'no drag handle without handlers');
		assert.ok(!dom.find('.kw-audio-editor__workspace-resize-handle'), 'no resize handle without handlers');
	} finally {
		await mounted.unmount();
	}
});

test('the menu lists every dock with the current one checked and disabled, then Close', async () => {
	const docks: string[] = [];
	const mounted = await mountHeader({ currentDock: 'right', onDock: (dock: string) => docks.push(dock), onClose() {} });
	try {
		const { dom, menuButton } = mounted;
		await mounted.openMenu();
		const menu = mounted.menu();
		assert.ok(
			(menu.getAttribute('class') ?? '').split(/\s+/u).includes('kw-audio-editor__workspace-panel-menu'),
			'the menu carries the workspace panel menu class',
		);
		assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
		assert.equal(menu.parentNode, dom.container, 'the menu escapes the dock stacking context without leaving the styled editor root');
		assert.ok(!dom.one('.kw-audio-editor__workspace-panel-header').contains(menu), 'the menu is not rendered inside the panel header');
		assert.equal(String((menu.style as unknown as { zIndex?: unknown }).zIndex), '10031', 'the menu stays above effect windows and dialogs');
		assert.deepEqual(mounted.menuItemLabels(), ['Left', 'Right', 'Bottom', 'Floating', 'Close']);
		const items = mounted.menuItems();
		assert.equal(items[1]?.getAttribute('aria-disabled'), 'true', 'the current dock cannot be re-chosen');
		assert.ok(items[1]?.querySelector('.context-menu-item-checkmark')?.querySelector('.icon'), 'the current dock is checked');
		for (const index of [0, 2, 3, 4]) {
			assert.equal(items[index]?.getAttribute('aria-disabled'), 'false', `item ${index} stays enabled`);
			assert.ok(!items[index]?.querySelector('.context-menu-item-checkmark')?.querySelector('.icon'), `item ${index} is unchecked`);
		}
		assert.equal(menu.querySelectorAll('[role="separator"]').length, 1, 'one divider separates the docks from Close');
		assert.ok(
			items.every((item) => item.parentNode === menu),
			'menu items are direct children of the menu so its keyboard navigation reaches them',
		);

		await act(async () => reactProps(items[3]!).onClick({}));
		assert.deepEqual(docks, ['floating']);
		assert.ok(!mounted.findMenu(), 'choosing a dock closes the menu');
		assert.equal(menuButton.getAttribute('aria-expanded'), 'false');
	} finally {
		await mounted.unmount();
	}
});

test('Close hands the owning document to the close callback', async () => {
	const closes: unknown[] = [];
	const docks: string[] = [];
	const mounted = await mountHeader({
		currentDock: 'left',
		onDock: (dock: string) => docks.push(dock),
		onClose: (ownerDocument: unknown) => closes.push(ownerDocument),
	});
	try {
		await mounted.openMenu();
		const close = mounted.menuItems().at(-1);
		assert.equal(close?.querySelector('.context-menu-item-label')?.textContent, 'Close');
		await act(async () => reactProps(close!).onClick({}));
		assert.equal(closes.length, 1);
		assert.equal(closes[0], mounted.dom.container.ownerDocument);
		assert.deepEqual(docks, []);
		assert.ok(!mounted.findMenu(), 'Close closes the menu');
	} finally {
		await mounted.unmount();
	}
});

test('a header without dock support offers Close only', async () => {
	const closes: unknown[] = [];
	const mounted = await mountHeader({ onClose: (ownerDocument: unknown) => closes.push(ownerDocument) });
	try {
		await mounted.openMenu();
		assert.deepEqual(mounted.menuItemLabels(), ['Close']);
		assert.equal(mounted.menu().querySelectorAll('[role="separator"]').length, 0);
		await act(async () => reactProps(mounted.menuItems()[0]!).onClick({}));
		assert.equal(closes.length, 1);
	} finally {
		await mounted.unmount();
	}
});

test('a keyboard-opened menu focuses its first item while a pointer-opened one leaves focus on the button', async () => {
	const mounted = await mountHeader({ currentDock: 'left', onDock() {}, onClose() {} });
	try {
		const { dom, menuButton } = mounted;
		const ownerDocument = dom.container.ownerDocument;
		await mounted.openMenu(1);
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
		assert.equal(ownerDocument.activeElement, menuButton, 'pointer opening keeps focus on the trigger');
		const items = mounted.menuItems();
		await act(async () => reactProps(items[1]!).onClick({}));
		assert.ok(!mounted.findMenu(), 'choosing Right closes the menu');

		await mounted.openMenu(0);
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
		assert.equal(ownerDocument.activeElement, mounted.menuItems()[0], 'keyboard opening focuses the first item');
	} finally {
		await mounted.unmount();
	}
});

test('right-clicking the header opens the same menu', async () => {
	const mounted = await mountHeader({ currentDock: 'bottom', onDock() {}, onClose() {} });
	try {
		const { dom, menuButton } = mounted;
		let prevented = 0;
		await act(async () => reactProps(dom.one('header')).onContextMenu({
			preventDefault: () => { prevented += 1; }, clientX: 40, clientY: 50, button: 2,
		}));
		assert.equal(prevented, 1, 'the native context menu is suppressed');
		assert.ok(mounted.findMenu());
		assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
		assert.deepEqual(mounted.menuItemLabels(), ['Left', 'Right', 'Bottom', 'Floating', 'Close']);
	} finally {
		await mounted.unmount();
	}
});

test('the header keeps the reorder and floating resize handles when their handlers are supplied', async () => {
	const events: string[] = [];
	const mounted = await mountHeader({
		currentDock: 'floating',
		floatingMoveHandle: true,
		onDock() {},
		onClose() {},
		onPointerDown: () => events.push('pointerdown'),
		dragHandle: {
			onDragStart: () => events.push('dragstart'),
			onDragEnd: () => events.push('dragend'),
			onKeyDown: () => events.push('drag-key'),
		},
		resizeHandle: { onKeyDown: () => events.push('resize-key') },
	});
	try {
		const { dom } = mounted;
		const header = dom.one('header');
		assert.equal(header.getAttribute('data-floating-panel-move-handle'), 'history');
		const drag = dom.one('[data-workspace-panel-drag-handle="history"]');
		assert.equal(drag.getAttribute('aria-label'), 'Move workspace item: History');
		assert.equal(drag.getAttribute('draggable'), 'true');
		const resize = dom.one('[data-floating-panel-resize-handle="history"]');
		assert.equal(resize.getAttribute('aria-label'), 'Resize History');
		await act(async () => reactProps(header).onPointerDown({}));
		await act(async () => reactProps(drag).onDragStart({}));
		await act(async () => reactProps(drag).onDragEnd({}));
		await act(async () => reactProps(drag).onKeyDown({}));
		await act(async () => reactProps(resize).onKeyDown({}));
		assert.deepEqual(events, ['pointerdown', 'dragstart', 'dragend', 'drag-key', 'resize-key']);
		const children = header.childNodes.filter((node) => node instanceof Object && 'tagName' in node) as ReactTestElement[];
		assert.deepEqual(children.map((node) => node.tagName), ['BUTTON', 'H2', 'BUTTON', 'SPAN'], 'handle, title, resize, menu');
	} finally {
		await mounted.unmount();
	}
});

test('closing a panel toggles it and restores capture focus only for the recording panel', () => {
	const dom = installReactTestDom();
	const rafCalls: number[] = [];
	try {
		const trigger = dom.container.ownerDocument.createElement('button');
		const ownerDocument = {
			querySelector: (selector: string) => (
				selector === '[data-transport="framescaper-record"] button' ? trigger : null
			),
		};
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, writable: true,
			value: (callback: () => void) => { rafCalls.push(1); callback(); return rafCalls.length; },
		});
		const toggled: string[] = [];
		closeWorkspacePanelAndRestoreFocus(ownerDocument, 'history', (panelId: string) => toggled.push(panelId));
		assert.deepEqual(toggled, ['history']);
		assert.equal(rafCalls.length, 0, 'ordinary panels leave focus alone');
		closeWorkspacePanelAndRestoreFocus(ownerDocument, 'recording-setup', (panelId: string) => toggled.push(panelId));
		assert.deepEqual(toggled, ['history', 'recording-setup']);
		assert.equal(dom.container.ownerDocument.activeElement, trigger, 'the recording toolbar button regains focus');
	} finally {
		dom.restore();
	}
});

test('the menu button focus helper retries across frames until the re-mounted panel appears', () => {
	const dom = installReactTestDom();
	let rafCalls = 0;
	try {
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, writable: true,
			value: (callback: () => void) => { rafCalls += 1; callback(); return rafCalls; },
		});
		const button = dom.container.ownerDocument.createElement('button');
		let queries = 0;
		const ownerDocument = {
			querySelector: (selector: string) => {
				assert.equal(selector, '[data-workspace-panel-menu="metadata"] button');
				queries += 1;
				return queries >= 3 ? button : null;
			},
		};
		focusWorkspacePanelMenuButton(ownerDocument, 'metadata');
		assert.equal(dom.container.ownerDocument.activeElement, button);
		assert.equal(rafCalls, 3);

		rafCalls = 0;
		focusWorkspacePanelMenuButton({ querySelector: () => null }, 'metadata');
		assert.equal(rafCalls, FOCUS_ATTEMPTS, 'the helper gives up after a bounded number of frames');
	} finally {
		dom.restore();
	}
});

test('the menu button focus helper waits for the replacement instead of the button that is about to unmount', () => {
	const dom = installReactTestDom();
	let rafCalls = 0;
	try {
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true, writable: true,
			value: (callback: () => void) => { rafCalls += 1; callback(); return rafCalls; },
		});
		const previous = dom.container.ownerDocument.createElement('button');
		const replacement = dom.container.ownerDocument.createElement('button');
		let queries = 0;
		const ownerDocument = {
			querySelectorAll: (selector: string) => {
				assert.equal(selector, '[data-workspace-panel-menu="effects"] button');
				queries += 1;
				// React has not committed the move yet: only the old button matches.
				return queries < 3 ? [previous] : [previous, replacement];
			},
		};
		focusWorkspacePanelMenuButton(ownerDocument, 'effects', previous);
		assert.equal(dom.container.ownerDocument.activeElement, replacement, 'focus lands on the re-mounted button');
		assert.equal(rafCalls, 3, 'the old button never receives focus while it still matches');
	} finally {
		dom.restore();
	}
});

test('both panel hosts render the shared header and no legacy dock picker or close button', async () => {
	const dock = await readFile(new URL('WorkspacePanelDock.jsx', WORKSPACE_ROOT), 'utf8');
	const video = await readFile(new URL('VideoEditorWorkspacePanels.jsx', WORKSPACE_ROOT), 'utf8');
	for (const [name, source] of [['WorkspacePanelDock.jsx', dock], ['VideoEditorWorkspacePanels.jsx', video]]) {
		assert.match(source, /from '\.\/WorkspacePanelHeader\.jsx'/u, `${name} imports the shared header`);
		assert.match(source, /<WorkspacePanelHeader\b/u, `${name} renders the shared header`);
		assert.doesNotMatch(source, /data-workspace-panel-dock-picker/u, `${name} has no dock picker`);
		assert.doesNotMatch(source, /kw-audio-editor__workspace-panel-close/u, `${name} has no × button`);
		assert.doesNotMatch(source, /<select/u, `${name} renders no select`);
	}
	assert.match(
		dock,
		/closest\('button, select, input, label, a, \[role="menu"\]'\)/u,
		'clicks inside the panel menu never begin a floating drag',
	);
	assert.match(dock, /focusWorkspacePanelMenuButton\(/u, 'a dock change restores focus to the re-mounted menu button');
	assert.match(dock, /closeWorkspacePanelAndRestoreFocus\(/u);
	assert.doesNotMatch(dock, /closePanelAndRestoreFocus\(/u, 'the event-taking close helper is gone');
	const focus = await readFile(new URL('workspace-panel-focus.js', WORKSPACE_ROOT), 'utf8');
	assert.doesNotMatch(focus, /export function closePanelAndRestoreFocus/u);
});
