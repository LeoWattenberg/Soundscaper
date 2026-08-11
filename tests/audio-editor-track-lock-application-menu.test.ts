/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { SEQUENCE_TIMING_COPY_BY_LOCALE } from '../src/common/i18n/sequence-timing-copy.js';

test('both products compose selected-track Lock and Unlock with exact update ports', () => {
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		for (const type of ['audio', 'video', 'label'] as const) {
			for (const locked of [false, true]) {
				const calls: unknown[] = [];
				const menus = createApplicationMenus(menuInput({
					productId, type, locked, editBlocked: false,
					actions: actionPorts({
						setTrackLocked: (trackId: string, next: boolean) => {
							calls.push({ trackId, locked: next });
						},
					}),
				}));
				const item = trackLockItem(menus);
				assert.deepEqual({ id: item.id, label: item.label, disabled: item.disabled }, {
					id: 'track-lock-toggle',
					label: locked ? 'Unlock track' : 'Lock track',
					disabled: false,
				});
				item.onClick?.();
				assert.deepEqual(calls, [{ trackId: `${type}-track`, locked: !locked }]);
			}
		}
	}
});

test('no selection and blocked editing retain one disabled Tracks-menu item', () => {
	const actions = actionPorts({ setTrackLocked: () => assert.fail('disabled item dispatched') });
	const missing = trackLockItem(createApplicationMenus(menuInput({
		productId: 'soundscaper', type: 'audio', locked: false, editBlocked: false,
		selectedTrackId: null, actions,
	})));
	assert.equal(missing.label, 'Lock track');
	assert.equal(missing.disabled, true);
	missing.onClick?.();

	const blocked = trackLockItem(createApplicationMenus(menuInput({
		productId: 'framescaper', type: 'video', locked: true, editBlocked: true, actions,
	})));
	assert.equal(blocked.label, 'Unlock track');
	assert.equal(blocked.disabled, true);
	blocked.onClick?.();
});

test('workspace runtime dispatches the existing exact track.update command port', () => {
	const calls: unknown[] = [];
	const input = menuInput({
		productId: 'soundscaper', type: 'label', locked: false, editBlocked: false,
		actions: actionPorts({}),
	});
	const runtime = new Proxy({
		...input,
		controller: {
			actions: {
				track: { update: (trackId: string, changes: unknown) => calls.push({ trackId, changes }) },
			},
		},
		fileService: { isDesktop: false },
		parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
	trackLockItem(createWorkspaceApplicationMenus(
		runtime as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0],
	)).onClick?.();
	assert.deepEqual(calls, [{ trackId: 'label-track', changes: { locked: true } }]);
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

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function trackLockItem(value: unknown): MenuItem {
	const menus = value as readonly MenuItem[];
	const tracks = menus.find(({ id }) => id === 'tracks');
	const item = tracks?.items?.find(({ id }) => id === 'track-lock-toggle');
	assert.ok(item);
	return item;
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
	return new Proxy({ lockTrack: 'Lock track', unlockTrack: 'Unlock track' }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
