/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyAudioEditorWorkspace, createAudioEditorPreferencesV1, createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace, findAudioEditorShortcutConflicts, loadAudioEditorPreferencesV1,
	normalizeAudioEditorShortcut, updateAudioEditorPreferencesV1, updateCustomAudioEditorWorkspace,
} from '../../preferences.js';
import { createStableId } from '../../project.js';
import type { AudioEditorOptimizationMode } from '../../performance-preferences.ts';
import { createEditorPreferenceActionDelegates, createEditorPreferencesService } from './internal/preferences-service.ts';
import { applyLoadedPreferenceSession } from './internal/preference-session-defaults.ts';
import type { EditorControllerLifetime } from '../shared/lifecycle.ts';
import type { createSettingPersistence } from './setting-persistence.ts';

type Preferences = ReturnType<typeof createAudioEditorPreferencesV1>;

export function createPreferencesComposition(d: {
	readonly productId: string;
	readonly defaultWorkspace: string;
	readonly defaultOptimizationMode?: AudioEditorOptimizationMode;
	readonly state: { preferences: Preferences; preferencesReadOnly: boolean; timelineView: string };
	readonly lifetime: EditorControllerLifetime;
	readonly copy: Readonly<{ preferencesNewerSchema: string; shortcutActionRequired: string; shortcutConflict: string }>;
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown,
		options?: Parameters<ReturnType<typeof createSettingPersistence>['persist']>[2]) => Promise<unknown>;
	readonly publish: () => void;
}) {
	const service = createEditorPreferencesService<Preferences>({
		productId: d.productId, preferenceSettingKey: `${d.productId}:audio-editor-preferences-v1`, defaultWorkspace: d.defaultWorkspace,
		get newerSchemaMessage() { return d.copy.preferencesNewerSchema; }, get shortcutActionRequired() { return d.copy.shortcutActionRequired; }, get shortcutConflict() { return d.copy.shortcutConflict; },
		getPreferences: () => d.state.preferences,
		setPreferences: (value) => { d.state.preferences = value; },
		getReadOnly: () => d.state.preferencesReadOnly,
		setReadOnly: (value) => { d.state.preferencesReadOnly = value; },
		loadSetting: d.loadSetting, persistSetting: (key, value) => d.persistSetting(key, value),
		persistSettingRequired: (key, value) => d.persistSetting(key, value, { policy: 'required' }),
		publish: d.publish, loadPreferences: (saved) => {
			const loaded = loadAudioEditorPreferencesV1(saved);
			const savedMode = (saved as { readonly performance?: { readonly optimizeFor?: unknown } }).performance?.optimizeFor;
			if (loaded.readOnly || d.defaultOptimizationMode !== 'speed' || savedMode === 'memory' || savedMode === 'speed') return loaded;
			return { ...loaded, preferences: updateAudioEditorPreferencesV1(loaded.preferences, { performance: { optimizeFor: 'speed' } }) };
		},
		createPreferences: (activeId) => createAudioEditorPreferencesV1({ workspace: { activeId }, performance: { optimizeFor: d.defaultOptimizationMode ?? 'memory' } }),
		applyWorkspace: applyAudioEditorWorkspace, updatePreferences: (preferences, patch) => updateAudioEditorPreferencesV1(preferences, patch ?? {}),
		normalizeShortcut: normalizeAudioEditorShortcut, findShortcutConflicts: findAudioEditorShortcutConflicts,
		createWorkspace: createCustomAudioEditorWorkspace, updateWorkspace: (preferences, id, changes) => updateCustomAudioEditorWorkspace(preferences, id, changes ?? {}), deleteWorkspace: deleteCustomAudioEditorWorkspace,
	});
	return Object.freeze({
		service,
		actions: createEditorPreferenceActionDelegates(service, createStableId),
		async load(token = d.lifetime.capture()): Promise<Preferences> {
			return applyLoadedPreferenceSession(await service.load(value => d.lifetime.guard(value, token)), d.state);
		},
	});
}
