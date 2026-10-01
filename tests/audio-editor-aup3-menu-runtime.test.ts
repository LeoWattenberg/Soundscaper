/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findMenuItem } from './helpers/application-menu-fixture.ts';

import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

interface MenuItem {
	readonly id?: string;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('the workspace AUP3 menu action preserves read-only projects as an exported copy', async () => {
	const requests: unknown[] = [];
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		controller: {
			actions: {
				project: {
					saveAup3: (request: unknown) => {
						requests.push(request);
						return Promise.resolve();
					},
				},
			},
		},
	})) as readonly MenuItem[];
	const exportAup3 = findMenuItem(menus, 'save-aup3');
	assert.ok(exportAup3?.onClick);

	await exportAup3.onClick();

	assert.deepEqual(requests, [{ saveCopy: true }]);
});

function workspaceInput(overrides: Readonly<Record<string, unknown>> = {}) {
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: ENGLISH_COPY, project: null,
		snapshot: {
			project: null, readOnly: true, selectedTrackId: null,
			preferences: {
				workspace: {
					activeId: 'editing', custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		controller: { actions: { project: {} } },
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		projectBinEffectivelyOpen: false, uiFlags: {},
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
		...overrides,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => Reflect.has(target, property)
			? Reflect.get(target, property, receiver)
			: () => undefined,
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}
