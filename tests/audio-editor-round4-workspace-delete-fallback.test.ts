/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreferencesComposition } from '../src/common/editor/controller/preferences/preferences-composition.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

for (const [productId, defaultWorkspace] of [['soundscaper', 'modern'], ['framescaper', 'video-editor']] as const) {
	test(`${productId} deleting its active custom workspace restores the configured default layout`, async () => {
		const fixture = workspaceFixture(productId, defaultWorkspace);
		const originalLayout = fixture.state.preferences.workspace;
		await fixture.preferences.actions.createWorkspacePreference('Review', 'review');
		assert.equal(fixture.state.preferences.workspace.activeId, 'review');
		await fixture.preferences.actions.deleteWorkspacePreference('review');
		const restored = fixture.state.preferences.workspace;
		assert.equal(restored.activeId, defaultWorkspace);
		assert.deepEqual(restored.panels, originalLayout.panels);
		assert.deepEqual(restored.toolbars, originalLayout.toolbars);
		assert.deepEqual(restored.toolbarButtons, originalLayout.toolbarButtons);
		assert.deepEqual(restored.custom, []);
		assert.deepEqual(fixture.saved.at(-1), fixture.state.preferences);
	});
}

test('deleting an inactive custom workspace preserves the chosen custom layout', async () => {
	const fixture = workspaceFixture('framescaper', 'video-editor');
	await fixture.preferences.actions.createWorkspacePreference('First', 'first');
	await fixture.preferences.actions.createWorkspacePreference('Second', 'second');
	const activeLayout = fixture.state.preferences.workspace;
	await fixture.preferences.actions.deleteWorkspacePreference('first');
	assert.equal(fixture.state.preferences.workspace.activeId, 'second');
	assert.deepEqual(fixture.state.preferences.workspace.panels, activeLayout.panels);
	assert.deepEqual(fixture.state.preferences.workspace.custom.map(entry => {
		assert.ok('id' in entry && typeof entry.id === 'string');
		return entry.id;
	}), ['second']);
});

function workspaceFixture(productId: string, defaultWorkspace: string) {
	const state = {
		preferences: createAudioEditorPreferencesV1({ workspace: { activeId: defaultWorkspace } }),
		preferencesReadOnly: false,
		timelineView: 'waveform',
	};
	const saved: unknown[] = [];
	const preferences = createPreferencesComposition({
		productId, defaultWorkspace, state, lifetime: new EditorControllerLifetime(),
		copy: { preferencesNewerSchema: 'Newer preferences', shortcutActionRequired: 'Action needed', shortcutConflict: 'Conflict' },
		loadSetting: async (_key, fallback) => fallback,
		persistSetting: async (_key, value) => { saved.push(value); },
		publish: () => undefined,
	});
	return { state, saved, preferences };
}
