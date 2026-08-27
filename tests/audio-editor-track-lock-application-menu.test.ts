/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { SEQUENCE_TIMING_COPY_BY_LOCALE } from '../src/common/i18n/sequence-timing-copy.js';

test('the application menubar no longer duplicates the per-track lock command', () => {
	const menus = createApplicationMenus(menuInput({
		productId: 'soundscaper', type: 'audio', locked: false, editBlocked: false,
		actions: actionPorts({}),
	})) as readonly MenuItem[];
	const tracks = menus.find(({ id }) => id === 'tracks');
	assert.ok(tracks);
	assert.equal(findMenuItemOrNull(tracks.items ?? [], 'track-lock-toggle'), null);
});

test('read-only projects retain Scape copy export while busy projects block it', () => {
	const readOnlyMenus = createApplicationMenus({
		...menuInput({
			productId: 'framescaper', type: 'video', locked: false, editBlocked: true,
			actions: actionPorts({}),
		}),
		blocked: true,
		snapshot: {
			...menuInput({
				productId: 'framescaper', type: 'video', locked: false, editBlocked: true,
				actions: actionPorts({}),
			}).snapshot,
			readOnly: true,
		},
	});
	assert.equal(scapeSaveItem(readOnlyMenus).disabled, false);
	assert.equal(scapeSaveItem(createApplicationMenus({
		...menuInput({
			productId: 'soundscaper', type: 'audio', locked: false, editBlocked: true,
			actions: actionPorts({}),
		}),
		blocked: true,
	})).disabled, true);
});

test('shared track-lock copy is localized for both shipped locales', () => {
	assert.deepEqual({
		lockTrack: SEQUENCE_TIMING_COPY_BY_LOCALE.en.lockTrack,
		unlockTrack: SEQUENCE_TIMING_COPY_BY_LOCALE.en.unlockTrack,
	}, { lockTrack: 'Lock track', unlockTrack: 'Unlock track' });
	assert.deepEqual({
		lockTrack: SEQUENCE_TIMING_COPY_BY_LOCALE.de.lockTrack,
		unlockTrack: SEQUENCE_TIMING_COPY_BY_LOCALE.de.unlockTrack,
	}, { lockTrack: 'Spur sperren', unlockTrack: 'Spur entsperren' });
});

test('exact product menus disable cross-product editing until an admitted carrier exists', () => {
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const unavailable = findMenuItem(createApplicationMenus({
			...menuInput({
				productId, type: productId === 'framescaper' ? 'video' : 'audio',
				locked: false, editBlocked: false, actions: actionPorts({}),
			}),
			crossProductHandoffAvailable: false,
		}) as readonly MenuItem[], 'switch-product');
		const projectExtension = productId === 'framescaper' ? '.fscape' : '.sscape';
		assert.equal(unavailable.disabled, true);
		assert.equal(unavailable.disabledReason, `Cross-product editing is unavailable for this project format. Export a ${projectExtension} file to preserve a copy.`);
		assert.equal(
			findMenuItem(createApplicationMenus({
				...menuInput({
					productId, type: productId === 'framescaper' ? 'video' : 'audio',
					locked: false, editBlocked: false, actions: actionPorts({}),
				}),
				crossProductHandoffAvailable: false,
			}) as readonly MenuItem[], 'save-scape').label,
			`Export project file (${projectExtension})`,
		);

		const available = findMenuItem(createApplicationMenus({
			...menuInput({
				productId, type: productId === 'framescaper' ? 'video' : 'audio',
				locked: false, editBlocked: false, actions: actionPorts({}),
			}),
			crossProductHandoffAvailable: true,
		}) as readonly MenuItem[], 'switch-product');
		assert.equal(available.disabled, false);
		assert.equal(available.disabledReason, undefined);
	}
});

test('Tracks menu exposes every implemented structural operation without new default chrome', () => {
	const called: string[] = [];
	const handlers = Object.fromEntries([
		'alignEndToEnd', 'alignTogether', 'alignStartToZero', 'alignStartToPlayhead',
		'alignStartToSelectionEnd', 'alignEndToPlayhead', 'alignEndToSelectionEnd',
		'sortByTime', 'sortByName', 'muteAll', 'unmuteAll', 'openAlignMenu', 'openSortMenu',
	].map((id) => [id, () => { called.push(id); }]));
	const menus = createApplicationMenus({
		...menuInput({
			productId: 'soundscaper', type: 'audio', locked: false, editBlocked: false,
			actions: actionPorts({}),
		}),
		actionRuntime: { track: handlers },
	});
	const ids = [
		'mute-all', 'unmute-all', 'align-end-to-end', 'align-together', 'align-start-to-zero',
		'align-start-to-playhead', 'align-start-to-selection-end', 'align-end-to-playhead',
		'align-end-to-selection-end', 'sort-by-time', 'sort-by-name',
	];
	for (const id of ids) {
		const item = findMenuItem(menus as readonly MenuItem[], id);
		assert.equal(item.parityStatus, 'implemented', id);
		assert.equal(item.disabled, false, id);
		item.onClick?.();
	}
	assert.deepEqual(called, [
		'muteAll', 'unmuteAll', 'alignEndToEnd', 'alignTogether', 'alignStartToZero',
		'alignStartToPlayhead', 'alignStartToSelectionEnd', 'alignEndToPlayhead',
		'alignEndToSelectionEnd', 'sortByTime', 'sortByName',
	]);
});

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly disabledReason?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
	readonly parityStatus?: unknown;
}

function findMenuItem(items: readonly MenuItem[], id: string): MenuItem {
	for (const item of items) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItemOrNull(item.items, id) : null;
		if (nested) return nested;
	}
	assert.fail(`Missing menu item ${id}.`);
}

function findMenuItemOrNull(items: readonly MenuItem[], id: string): MenuItem | null {
	for (const item of items) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItemOrNull(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function scapeSaveItem(value: unknown): MenuItem {
	const menus = value as readonly MenuItem[];
	const file = menus.find(({ id }) => id === 'file');
	assert.ok(file);
	const materialized = materializeApplicationMenu(file);
	const item = materialized.items?.find(({ id }) => id === 'save-scape');
	assert.ok(item);
	return item as MenuItem;
}

function menuInput({
	productId,
	type,
	locked,
	editBlocked,
	selectedTrackId = `${type}-track`,
	actions,
}: Readonly<{
	productId: 'soundscaper' | 'framescaper';
	type: 'audio' | 'video' | 'label';
	locked: boolean;
	editBlocked: boolean;
	selectedTrackId?: string | null;
	actions: object;
}>) {
	const track = { id: `${type}-track`, type, locked, clipIds: [], hidden: false };
	return {
		productId,
		aboutLabel: 'About',
		capabilities: {},
		locale: 'en',
		copy: copyValues(),
		project: {
			id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [track],
			selection: null, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		},
		snapshot: {
			selectedTrackId,
			preferences: {
				workspace: {
					activeId: type === 'video' ? 'video-editor' : 'editing',
					custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: null,
		playheadSample: 0,
		durationFrames: 0,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions,
	};
}

function actionPorts(overrides: Readonly<Record<string, unknown>>): object {
	return new Proxy({ ...overrides }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
}

function copyValues(): object {
	return new Proxy({
		lockTrack: 'Lock track',
		unlockTrack: 'Unlock track',
		crossProductHandoffUnavailable: 'Cross-product editing is unavailable for this project format. Export a {projectExtension} file to preserve a copy.',
		saveScape: 'Export project file ({projectExtension})',
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
