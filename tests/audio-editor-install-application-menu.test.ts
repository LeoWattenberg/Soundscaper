/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../src/common/editor/preferences.js';
import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { INSTALL_APPLICATION_MENU_ITEM_ID } from '../src/common/editor/ui/install-application-menu.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

type MenuItem = Record<string, unknown> & { items?: MenuItem[] };

interface MenuOptions {
	readonly productId?: string;
	readonly locale?: string;
	readonly copy?: Record<string, unknown>;
	readonly available?: () => boolean;
	readonly install?: () => unknown;
}

function editorProject(): Record<string, unknown> {
	return {
		id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [],
		selection: { trackIds: [], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
}

function editorSnapshot(project: Record<string, unknown>): Record<string, unknown> {
	return {
		project, selectedTrackId: null,
		preferences: { workspace: {
			activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
		}, view: {}, shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS },
		history: { canUndo: false, canRedo: false, hasClipboard: false },
		effects: { selectionTypes: [], canRepeatLast: false },
	};
}

function menus(options: MenuOptions = {}): MenuItem[] {
	const project = editorProject();
	return createApplicationMenus({
		productId: options.productId ?? 'soundscaper',
		aboutLabel: 'About',
		capabilities: { audioGenerators: true, audioEffects: true, audioAnalysis: true },
		locale: options.locale ?? 'en',
		copy: options.copy ?? ENGLISH_COPY,
		project,
		snapshot: editorSnapshot(project),
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({
			installAvailable: options.available ?? (() => false),
			installApplication: options.install ?? (() => undefined),
		} as Record<string, unknown>, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	}) as MenuItem[];
}

/** The Help menu the workspace itself builds, which is where the desktop build is decided. */
function workspaceHelpMenu(options: Readonly<{ isDesktop: boolean; productId?: string }>): MenuItem {
	const project = editorProject();
	const input = {
		productId: options.productId ?? 'soundscaper',
		aboutLabel: 'About',
		capabilities: { audioGenerators: true, audioEffects: true, audioAnalysis: true },
		locale: 'en',
		copy: ENGLISH_COPY,
		project,
		snapshot: editorSnapshot(project),
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, selectedAudioTrack: null, durationFrames: 0,
		projectBinEffectivelyOpen: false, uiFlags: {},
		desktopHostRuntime: null,
		fileService: { isDesktop: options.isDesktop },
		parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
	};
	const built = createWorkspaceApplicationMenus(new Proxy(input, {
		get: (target, property, receiver) => (Reflect.has(target, property)
			? Reflect.get(target, property, receiver)
			: () => undefined),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0]);
	const menu = (built as unknown as MenuItem[]).find((candidate) => candidate.id === 'help');
	assert.ok(menu, 'the workspace builds a Help menu');
	return menu;
}

function helpMenu(options: MenuOptions = {}): MenuItem {
	const help = menus(options).find((menu) => menu.id === 'help');
	assert.ok(help, 'the Help menu exists');
	return help;
}

function installItem(options: MenuOptions = {}): MenuItem {
	const item = helpMenu(options).items?.find((entry) => entry.id === INSTALL_APPLICATION_MENU_ITEM_ID);
	assert.ok(item, 'Help holds the install entry');
	return item;
}

function materializedInstallItem(options: MenuOptions = {}): MenuItem {
	const help = materializeApplicationMenu(helpMenu(options)) as MenuItem;
	const item = help.items?.find((entry) => entry.id === INSTALL_APPLICATION_MENU_ITEM_ID);
	assert.ok(item, 'the materialized Help menu holds the install entry');
	return item;
}

test('both locales carry the install labels and the reason the entry can be unavailable', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of ['installEditor', 'installFramescaper', 'installUnavailable']) {
			const value = (copy as Record<string, unknown>)[key];
			assert.equal(typeof value, 'string', `${key} is missing`);
			assert.ok((value as string).length > 0, `${key} is empty`);
		}
		// Menu labels are named commands, not sentences; the unavailability
		// reason beside them is prose and keeps its full stop.
		for (const key of ['installEditor', 'installFramescaper']) {
			assert.doesNotMatch(
				(copy as Record<string, string>)[key], /\.$/, `${key} may not end in a period`,
			);
		}
	}
});

test('the install entry sits in Help beside diagnostics and names the product it installs', () => {
	const help = helpMenu();
	const ids = (help.items ?? []).map((item) => item.id);
	assert.ok(ids.includes('diagnostics'), 'Help still holds diagnostics');
	assert.equal(
		ids.indexOf(INSTALL_APPLICATION_MENU_ITEM_ID),
		ids.indexOf('diagnostics') + 1,
		'the install entry follows diagnostics',
	);
	assert.equal(installItem().label, 'Install Soundscaper');
	assert.equal(installItem({ productId: 'framescaper' }).label, 'Install Framescaper');
});

test('the German catalog labels the install entry in German for either product', () => {
	const german = { locale: 'de', copy: GERMAN_COPY };
	assert.equal(installItem(german).label, 'Soundscaper installieren');
	assert.equal(installItem({ ...german, productId: 'framescaper' }).label, 'Framescaper installieren');
});

test('the install entry stays visible but disabled while the browser has offered no prompt', () => {
	const built = installItem({ available: () => false });
	assert.equal(built.disabled, true, 'command search reads the built item');
	assert.equal(built.disabledReason, ENGLISH_COPY.installUnavailable);
	const item = materializedInstallItem({ available: () => false });
	assert.equal(item.disabled, true);
	assert.equal(item.disabledReason, ENGLISH_COPY.installUnavailable);
});

test('the install entry becomes available once a prompt has been captured', () => {
	assert.equal(installItem({ available: () => true }).disabled, false);
	const item = materializedInstallItem({ available: () => true });
	assert.equal(item.disabled, false);
	assert.equal(item.disabledReason, undefined);
});

test('one prompt arriving after the menus were built enables the entry without rebuilding them', () => {
	let available = false;
	const help = helpMenu({ available: () => available });
	const before = materializeApplicationMenu(help) as MenuItem;
	assert.equal(
		before.items?.find((item) => item.id === INSTALL_APPLICATION_MENU_ITEM_ID)?.disabled,
		true,
	);
	available = true;
	const after = materializeApplicationMenu(help) as MenuItem;
	assert.equal(
		after.items?.find((item) => item.id === INSTALL_APPLICATION_MENU_ITEM_ID)?.disabled,
		false,
	);
});

test('choosing the install entry replays the captured prompt exactly once', () => {
	let prompts = 0;
	const item = installItem({ available: () => true, install: () => { prompts += 1; } });
	assert.equal(typeof item.onClick, 'function');
	(item.onClick as () => void)();
	assert.equal(prompts, 1);
});

test('the desktop build leaves out the install entry, and only that entry', () => {
	const browser = (workspaceHelpMenu({ isDesktop: false }).items ?? []).map((item) => item.id);
	const desktop = (workspaceHelpMenu({ isDesktop: true }).items ?? []).map((item) => item.id);
	assert.ok(browser.includes(INSTALL_APPLICATION_MENU_ITEM_ID), 'a browser is offered the install entry');
	assert.equal(
		desktop.includes(INSTALL_APPLICATION_MENU_ITEM_ID),
		false,
		'an application the user already installed does not offer to install itself',
	);
	assert.deepEqual(
		desktop,
		browser.filter((id) => id !== INSTALL_APPLICATION_MENU_ITEM_ID),
		'the rest of Help is the same menu it was',
	);
});

test('Framescaper on the desktop leaves the entry out as well', () => {
	const desktop = workspaceHelpMenu({ isDesktop: true, productId: 'framescaper' });
	assert.equal(
		(desktop.items ?? []).some((item) => item.id === INSTALL_APPLICATION_MENU_ITEM_ID),
		false,
	);
});

test('a browser that has offered no prompt still shows the entry, greyed with its reason', () => {
	const item = (workspaceHelpMenu({ isDesktop: false }).items ?? [])
		.find((candidate) => candidate.id === INSTALL_APPLICATION_MENU_ITEM_ID);
	assert.ok(item, 'the browser build keeps the entry it was designed for');
	assert.equal(item.label, 'Install Soundscaper');
	assert.equal(item.disabled, true);
	assert.equal(item.disabledReason, ENGLISH_COPY.installUnavailable);
});
