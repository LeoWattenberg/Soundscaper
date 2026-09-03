/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('Tracks exposes Mix & Render directly and opens its dedicated surface', () => {
	const opened: unknown[] = [];
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		openSurface: (surface: unknown) => { opened.push(surface); },
	})) as readonly MenuItem[];
	const tracks = topLevelMenu(menus, 'tracks');
	const item = tracks.items?.find(({ id }) => id === 'mix-render');
	assert.ok(item);
	assert.equal(item.label, 'Mix & Render');
	assert.equal(item.disabled, false);
	assert.equal(tracks.items?.some(({ id }) => id === 'mix'), false);
	assert.equal(findMenuItem(menus, 'mixdown-to'), null);

	item.onClick?.();
	assert.deepEqual(opened, ['mix-render']);
});

test('Mix & Render follows edit and audio selection availability', () => {
	const blocked = menuItem(createWorkspaceApplicationMenus(workspaceInput({ editBlocked: true })), 'mix-render');
	assert.equal(blocked.disabled, true);
	assert.equal(blocked.onClick, undefined);

	const empty = menuItem(createWorkspaceApplicationMenus(workspaceInput({
		project: project({ withClip: false }),
		snapshot: snapshot(project({ withClip: false })),
	})), 'mix-render');
	assert.equal(empty.disabled, true);
	assert.equal(empty.onClick, undefined);
});

test('Framescaper filters the audio-only Mix & Render surface', () => {
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		productId: 'framescaper',
		capabilities: { audioEffects: false },
	}));
	assert.equal(findMenuItem(menus as readonly MenuItem[], 'mix-render'), null);
});

test('the Mix & Render dialog stays behind its menu-only lazy surface', async () => {
	const overlays = await readFile(new URL(
		'../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx',
		import.meta.url,
	), 'utf8');
	assert.match(overlays, /lazyEditorModule\(\(\) => import\('\.\.\/dialogs\/MixRenderDialog\.tsx'\)\)/u);
	assert.match(overlays, /capabilities\.audioEffects && activeSurface === 'mix-render'/u);
	assert.match(overlays, /data-editor-surface="mix-render"/u);
	assert.doesNotMatch(overlays, /import MixRenderDialog from/u);
});

function workspaceInput(overrides: Readonly<Record<string, unknown>> = {}) {
	const value = project({ withClip: true });
	const baseSnapshot = snapshot(value);
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: { audioEffects: true }, locale: 'en',
		copy: copyValues(), project: value, snapshot: baseSnapshot,
		selectedAudioTrack: value.tracks[0],
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 20,
		projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		actions: actionPorts(), run: (operation: () => unknown) => operation(),
		openSurface: () => undefined,
		...overrides,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? (() => undefined),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}

function project({ withClip }: Readonly<{ withClip: boolean }>) {
	const clipIds = withClip ? ['clip-a'] : [];
	return {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: withClip ? [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}] : [],
		tracks: [{ id: 'track-a', type: 'audio', clipIds, effects: [] }],
		selection: { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
}

function snapshot(value: ReturnType<typeof project>) {
	return {
		project: value, selectedTrackId: 'track-a',
		preferences: { workspace: {
			activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
		}, view: {} },
		history: { canUndo: false, canRedo: false, hasClipboard: false },
		effects: { selectionTypes: [], canRepeatLast: false },
	};
}

function actionPorts(): object {
	return new Proxy({}, { get: () => () => undefined });
}

function copyValues(): object {
	return new Proxy({ mixRenderTitle: 'Mix & Render' }, {
		get: (target, property) => Reflect.get(target, property) ?? String(property),
	});
}

function topLevelMenu(menus: readonly MenuItem[], id: string): MenuItem {
	const menu = menus.find((candidate) => candidate.id === id);
	assert.ok(menu, `Missing top-level menu ${id}.`);
	return menu;
}

function menuItem(values: unknown, id: string): MenuItem {
	const item = findMenuItem(values as readonly MenuItem[], id);
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
