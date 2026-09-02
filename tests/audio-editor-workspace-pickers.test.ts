/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { workspaceSwitcherOptions } from '../src/common/editor/ui/workspace/workspace-switcher-options.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const ROOT = new URL('../', import.meta.url);

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly checked?: boolean;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
}

test('the workspace switcher options list every Soundscaper preset in order and append custom workspaces', () => {
	assert.deepEqual(workspaceSwitcherOptions('soundscaper', ENGLISH_COPY), [
		{ id: 'modern', name: 'Soundscaper' },
		{ id: 'audacity', name: 'Audacity' },
		{ id: 'music', name: 'Music' },
		{ id: 'classic', name: 'Classic' },
	]);
	assert.deepEqual(workspaceSwitcherOptions('soundscaper', GERMAN_COPY).map((option) => option.name), [
		'Soundscaper', 'Audacity', 'Musik', 'Klassisch',
	]);
	assert.deepEqual(workspaceSwitcherOptions('framescaper', ENGLISH_COPY), [
		{ id: 'video-editor', name: 'Video editor' },
	]);
	assert.deepEqual(workspaceSwitcherOptions('soundscaper', ENGLISH_COPY, [
		{ id: 'custom-1', name: 'Podcast', layout: {} },
	]), [
		{ id: 'modern', name: 'Soundscaper' },
		{ id: 'audacity', name: 'Audacity' },
		{ id: 'music', name: 'Music' },
		{ id: 'classic', name: 'Classic' },
		{ id: 'custom-1', name: 'Podcast' },
	]);
	assert.deepEqual(workspaceSwitcherOptions('framescaper', ENGLISH_COPY, [{ id: 'cut', name: 'Cut' }]).map((option) => option.id), [
		'video-editor', 'cut',
	]);
});

test('the lifecycle hook and the brand sidebar source their workspace lists from the shared helper', async () => {
	const lifecycle = await readFile(new URL('src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js', ROOT), 'utf8');
	assert.match(lifecycle, /workspaceSwitcherOptions\(productId, copy, preferences\?\.workspace\?\.custom\)/u);
	assert.doesNotMatch(lifecycle, /\{ id: 'modern', name: copy\.workspaceModern \}/u);
	const sidebar = await readFile(new URL('src/common/site/BrandSidebar.jsx', ROOT), 'utf8');
	assert.match(sidebar, /\{ id: 'audacity', name: copy\.workspaceAudacity \}/u);
	assert.match(sidebar, /workspaceAudacity: catalog\.workspaceAudacity/u);
	const dialog = await readFile(new URL('src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx', ROOT), 'utf8');
	assert.match(dialog, /\{ value: 'audacity', label: copy\.workspaceAudacity \}/u);
});

test('the View menu offers the Audacity preset and the workspace onboarding to Soundscaper only', () => {
	const opened: string[] = [];
	const switched: string[] = [];
	const soundscaper = filterProductMenus(createApplicationMenus(menuInput('soundscaper', {
		openWorkspaceOnboarding: () => opened.push('workspace-onboarding'),
		setWorkspace: (id: string) => switched.push(id),
	})), {}, 'soundscaper');
	const preset = findMenuItem(soundscaper, 'workspace-preset');
	assert.ok(preset?.items);
	assert.deepEqual(preset.items.map((item) => item.id), [
		'workspace-modern', 'workspace-audacity', 'workspace-music', 'workspace-classic', 'workspace-custom-1', 'workspace-onboarding',
	]);
	assert.equal(findMenuItem(soundscaper, 'workspace-modern')?.label, 'Soundscaper');
	assert.equal(findMenuItem(soundscaper, 'workspace-modern')?.checked, true);
	const audacity = findMenuItem(soundscaper, 'workspace-audacity');
	assert.equal(audacity?.label, 'Audacity');
	assert.equal(audacity?.checked, false);
	audacity?.onClick?.();
	assert.deepEqual(switched, ['audacity']);
	const onboarding = findMenuItem(soundscaper, 'workspace-onboarding');
	assert.equal(onboarding?.label, 'Set up workspace');
	assert.equal(onboarding?.checked, undefined);
	onboarding?.onClick?.();
	assert.deepEqual(opened, ['workspace-onboarding']);

	const framescaper = filterProductMenus(createApplicationMenus(menuInput('framescaper', {})), {}, 'framescaper');
	const framescaperPreset = findMenuItem(framescaper, 'workspace-preset');
	assert.ok(framescaperPreset?.items);
	assert.deepEqual(framescaperPreset.items.map((item) => item.id), ['workspace-video-editor', 'workspace-custom-1']);
	assert.equal(findMenuItem(framescaper, 'workspace-audacity'), null);
	assert.equal(findMenuItem(framescaper, 'workspace-onboarding'), null);
});

test('the menu runtime routes the onboarding item to its editor surface', async () => {
	const runtime = await readFile(new URL('src/common/editor/ui/workspace/workspace-application-menu-runtime.js', ROOT), 'utf8');
	assert.match(runtime, /openWorkspaceOnboarding: \(\) => openSurface\('workspace-onboarding'\)/u);
});

function findMenuItem(values: readonly unknown[], id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function menuInput(productId: string, actions: Record<string, unknown>) {
	return {
		productId, aboutLabel: 'About', capabilities: {}, locale: 'en', copy: ENGLISH_COPY,
		project: null,
		snapshot: {
			project: null, selectedTrackId: null, deliveryReport: null,
			preferences: { workspace: {
				activeId: productId === 'framescaper' ? 'video-editor' : 'modern',
				custom: [{ id: 'custom-1', name: 'Podcast' }],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({ ...actions }, {
			get: (target, property, receiver) => Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined,
		}),
	};
}
