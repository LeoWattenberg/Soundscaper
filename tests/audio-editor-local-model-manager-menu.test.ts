/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

test('Tools reaches Local Models in both desktops and omits it in the browser', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const opened: string[] = [];
		const desktopMenus = createWorkspaceApplicationMenus(workspaceMenuInput(
			productId, true, (surface) => opened.push(surface),
		));
		const tools = (desktopMenus as readonly MenuItem[]).find(({ id }) => id === 'tools');
		const manage = findMenuItem(tools?.items ?? [], 'manage-local-models');
		assert.equal(manage?.label, 'Model Manager…');
		manage?.onClick?.();
		assert.deepEqual(opened, ['local-models']);
		assert.equal(findMenuItem(
			createWorkspaceApplicationMenus(workspaceMenuInput(productId, false, () => undefined)),
			'local-models',
		), null);
	}
});

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
}

function findMenuItem(values: unknown, id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function workspaceMenuInput(
	productId: string,
	isDesktop: boolean,
	openSurface: (surface: string) => void,
) {
	return {
		aboutLabel: 'About',
		aup4InputRef: { current: null },
		blocked: false,
		capabilities: {},
		controller: { actions: {} },
		copy: ENGLISH_COPY,
		crossProductHandoffAvailable: false,
		desktopHostRuntime: null,
		durationFrames: 0,
		editBlocked: false,
		handoffBlocked: false,
		executeEdit: () => undefined,
		fileService: { isDesktop },
		importInputRef: { current: null },
		legacyAupInputRef: { current: null },
		locale: 'en',
		openDesktopFiles: () => undefined,
		openEffects: () => undefined,
		openExternal: () => undefined,
		openGenerator: () => undefined,
		openProjects: () => undefined,
		openRecordingOffset: () => undefined,
		openSelectionEffect: () => undefined,
		openSpectralSelection: () => undefined,
		openSurface,
		openTimedRecording: () => undefined,
		openWorkspacePanel: () => undefined,
		parityRuntime: { actions: { timeline: {}, help: {} } },
		productId,
		project: null,
		projectBinEffectivelyOpen: false,
		recordLabel: 'Record',
		run: (operation: () => unknown) => operation(),
		selectedClip: null,
		selectedAudioTrack: null,
		selectionActive: false,
		setDialog: () => undefined,
		setDialogValue: () => undefined,
		setNyquistTarget: () => undefined,
		setShowArmControls: () => undefined,
		showArmControls: false,
		snapshot: {
			preferences: {
				workspace: {
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
					custom: [], activeId: 'modern',
				},
				view: {},
			},
		},
		toggleFullscreen: () => undefined,
		toggleRecording: () => undefined,
		toggleWorkspacePanel: () => undefined,
		uiFlags: {},
		zoomProject: () => undefined,
	};
}
