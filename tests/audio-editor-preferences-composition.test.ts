/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferencesComposition } from '../src/common/editor/controller/preferences/preferences-composition.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { createAudioEditorController } from '../src/common/editor/facade.ts';

test('preference composition loads product storage and applies session defaults', async () => {
	const saved = createAudioEditorPreferencesV1({ appearance: { defaultView: 'spectrogram' } });
	const state = { preferences: createAudioEditorPreferencesV1(), preferencesReadOnly: false, timelineView: 'waveform' };
	const reads: string[] = [];
	const preferences = createPreferencesComposition({
		productId: 'framescaper', defaultWorkspace: 'editing', state, lifetime: new EditorControllerLifetime(),
		copy: { preferencesNewerSchema: 'Newer preferences', shortcutActionRequired: 'Action needed', shortcutConflict: 'Conflict' },
		loadSetting: async (key) => { reads.push(key); return saved; },
		persistSetting: async () => undefined, publish: () => undefined,
	});
	await preferences.load();
	assert.deepEqual(reads, ['framescaper:audio-editor-preferences-v1']);
	assert.equal(state.timelineView, 'spectrogram');
	assert.equal(state.preferences.appearance.defaultView, 'spectrogram');
});

test('preference actions preserve required persistence failures and product isolation', async () => {
	const state = { preferences: createAudioEditorPreferencesV1(), preferencesReadOnly: false, timelineView: 'waveform' };
	const writes: unknown[] = [], failure = new Error('settings unavailable');
	const preferences = createPreferencesComposition({
		productId: 'soundscaper', defaultWorkspace: 'editing', state, lifetime: new EditorControllerLifetime(),
		copy: { preferencesNewerSchema: 'Newer preferences', shortcutActionRequired: 'Action needed', shortcutConflict: 'Conflict' },
		loadSetting: async (_key, fallback) => fallback,
		persistSetting: async (...args) => { writes.push(args); if (args[0].startsWith('soundscaper:')) throw failure; }, publish: () => undefined,
	});
	await assert.rejects(async () => { await preferences.actions.setPanelVisibilityPreference('mixer', true); }, (error: unknown) => error === failure);
	assert.equal((writes[0] as unknown[])[0], 'audio-editor-preferences-v1');
	assert.equal((writes[1] as unknown[])[0], 'soundscaper:audio-editor-preferences-v1');
	assert.deepEqual((writes[0] as unknown[])[2], { policy: 'required' });
});

export function checkPublicPreferenceActions(actions: ReturnType<typeof createAudioEditorController>['actions']): void {
	// @ts-expect-error Visibility is a boolean at the public boundary.
	void actions.preferences.setPanelVisibility('mixer', 'visible');
	// @ts-expect-error Shortcut bindings retain the owning service's input type.
	void actions.preferences.setShortcut('play', 42);
}
