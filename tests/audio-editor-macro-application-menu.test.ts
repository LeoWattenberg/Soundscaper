/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

const RESTORATION = Object.freeze({
	id: 'macro-restoration',
	name: 'Restoration',
	effects: Object.freeze([
		Object.freeze({ id: 'clicks', type: 'audacity-click-removal', params: Object.freeze({}) }),
		Object.freeze({ id: 'noise', type: 'audacity-noise-reduction', params: Object.freeze({}) }),
	]),
});
const FADE_ENDS = Object.freeze({
	id: 'macro-fade-ends',
	name: 'Fade ends',
	effects: Object.freeze([
		Object.freeze({ id: 'fade', type: 'audacity-fade-out', params: Object.freeze({}) }),
	]),
});

test('Tools > Macros mirrors the Macro Manager library without disabled placeholders', () => {
	const menus = createWorkspaceApplicationMenus(workspaceInput()) as readonly MenuItem[];
	const macros = menuItem(menus, 'macro-library');

	assert.equal(macros.label, 'Macros');
	assert.deepEqual(macros.items?.map(({ label }) => label), ['Restoration', 'Fade ends']);
	for (const placeholder of ['apply-macros-palette', 'macro-fade-ends', 'macro-mp3-conversion', 'menu-macros']) {
		assert.equal(findMenuItem(menus, placeholder), null, placeholder);
	}
});

test('a saved macro menu item runs the same library record exposed by Macro Manager', async () => {
	const runs: unknown[] = [];
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		controller: controller((macro) => {
			runs.push(macro);
			return Promise.resolve(true);
		}),
	})) as readonly MenuItem[];
	const fadeEnds = menuItem(menus, 'macro-library:macro-fade-ends');

	assert.equal(fadeEnds.disabled, false);
	await fadeEnds.onClick?.();
	assert.deepEqual(runs, [FADE_ENDS]);
});

test('Macros follows library additions and is absent from products without audio macros', () => {
	const custom = Object.freeze({
		id: 'macro-custom', name: 'Podcast cleanup',
		effects: Object.freeze([Object.freeze({ id: 'normalize', type: 'audacity-normalize', params: Object.freeze({}) })]),
	});
	const soundscaper = createWorkspaceApplicationMenus(workspaceInput({
		snapshot: snapshot([RESTORATION, FADE_ENDS, custom]),
	})) as readonly MenuItem[];
	assert.deepEqual(menuItem(soundscaper, 'macro-library').items?.map(({ label }) => label), [
		'Restoration', 'Fade ends', 'Podcast cleanup',
	]);

	const framescaper = createWorkspaceApplicationMenus(workspaceInput({
		productId: 'framescaper', capabilities: { audioMacros: false },
	})) as readonly MenuItem[];
	assert.equal(findMenuItem(framescaper, 'macro-library'), null);
});

function workspaceInput(overrides: Readonly<Record<string, unknown>> = {}) {
	const value = project();
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: { audioMacros: true }, locale: 'en',
		copy: copyValues(), project: value, snapshot: snapshot([RESTORATION, FADE_ENDS]),
		selectedAudioTrack: value.tracks[0],
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 20,
		projectBinEffectivelyOpen: false, uiFlags: {},
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		controller: controller(() => Promise.resolve(true)),
		actions: new Proxy({}, { get: () => () => undefined }),
		run: (operation: () => unknown) => operation(), openSurface: () => undefined,
		...overrides,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? (() => undefined),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}

function controller(runMacro: (macro: unknown) => Promise<unknown>) {
	return {
		actions: new Proxy({ macros: { run: runMacro } }, { get: (target, property) => (
			Reflect.get(target, property) ?? new Proxy({}, { get: () => () => undefined })
		) }),
	};
}

function project() {
	return {
		id: 'project', sampleRate: 48_000, sources: [], clips: [],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: [], effects: [] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
}

function snapshot(macros: readonly unknown[]) {
	const value = project();
	return {
		project: value, selectedTrackId: 'track-a', readOnly: false,
		preferences: { workspace: {
			activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
		}, view: {} },
		history: { canUndo: false, canRedo: false, hasClipboard: false },
		effects: { selectionTypes: [], canRepeatLast: false },
		macros: { library: macros, scripts: [] },
	};
}

function copyValues(): object {
	return new Proxy({ macros: 'Macros' }, {
		get: (target, property) => Reflect.get(target, property) ?? String(property),
	});
}

function menuItem(values: readonly MenuItem[], id: string): MenuItem {
	const item = findMenuItem(values, id);
	assert.ok(item, `Missing menu item ${id}.`);
	return item;
}

function findMenuItem(values: readonly MenuItem[], id: string): MenuItem | null {
	for (const value of values) {
		if (value.id === id) return value;
		const nested = value.items ? findMenuItem(value.items, id) : null;
		if (nested) return nested;
	}
	return null;
}
