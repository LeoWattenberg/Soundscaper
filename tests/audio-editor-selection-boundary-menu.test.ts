/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationSelectMenu } from '../src/common/editor/ui/application-select-menu.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const commands = [
	['track-view-item-extend-left', 'extendSelectionLeft', 'Shift+Left'],
	['track-view-item-extend-right', 'extendSelectionRight', 'Shift+Right'],
	['track-view-item-reduce-right', 'contractSelectionLeft', 'Ctrl+Shift+Right'],
	['track-view-item-reduce-left', 'contractSelectionRight', 'Ctrl+Shift+Left'],
	['sel-start', 'extendSelectionToProjectStart', 'Shift+Home'],
	['sel-end', 'extendSelectionToProjectEnd', 'Shift+End'],
] as const;

interface BoundaryMenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly shortcut?: string;
	readonly onClick?: () => unknown;
}

function menu(blocked: boolean, hasProject = true): { called: string[]; items: readonly BoundaryMenuItem[] } {
	const called: string[] = [];
	const actions = Object.fromEntries(commands.map(([, method]) => [method, () => called.push(method)]));
	const result = createApplicationSelectMenu({
		copy: ENGLISH_COPY, productId: 'soundscaper', project: hasProject ? { tracks: [] } : null,
		snapshot: {}, blocked, divider: () => ({ divider: true }), editBlocked: blocked,
		durationFrames: 48_000, editSelectionActive: false,
		clipSelectionNavigationMenus: {}, spectralTrackSelected: false, uiFlags: {},
	}, actions as never, {});
	const region = result.items.find(item => item?.id === 'select-region');
	return { called, items: region?.items ?? [] };
}

test('Select Region offers all keyboard range adjustments through their own actions', () => {
	const fixture = menu(false);
	for (const [id, method, shortcut] of commands) {
		const item = fixture.items.find(candidate => candidate.id === id);
		assert.ok(item, id);
		assert.ok(item.label);
		assert.equal(item.disabled, false);
		assert.equal(item.shortcut, shortcut);
		item.onClick?.();
		assert.equal(fixture.called.at(-1), method);
	}
});

test('range adjustment menus are disabled while blocked or without a project', () => {
	for (const fixture of [menu(true), menu(false, false)]) {
		for (const [id] of commands) {
			assert.equal(fixture.items.find(candidate => candidate.id === id)?.disabled, true, id);
		}
	}
});
