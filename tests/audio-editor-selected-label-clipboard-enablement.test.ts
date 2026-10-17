/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createWorkspaceEditItems } from '../src/common/editor/ui/workspace/workspace-edit-items.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMenuActionFixture, findMenuItem } from './helpers/application-menu-fixture.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const clipboardActions = ['action://copy', 'action://cut', 'cut-leave-gap', 'cut-per-clip-ripple', 'cut-per-track-ripple', 'cut-all-tracks-ripple'];
interface Menu { readonly id?: string; readonly disabled?: boolean; readonly items?: readonly Menu[]; readonly onClick?: () => unknown }

function fixture(selected = true, editBlocked = false) {
	const project = { id: 'label-clipboard', schemaVersion: 17, sampleRate: 48_000, sources: [], clips: [],
		tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'point', title: 'Point', startFrame: 12_000, endFrame: 12_000 }] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] }, loop: { enabled: false }, snap: { enabled: false } };
	const selectedLabels = selected ? [{ trackId: 'labels', labelId: 'point' }] : [];
	const snapshot = { project, selectedLabels, selectedTrackId: null, selectedClipId: null, readOnly: editBlocked,
		preferences: { workspace: { activeId: 'modern', custom: [], panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map(id => [id, { visible: false }])) },
			view: {}, shortcuts: { 'action://copy': ['Ctrl+C'], 'action://cut': ['Ctrl+X'], 'action://paste': ['Ctrl+V'] } },
		history: { canUndo: false, canRedo: false, hasClipboard: true }, effects: { selectionTypes: [], canRepeatLast: false } };
	const calls: string[] = [];
	const context = { snapshot };
	const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en', copy: ENGLISH_COPY,
		project, snapshot, blocked: editBlocked, editBlocked, showArmControls: false, selectionActive: false, selectedClip: null,
		durationFrames: 0, effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: { getActionContext: () => context }, actions: createMenuActionFixture({ executeEdit: (action: string) => calls.push(action) }) }) as readonly Menu[];
	return { project, snapshot, context, menus, calls, selectedLabels };
}

test('a selected point label enables only clipboard commands without an audio range', () => {
	const { context, menus } = fixture();
	for (const id of clipboardActions) {
		assert.equal(evaluateAudacityActionEnablement(id, context), true, id);
		assert.equal(findMenuItem(menus, id === 'action://copy' ? 'copy' : id)?.disabled, false, id);
	}
	for (const id of ['duplicate', 'trim-audio-outside-selection', 'silence-audio-selection', 'split']) {
		assert.equal(evaluateAudacityActionEnablement(id, context), false, id);
	}
	for (const id of ['duplicate-audio', 'trim-audio-outside-selection', 'silence-audio', 'split']) {
		assert.equal(findMenuItem(menus, id)?.disabled, true, id);
	}
});

test('label clipboard commands keep read-only and empty-selection gates', () => {
	for (const [selected, blocked] of [[false, false], [true, true]] as const) {
		const { context, menus } = fixture(selected, blocked);
		for (const id of clipboardActions) {
			assert.equal(evaluateAudacityActionEnablement(id, context), false, id);
			assert.equal(findMenuItem(menus, id === 'action://copy' ? 'copy' : id)?.disabled, true, id);
		}
	}
});

test('the tool toolbar offers selected-label Copy and each existing Cut choice while media-only edits stay disabled', () => {
	const { selectedLabels } = fixture();
	const items = createWorkspaceEditItems({ copy: ENGLISH_COPY, editBlocked: false, editSelectionActive: false,
		selectedLabels, hasClipboard: true, splitAvailable: false });
	for (const action of ['copy', 'cutPerTrackRipple', 'cutLeaveGap', 'cutAllTracksRipple', 'paste']) {
		assert.equal(items.find(item => item.action === action)?.disabled, false, action);
	}
	for (const action of ['split', 'deletePerTrackRipple', 'deleteLeaveGap', 'deleteAllTracksRipple']) {
		assert.equal(items.find(item => item.action === action)?.disabled, true, action);
	}
});

test('Ctrl/Cmd+C/X/V use the selected-label command route while editable inputs keep native text commands', () => {
	const { snapshot, context, menus, calls } = fixture();
	const dom = installReactTestDom();
	try {
		for (const modifier of ['ctrlKey', 'metaKey'] as const) for (const [key, action] of [['c', 'copy'], ['x', 'cut'], ['v', 'paste']] as const) {
			const event = { key, code: `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
				[modifier]: true, defaultPrevented: false, target: null, preventDefault() {} };
			handleWorkspaceKeyboard(event, snapshot, handler => handler(), { actionContext: context, menus });
			assert.equal(calls.at(-1), action);
			const before = calls.length;
			const input = dom.container.ownerDocument.createElement('input');
			handleWorkspaceKeyboard({ ...event, target: input as unknown as EventTarget }, snapshot, handler => handler(), { actionContext: context, menus });
			assert.equal(calls.length, before, `${modifier}+${key} remains native in a text field`);
		}
	} finally { dom.restore(); }
});
