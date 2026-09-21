/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createAudioEditorSearchEntries } from '../src/common/editor/search.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PROJECT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onClick?: () => void;
	readonly items?: readonly MenuItem[];
}

function findMenuItem(items: readonly MenuItem[], id: string): MenuItem | undefined {
	for (const item of items) {
		if (item.id === id) return item;
		const nested = item.items && findMenuItem(item.items, id);
		if (nested) return nested;
	}
	return undefined;
}

function menuInput({
	productId = 'soundscaper',
	copy = ENGLISH_COPY,
	blocked = false,
	actions = {},
}: {
	productId?: string;
	copy?: typeof ENGLISH_COPY;
	blocked?: boolean;
	actions?: Readonly<Record<string, () => void>>;
} = {}) {
	return {
		productId, copy, aboutLabel: 'About', capabilities: {}, locale: 'en',
		project: null,
		snapshot: {
			project: null, selectedTrackId: null, deliveryReport: null,
			featureRequirementsCompatibility: {
				compatible: false,
				items: [{ availability: 'unavailable', disposition: 'bypassed' }],
			},
			aup4Compatibility: {
				report: {
					counts: { converted: 0, missing: 1, omitted: 0 },
					items: [{ status: 'missing', label: 'Missing effect' }],
				},
				dismissed: false,
			},
			preferences: createAudioEditorPreferencesV1(),
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked, editBlocked: blocked, handoffBlocked: blocked,
		showArmControls: false, selectionActive: false, selectedClip: null,
		durationFrames: 0, effectsPanelOpen: false, projectBinEffectivelyOpen: false,
		uiFlags: {}, actionRuntime: null,
		actions: new Proxy(actions, {
			get: (target, property, receiver) => Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined,
		}),
	};
}

test('File Open is the only Audacity project import command and dispatches the shared picker', () => {
	const calls: string[] = [];
	const menus = createApplicationMenus(menuInput({ actions: {
		openFile: () => { calls.push('open'); },
		openAup4: () => { calls.push('aup4'); },
		openLegacyAup: () => { calls.push('legacy'); },
	} }));
	const file = findMenuItem(menus, 'file');
	const open = file?.items?.find((item) => item.id === 'open-project');
	assert.ok(open);
	assert.equal(open.disabled, false);
	open.onClick?.();
	assert.deepEqual(calls, ['open']);
	for (const id of ['audacity-projects', 'open-aup4', 'open-legacy-aup']) {
		assert.equal(findMenuItem(menus, id), undefined, `${id} should not be a separate command`);
	}
	for (const extension of ['.aup', '.aup3', '.aup4']) {
		assert.ok(WORKSPACE_PROJECT_FILE_ACCEPT.split(',').includes(extension));
	}
});

test('AUP4 export is localized under File Export other and invokes its existing action', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		let exported = 0;
		const menus = createApplicationMenus(menuInput({ copy, actions: {
			saveAup4: () => { exported += 1; },
		} }));
		const other = findMenuItem(menus, 'file')?.items?.find((item) => item.id === 'export-other');
		const exportItem = other?.items?.find((item) => item.id === 'save-aup4');
		assert.ok(exportItem);
		assert.equal(exportItem.label, copy.saveAsAup4);
		assert.equal(exportItem.disabled, false);
		exportItem.onClick?.();
		assert.equal(exported, 1);
		assert.equal(findMenuItem(menus, 'file')?.items?.find((item) => item.id === 'save-aup4'), undefined);
	}
});

test('Audacity Open and export retain their blocking and product availability', () => {
	const blocked = createApplicationMenus(menuInput({ blocked: true }));
	assert.equal(findMenuItem(blocked, 'open-project')?.disabled, true);
	assert.equal(findMenuItem(blocked, 'save-aup4')?.disabled, true);
	const framescaper = createApplicationMenus(menuInput({ productId: 'framescaper' }));
	assert.ok(findMenuItem(framescaper, 'open-project'));
	assert.equal(findMenuItem(framescaper, 'save-aup4'), undefined);
});

test('populated compatibility reports add no permanent menu or command search entries', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const menus = createApplicationMenus(menuInput({ productId }));
		for (const id of ['project-compatibility-report', 'aup4-compatibility-report']) {
			assert.equal(findMenuItem(menus, id), undefined);
		}
		const commands = createAudioEditorSearchEntries({ menus });
		for (const label of ['Project compatibility report', ENGLISH_COPY.aup4CompatibilityReport]) {
			assert.equal(commands.some((entry) => entry.label === label), false);
		}
	}
});

test('obsolete Audacity finder placeholders are absent from the Analyze menu', () => {
	const input = menuInput();
	const menus = createApplicationMenus({
		...input,
		capabilities: { ...input.capabilities, audioAnalysis: true },
	});
	for (const id of ['local://silence-finder', 'local://sound-finder']) {
		assert.equal(findMenuItem(menus, id), undefined, id);
	}
});
