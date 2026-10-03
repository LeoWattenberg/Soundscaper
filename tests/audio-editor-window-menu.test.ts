/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly documentationId?: string;
	readonly divider?: boolean;
	readonly visibilityToggle?: boolean;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function fixture({ productId = 'soundscaper', german = false, blocked = false,
	tabs = true, workspaceRuntime = false, audio = true, projectEntries }: {
	productId?: string; german?: boolean; blocked?: boolean; tabs?: boolean;
	workspaceRuntime?: boolean; audio?: boolean;
	projectEntries?: readonly { id: string; title: string }[];
} = {}) {
	const calls: string[] = [];
	const project = { id: 'one', title: 'First project', sources: [], clips: [], tracks: [],
		selection: { trackIds: [], clipIds: [] }, loop: {}, snap: {} };
	const projects = projectEntries ?? [project, { id: 'two', title: 'Second project' }];
	const snapshot = {
		project, selectedTrackId: null,
		...(tabs ? { projectTabs: projects } : { projects }),
		preferences: {
			workspace: { activeId: 'podcast', custom: [{ id: 'podcast', name: 'Podcast' }],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: id === 'history' }])) },
			view: {},
		},
		history: {}, effects: { selectionTypes: [] },
	};
	const input = {
		productId, aboutLabel: 'About', locale: german ? 'de' : 'en',
		copy: german ? GERMAN_COPY : ENGLISH_COPY,
		capabilities: { audioEffects: audio, audioRecording: audio, audioAnalysis: audio },
		project, snapshot, blocked, editBlocked: blocked, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: true, uiFlags: { tracksPanel: true },
		actionRuntime: null,
		viewMenu: {
			setWorkspace: (id: string) => { calls.push(`workspace:${id}`); },
			togglePanel: (id: string) => { calls.push(`panel:${id}`); },
		},
		actions: new Proxy({
			switchProject: (id: string) => { calls.push(`project:${id}`); },
		} as Record<string, unknown>, { get: (target, key) => target[key as string] ?? (() => undefined) }),
	};
	const menus = (workspaceRuntime ? createWorkspaceApplicationMenus({
		...input,
		fileService: { isDesktop: false }, desktopHostRuntime: null, parityRuntime: { actions: null },
		controller: { actions: {
			project: { openById: (id: string) => { calls.push(`project:${id}`); } },
			preferences: { setWorkspace: (id: string) => { calls.push(`workspace:${id}`); } },
		} },
		run: (operation: () => unknown) => operation(),
		toggleWorkspacePanel: (id: string) => { calls.push(`panel:${id}`); },
	}) : createApplicationMenus(input)) as readonly MenuItem[];
	const window = menus.find((menu) => menu.id === 'window');
	assert.ok(window, 'the application has a Window menu');
	return { menus, window, items: window.items ?? [], calls };
}

test('Window lists projects, workspaces and panels as flat groups separated by two dividers', () => {
	const { menus, items } = fixture();
	assert.equal(menus.find((menu) => menu.id === 'view')?.items?.some((item) => item.id === 'panels'), false);
	assert.ok(items.every((item) => item.items === undefined));
	const dividers = items.flatMap((item, index) => item.divider ? [index] : []);
	assert.deepEqual(dividers, [2, 8]);
	assert.deepEqual(items.slice(0, 2).map((item) => item.label), ['First project', 'Second project']);
	assert.deepEqual(items.slice(3, 8).map((item) => item.id), [
		'workspace-modern', 'workspace-audacity', 'workspace-music', 'workspace-classic', 'workspace-podcast',
	]);
	assert.equal(items[9]?.id, 'toggle-tracks');
	assert.ok(items.some((item) => item.id === 'panel-clip-properties'));
	assert.equal(menus.at(-2)?.id, 'window');
});

test('Window marks active projects and workspaces and invokes their switching actions', () => {
	const { items, calls } = fixture();
	assert.equal(items[0]?.checked, true);
	assert.equal(items[1]?.checked, false);
	assert.equal(items.find((item) => item.id === 'workspace-podcast')?.checked, true);
	assert.equal(items.find((item) => item.id === 'workspace-podcast')?.documentationId, 'workspace-custom');
	items[1]?.onClick?.();
	items.find((item) => item.id === 'workspace-music')?.onClick?.();
	items.find((item) => item.id === 'workspace-podcast')?.onClick?.();
	assert.deepEqual(calls, ['project:two', 'workspace:music', 'workspace:podcast']);
});

test('Window preserves panel visibility indicators and toggle actions', () => {
	const { items, calls } = fixture();
	for (const [id, checked] of [['toggle-tracks', true], ['panel-project-bin', true], ['panel-history', true],
		['panel-clip-properties', false], ['show-effects', false]] as const) {
		const item = items.find((entry) => entry.id === id);
		assert.ok(item, id);
		assert.equal(item.checked, checked, id);
		assert.equal(item.visibilityToggle, true, id);
	}
	assert.equal(items.find((item) => item.id === 'show-effects')?.disabled, true);
	items.find((item) => item.id === 'panel-clip-properties')?.onClick?.();
	assert.deepEqual(calls, ['panel:clip-properties']);
});

test('Window uses the product workspace and panel availability rules', () => {
	const { items } = fixture({ productId: 'framescaper', audio: false });
	assert.deepEqual(items.filter((item) => item.id?.startsWith('workspace-')).map((item) => item.id), [
		'workspace-video-editor', 'workspace-podcast',
	]);
	for (const id of ['panel-freesound', 'panel-clip-spreadsheet', 'panel-recording-meter', 'show-effects']) {
		assert.equal(items.some((item) => item.id === id), false, id);
	}
	assert.ok(items.some((item) => item.id === 'panel-recording-setup'));
});

test('Window localizes its label and workspace names in German', () => {
	const { window, items } = fixture({ german: true });
	assert.equal(window.label, 'Fenster');
	assert.equal(items.find((item) => item.id === 'workspace-music')?.label, 'Musik');
});

test('Window disables project switching while busy and supports the projects fallback', () => {
	const { items } = fixture({ blocked: true, tabs: false });
	assert.deepEqual(items.slice(0, 2).map((item) => item.disabled), [true, true]);
});

test('Window omits a leading divider with no open projects and deduplicates project tabs', () => {
	const empty = fixture({ projectEntries: [] }).items;
	assert.equal(empty[0]?.id, 'workspace-modern');
	assert.equal(empty.filter((item) => item.divider).length, 1);
	const duplicate = fixture({ projectEntries: [
		{ id: 'one', title: 'First project' }, { id: 'one', title: 'First project' },
		{ id: '', title: 'Invalid project' },
	] }).items;
	assert.equal(duplicate.filter((item) => item.documentationId === 'window-project').length, 1);
});

test('the workspace runtime routes Window actions through the existing controller commands', () => {
	const { items, calls } = fixture({ workspaceRuntime: true });
	items[1]?.onClick?.();
	items.find((item) => item.id === 'workspace-modern')?.onClick?.();
	items.find((item) => item.id === 'panel-history')?.onClick?.();
	assert.deepEqual(calls, ['project:two', 'workspace:modern', 'panel:history']);
});
