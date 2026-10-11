/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { createMotionscaperShellMenus } from '../src/common/editor/ui/motionscaper/shell-menu.ts';
import { DIRECT_ENABLED_MENU_ITEM_SELECTOR, DIRECT_MENU_ITEM_SELECTOR } from '../src/common/editor/ui/application-menu-items.jsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

type Menu = { readonly id: string; readonly label: string; readonly items: readonly {
	readonly id: string; readonly label: string; readonly disabled?: boolean;
	readonly onClick?: () => void; readonly resolve?: () => { disabled: boolean };
}[] };

const copy = motionscaperCopy('en');
const motionMenus = (busy: boolean, onCommand: (command: string) => void) => createMotionscaperShellMenus({
	copy, busy, hasProject: true, workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand,
});

for (const keyboard of [false, true]) test(`Motionscaper ${keyboard ? 'keyboard' : 'pointer'} File menu becomes usable when Save finishes while open`, async () => {
	const menu = await mountMenu();
	const commands: string[] = [];
	try {
		await menu.render(motionMenus(true, command => commands.push(`busy:${command}`)), 'busy');
		await menu.open('File', keyboard);
		const bridge = menu.item('After Effects Bridge');
		assert.equal(bridge.getAttribute('aria-disabled'), 'true');
		bridge.focus();
		const popup = menu.popup(); const left = Reflect.get(popup.style, 'left'); const top = Reflect.get(popup.style, 'top');
		await menu.render(motionMenus(false, command => commands.push(`idle:${command}`)), 'idle');
		await menu.flushFrames();
		assert.equal(menu.item('After Effects Bridge'), bridge, 'refresh keeps the existing keyed menu item');
		assert.equal(bridge.getAttribute('aria-disabled'), 'false', 'the open busy snapshot must yield to idle availability');
		assert.equal(menu.popup(), popup, 'refresh does not close or remount the popup');
		assert.equal(Reflect.get(popup.style, 'left'), left); assert.equal(Reflect.get(popup.style, 'top'), top);
		assert.equal(document.activeElement, bridge, 'availability cannot restart keyboard autofocus');
		assert.equal(menu.trigger('File').getAttribute('aria-expanded'), 'true');
		await menu.click(bridge);
		assert.deepEqual(commands, ['idle:after-effects'], 'the refreshed action uses the current owner callback');
		assert.equal(menu.trigger('File').getAttribute('aria-expanded'), 'false');
		assert.equal(document.activeElement, menu.trigger('File'), 'activation retains trigger restoration');
	} finally { await menu.dispose(); }
});

test('Motionscaper availability changes before the first keyboard paint retain initial focus', async () => {
	const menu = await mountMenu();
	try {
		await menu.render(motionMenus(true, () => undefined), 'busy');
		await menu.open('File', true, false);
		assert.equal(document.activeElement, menu.trigger('File'));
		await menu.render(motionMenus(false, () => undefined), 'idle');
		await menu.flushFrames();
		assert.equal(document.activeElement, menu.item('New Composition'));
		const bridge = menu.item('After Effects Bridge'); bridge.focus();
		await menu.key('ArrowRight', bridge); await menu.flushFrames();
		assert.equal(menu.trigger('File').getAttribute('aria-expanded'), 'false');
		assert.equal(menu.trigger('Edit').getAttribute('aria-expanded'), 'true');
	} finally { await menu.dispose(); }
});

test('Motionscaper open File menu disables an old action on busy entry and retains Escape navigation', async () => {
	const menu = await mountMenu(); const commands: string[] = [];
	try {
		await menu.render(motionMenus(false, command => commands.push(command)), 'idle');
		await menu.open('File', true);
		const bridge = menu.item('After Effects Bridge'); bridge.focus();
		await menu.render(motionMenus(true, command => commands.push(command)), 'busy');
		await menu.flushFrames();
		assert.equal(bridge.getAttribute('aria-disabled'), 'true');
		await menu.click(bridge); assert.deepEqual(commands, []);
		assert.equal(menu.trigger('File').getAttribute('aria-expanded'), 'true');
		await menu.key('Escape', bridge);
		assert.equal(menu.trigger('File').getAttribute('aria-expanded'), 'false');
		assert.equal(document.activeElement, menu.trigger('File'));
	} finally { await menu.dispose(); }
});

