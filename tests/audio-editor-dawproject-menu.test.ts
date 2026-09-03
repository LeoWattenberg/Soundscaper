/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createDawprojectMenu } from '../src/common/editor/ui/dawproject-menu.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

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

function submenu(menus: readonly unknown[]): MenuItem {
	const entry = fileMenu(menus).items?.find((item) => item.id === 'dawproject');
	assert.ok(entry, 'File holds the DAWproject submenu');
	return entry;
}

test('both locales carry every DAWproject menu and status string', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of [
			'dawprojectMenu', 'openDawproject', 'saveDawproject', 'dawprojectReport',
			'chooseDawprojectFile', 'dawprojectOpened', 'dawprojectSaving', 'dawprojectSaved',
		]) {
			assert.equal(typeof copy[key], 'string', `${key} is missing`);
			assert.ok((copy[key] as string).length > 0, `${key} is empty`);
		}
	}
});

test('the File menu reaches open, export and the report through one DAWproject submenu beside the Audacity one', () => {
	const calls: string[] = [];
	const menus = createApplicationMenus(menuInput(null, {
		openDawproject: () => { calls.push('open'); },
		saveDawproject: () => { calls.push('save'); },
		openDeliveryReport: () => { calls.push('report'); },
	})) as unknown[];
	const items = fileMenu(menus).items!;
	const audacityIndex = items.findIndex((item) => item.id === 'audacity-projects');
	assert.equal(items[audacityIndex + 1]?.id, 'dawproject', 'the submenu follows the Audacity projects submenu');
	const entry = submenu(menus);
	assert.equal(entry.label, ENGLISH_COPY.dawprojectMenu);
	assert.deepEqual(entry.items?.map((item) => item.id), ['open-dawproject', 'save-dawproject', 'dawproject-report']);
	assert.deepEqual(entry.items?.map((item) => item.label), [
		ENGLISH_COPY.openDawproject, ENGLISH_COPY.saveDawproject, ENGLISH_COPY.dawprojectReport,
	]);
	(entry.items?.[0]?.onClick as () => void)();
	(entry.items?.[1]?.onClick as () => void)();
	assert.deepEqual(calls, ['open', 'save']);
});

test('the report entry is enabled only while the report on hand is a DAWproject one', () => {
	const opened: string[] = [];
	const actions = { openDeliveryReport: () => { opened.push('report'); } };
	const without = submenu(createApplicationMenus(menuInput(null, actions)) as unknown[]);
	assert.equal(without.items?.[2]?.disabled, true);
	const foreign = submenu(createApplicationMenus(menuInput({ subject: { format: 'otio' } }, actions)) as unknown[]);
	assert.equal(foreign.items?.[2]?.disabled, true, 'an OTIO report is not shown under the DAWproject name');
	const own = submenu(createApplicationMenus(menuInput({ subject: { format: 'dawproject' } }, actions)) as unknown[]);
	assert.equal(own.items?.[2]?.disabled, false);
	(own.items?.[2]?.onClick as () => void)();
	assert.deepEqual(opened, ['report']);
});

test('the submenu is blocked with the rest of the File menu while the editor is busy', () => {
	const entry = createDawprojectMenu({
		copy: ENGLISH_COPY, blocked: true, snapshot: { deliveryReport: { subject: { format: 'dawproject' } } }, actions: {},
	});
	assert.equal(entry.disabled, true);
	assert.deepEqual(entry.items.map((item) => item.disabled), [true, true, false]);
});
