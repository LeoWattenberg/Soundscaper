/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const ROOT = new URL('../', import.meta.url);

type MenuItem = Record<string, unknown> & { items?: MenuItem[] };

function menuInput(deliveryReport: unknown, actions: Record<string, unknown>) {
	const project = {
		id: 'project', sampleRate: 48_000, sources: [], clips: [],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: [], effects: [] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	return {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: ENGLISH_COPY, project,
		snapshot: {
			project, selectedTrackId: 'track-a', deliveryReport,
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 100,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({ ...actions }, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	};
}

function fileMenu(menus: readonly unknown[]): MenuItem {
	const file = (menus as MenuItem[]).find((menu) => menu.id === 'file');
	assert.ok(file, 'the File menu exists');
	return file;
}

function submenu(menus: readonly unknown[], id: string): MenuItem {
	const entry = fileMenu(menus).items?.find((item) => item.id === id);
	assert.ok(entry, `File holds the ${id} submenu`);
	return entry;
}

test('both locales carry every DAWproject status string, and none of the retired submenu labels', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of [
			'saveDawproject', 'chooseDawprojectFile', 'dawprojectOpened', 'dawprojectSaving', 'dawprojectSaved',
		]) {
			assert.equal(typeof copy[key], 'string', `${key} is missing`);
			assert.ok((copy[key] as string).length > 0, `${key} is empty`);
		}
		for (const key of ['dawprojectMenu', 'openDawproject', 'dawprojectReport']) {
			assert.equal(copy[key], undefined, `${key} outlived the submenu it labelled`);
		}
	}
});

test('the File menu holds no DAWproject category, and the export sits in the Export other bucket', () => {
	const calls: string[] = [];
	const menus = createApplicationMenus(menuInput(null, {
		saveDawproject: () => { calls.push('save'); },
	})) as unknown[];
	const items = fileMenu(menus).items!;
	assert.equal(items.find((item) => item.id === 'dawproject'), undefined, 'the DAWproject submenu is gone');
	const exportOther = submenu(menus, 'export-other');
	const entry = exportOther.items?.find((item) => item.id === 'export-dawproject');
	assert.ok(entry, 'Export other offers the DAWproject export');
	assert.equal(entry.label, ENGLISH_COPY.saveDawproject);
	assert.equal(entry.disabled, false);
	(entry.onClick as () => void)();
	assert.deepEqual(calls, ['save']);
});

test('the delivery report answers for every profile from the File menu itself', () => {
	const opened: string[] = [];
	const actions = { openDeliveryReport: () => { opened.push('report'); } };
	const audacity = submenu(createApplicationMenus(menuInput(null, actions)) as unknown[], 'audacity-projects');
	assert.equal(
		audacity.items?.find((item) => item.id === 'delivery-report'), undefined,
		'a DAWproject delivery no longer reports itself under the Audacity projects name',
	);
	const without = fileMenu(createApplicationMenus(menuInput(null, actions)) as unknown[])
		.items!.find((item) => item.id === 'delivery-report');
	assert.equal(without?.disabled, true);
	const own = fileMenu(createApplicationMenus(menuInput({ subject: { format: 'dawproject' } }, actions)) as unknown[])
		.items!.find((item) => item.id === 'delivery-report');
	assert.equal(own?.disabled, false, 'a DAWproject report opens like any other');
	(own?.onClick as () => void)();
	assert.deepEqual(opened, ['report']);
});

test('the ordinary Open command takes a .dawproject file', async () => {
	assert.deepEqual(
		partitionWorkspaceFiles([{ name: 'exchange.dawproject' }]).projects.map((file) => file.name),
		['exchange.dawproject'],
		'a dropped DAWproject is classified as a project, not as media',
	);
	const view = await readFile(new URL('src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx', ROOT), 'utf8');
	const openInput = view.slice(view.indexOf('data-aup4-input'));
	assert.match(openInput.slice(0, openInput.indexOf('/>')), /accept=\{`[^`]*\.dawproject/u);
	const workspace = await readFile(new URL('src/common/editor/ui/workspace/AudioEditorWorkspace.jsx', ROOT), 'utf8');
	assert.match(workspace, /\/\\\.dawproject\$\/iu\.test\(file\?\.name \|\| ''\) \? controller\.actions\.project\.openDawproject\(file\)/u);
	const menus = await readFile(new URL('src/common/editor/ui/application-menus.js', ROOT), 'utf8');
	assert.match(menus, /id: 'open-project', label: copy\.open, shortcut: 'Ctrl\+O'/u);
	assert.doesNotMatch(menus, /dawproject-menu\.js/u);
});
