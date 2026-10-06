/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertEditorPreferenceActionOwner,
	createEditorPreferenceActionOwner,
} from '../src/common/editor/controller/preferences/preference-action-group.ts';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { EDITOR_ACTION_FUNCTION_NAMES } from '../src/common/editor/controller/composition/action-facade-runtime.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

const DELEGATE_NAMES = [
	'setWorkspacePreference', 'toggleToolbarPreference', 'moveToolbarPreference',
	'setToolbarButtonPreference', 'togglePanelPreference', 'setPanelPreference',
	'setPanelVisibilityPreference', 'setPanelFrameSizePreference', 'setPanelDockExtentPreference',
	'movePanelPreference', 'activatePanelTabPreference', 'setShortcutPreference',
	'createWorkspacePreference', 'updateWorkspacePreference', 'deleteWorkspacePreference',
] as const;

test('preference ownership keeps the frozen delegate identity and removes fifteen flat functions', () => {
	const delegates = Object.freeze(Object.fromEntries(DELEGATE_NAMES.map((name) => [name, () => name])));
	const owner = createEditorPreferenceActionOwner(delegates as never);
	assert.equal(owner, delegates);
	assert.equal(Object.isFrozen(owner), true);
	assert.deepEqual(Object.keys(owner), DELEGATE_NAMES);
	assert.doesNotThrow(() => assertEditorPreferenceActionOwner(owner));
	assert.equal(EDITOR_ACTION_FUNCTION_NAMES.length, 200);
	assert.deepEqual(DELEGATE_NAMES.filter((name) => EDITOR_ACTION_FUNCTION_NAMES.includes(name as never)), []);
});

test('preference assembly refuses an unbranded delegate copy', () => {
	const runtime = createActionFacadeRuntime();
	const unbranded = new Proxy(runtime, {
		get(target, name, receiver) {
			return name === 'preferenceActions' ? { ...target.preferenceActions } : Reflect.get(target, name, receiver);
		},
	});
	assert.throws(() => createGroupedEditorActions(unbranded), /Invalid editor action dependency: preferenceActions\./u);
	assert.throws(() => assertEditorPreferenceActionOwner(null), /Missing editor action dependency: preferenceActions\./u);
});

test('public preference adapters retain direct delegate identity and default-view update ordering', () => {
	const calls: unknown[][] = [];
	let resolveUpdate: (() => void) | undefined;
	const updated = new Promise<void>((resolve) => { resolveUpdate = resolve; });
	const runtime = createActionFacadeRuntime();
	const actions = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'updatePreferences') return (patch: unknown) => { calls.push(['update', patch]); return updated; };
			if (name === 'setTimelineView') return (view: unknown) => { calls.push(['view', view]); };
			return Reflect.get(target, name, receiver);
		},
	})).preferences;
	assert.equal(actions.setWorkspace, runtime.preferenceActions.setWorkspacePreference);
	assert.equal(actions.movePanel, runtime.preferenceActions.movePanelPreference);
	assert.equal(actions.setShortcut, runtime.preferenceActions.setShortcutPreference);
	assert.equal(actions.createWorkspace, runtime.preferenceActions.createWorkspacePreference);
	assert.equal(actions.setDefaultView('spectrogram'), updated);
	assert.deepEqual(calls, [['update', { appearance: { defaultView: 'spectrogram' } }], ['view', 'spectrogram']]);
	resolveUpdate?.();
});