test('Motionscaper availability invalidation only resolves the open menu once per explicit change', async () => {
	const menu = await mountMenu(); let filePlans = 0; let helpPlans = 0;
	const menus = (disabled: boolean): readonly Menu[] => [
		{ id: 'file', label: 'File', items: [{ id: 'planned', label: 'Planned', resolve: () => { filePlans += 1; return { disabled }; } }] },
		{ id: 'help', label: 'Help', items: [{ id: 'other', label: 'Other', resolve: () => { helpPlans += 1; return { disabled }; } }] },
	];
	try {
		await menu.render(menus(true), 'busy'); await menu.render(menus(false), 'idle');
		assert.deepEqual([filePlans, helpPlans], [0, 0], 'closed menus never resolve');
		await menu.open('File', false); assert.deepEqual([filePlans, helpPlans], [1, 0]);
		await menu.render(menus(true), 'idle'); await menu.render(menus(true), 'idle');
		assert.deepEqual([filePlans, helpPlans], [1, 0], 'unrelated renders retain open-time planning');
		assert.equal(menu.item('Planned').getAttribute('aria-disabled'), 'false');
		await menu.render(menus(true), 'busy');
		assert.deepEqual([filePlans, helpPlans], [2, 0]);
		assert.equal(menu.item('Planned').getAttribute('aria-disabled'), 'true');
		await menu.open('Help', true); assert.deepEqual([filePlans, helpPlans], [2, 1]);
		await menu.render(menus(false), 'idle'); assert.deepEqual([filePlans, helpPlans], [2, 2]);
		assert.equal(menu.item('Other').getAttribute('aria-disabled'), 'false');
	} finally { await menu.dispose(); }
});

test('application menus without an availability revision retain their existing open-time planner contract', async () => {
	const menu = await mountMenu(); let calls = 0;
	const menus = (disabled: boolean): readonly Menu[] => [{ id: 'file', label: 'File', items: [
		{ id: 'planned', label: 'Planned', resolve: () => { calls += 1; return { disabled }; } },
	] }];
	try {
		await menu.render(menus(true)); await menu.open('File', false);
		await menu.render(menus(false)); assert.equal(calls, 1);
		assert.equal(menu.item('Planned').getAttribute('aria-disabled'), 'true');
		await menu.click(menu.trigger('File')); await menu.open('File', false);
		assert.equal(calls, 2); assert.equal(menu.item('Planned').getAttribute('aria-disabled'), 'false');
	} finally { await menu.dispose(); }
});

async function mountMenu() {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const replace = (name: string, value: unknown) => {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	};
	replace('React', React);
	replace('MutationObserver', class { observe() {} disconnect() {} });
	const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
	replace('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
	replace('cancelAnimationFrame', (id: number) => { frames.delete(id); });
	const keys = new Set<EventListenerOrEventListenerObject>();
	window.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	window.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const popup = () => dom.one('.kw-audio-editor__application-menu');
	document.querySelector = ((selector: string) => selector.includes('.kw-audio-editor__application-menu') ? popup() : null) as typeof document.querySelector;
	const trigger = (label: string) => {
		const found = dom.container.querySelectorAll('[aria-haspopup="menu"]').find(node => node.textContent === label);
		assert.ok(found, `Missing trigger ${label}`); return found;
	};
	const item = (label: string) => {
		const found = popup().querySelectorAll('[role="menuitem"]').find(node => node.textContent === label);
		assert.ok(found, `Missing menu item ${label}`); return found;
	};
	const flushFrames = async () => {
		await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
	};
	const click = async (node: ReactTestElement) => {
		await act(async () => { reactProps(node).onClick?.({}); });
	};
	return {
		popup, trigger, item, click, flushFrames,
		async render(menus: readonly Menu[], revision?: string) {
			await act(async () => { root.render(<AudioEditorMenuBar appName="Motionscaper" productId="motionscaper" copy={ENGLISH_COPY}
				locale="en" menus={menus} {...{ menuAvailabilityRevision: revision }} searchEnabled={false}
				onAssistanceSearchClose={() => undefined} onFullscreen={() => undefined} onSearchActivate={() => undefined}
				projectTabs={null} projectName="Composition" saveState="saved" saveText="" />); });
		},
		async open(label: string, keyboard: boolean, paint = true) {
			const button = trigger(label); button.focus();
			await act(async () => {
				if (keyboard) reactProps(button).onKeyDown?.({ key: 'ArrowDown', preventDefault() {} });
				else reactProps(button).onClick?.({});
			});
			const node = popup(); const queryAll = node.querySelectorAll.bind(node);
			node.querySelectorAll = (selector: string) => {
				if (selector === DIRECT_MENU_ITEM_SELECTOR) return queryAll('[role="menuitem"]');
				if (selector === DIRECT_ENABLED_MENU_ITEM_SELECTOR) return queryAll('[role="menuitem"]').filter(item => item.getAttribute('aria-disabled') !== 'true');
				return queryAll(selector);
			};
			if (paint) await flushFrames();
		},
		async key(key: string, target: ReactTestElement) {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
			Object.defineProperty(event, 'target', { value: target });
			await act(async () => { for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			} });
		},
		async dispose() {
			await act(async () => { root.unmount(); });
			for (const [name, descriptor] of previous) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
			}
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		},
	};
}
