/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectBootstrapService,
	type ProjectBootstrapServiceRuntime,
} from '../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';
import {
	EFFECT_MACRO_LIBRARY_SETTING_KEY,
	createInitialEffectMacroLibrary,
	type EffectMacroLibraryState,
} from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { createInitialMacroScriptLibrary } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';
import { EditorControllerLifetime, isEditorDisposedError } from '../src/common/editor/controller/shared/lifecycle.ts';

test('Soundscaper persists the initial ordinary macro library before bootstrap finishes', async () => {
	const fixture = createFixture();
	await fixture.bootstrap();

	assert.deepEqual(fixture.state.effectMacros.macros.map(({ name }) => name), ['Restoration', 'Fade ends']);
	assert.deepEqual(fixture.writes.map(([key]) => key), [EFFECT_MACRO_LIBRARY_SETTING_KEY]);
	assert.equal(fixture.writes[0]?.[1].defaultsInitialized, true);
});

test('Soundscaper migrates legacy macros and leaves an initialized library untouched', async () => {
	const legacy = createFixture();
	legacy.settings.set(EFFECT_MACRO_LIBRARY_SETTING_KEY, {
		macros: [{ id: 'custom', name: 'Custom', effects: [] }],
	});
	await legacy.bootstrap();
	assert.deepEqual(legacy.state.effectMacros.macros.map(({ name }) => name), ['Custom', 'Restoration', 'Fade ends']);
	assert.equal(legacy.writes.length, 1);

	const initialized = createFixture();
	initialized.settings.set(EFFECT_MACRO_LIBRARY_SETTING_KEY, {
		schemaVersion: 1, defaultsInitialized: true, macros: [],
	});
	await initialized.bootstrap();
	assert.deepEqual(initialized.state.effectMacros.macros, []);
	assert.deepEqual(initialized.writes, [], 'deleting all defaults must remain a lasting choice');
});

test('a failure to persist defaults keeps the migrated user macros in memory', async () => {
	const fixture = createFixture({ failWrite: true });
	fixture.settings.set(EFFECT_MACRO_LIBRARY_SETTING_KEY, {
		macros: [{ id: 'custom', name: 'Custom', effects: [] }],
	});
	await fixture.bootstrap();

	assert.deepEqual(fixture.state.effectMacros.macros.map(({ name }) => name), ['Custom', 'Restoration', 'Fade ends']);
	assert.deepEqual(fixture.errors.map((error) => (error as Error).message), ['settings offline']);
	assert.equal(fixture.state.effectMacrosReadOnly, false);
});

test('ahead-schema libraries are never seeded or persisted by Soundscaper bootstrap', async () => {
	const fixture = createFixture();
	const future = { schemaVersion: 99, macros: [{ id: 'future', name: 'Future', steps: [] }] };
	fixture.settings.set(EFFECT_MACRO_LIBRARY_SETTING_KEY, future);
	await fixture.bootstrap();

	assert.deepEqual(fixture.state.effectMacros.macros, []);
	assert.equal(fixture.state.effectMacrosReadOnly, true);
	assert.deepEqual(fixture.writes, []);
	assert.equal(fixture.settings.get(EFFECT_MACRO_LIBRARY_SETTING_KEY), future);
});

test('a failed macro library read does not seed or persist defaults', async () => {
	const fixture = createFixture({ failRead: true });
	await fixture.bootstrap();
	assert.equal(fixture.state.effectMacrosReadOnly, true);
	assert.deepEqual(fixture.state.effectMacros.macros, []);
	assert.deepEqual(fixture.writes, []);
});

test('Framescaper hydrates ordinary macros without Soundscaper defaults or a migration marker', async () => {
	const fixture = createFixture({ defaults: false });
	await fixture.bootstrap();

	assert.deepEqual(fixture.state.effectMacros.macros, []);
	assert.equal(fixture.state.effectMacros.defaultsInitialized, undefined);
	assert.deepEqual(fixture.writes, []);
});

function createFixture({ defaults = true, failWrite = false, failRead = false }: {
	defaults?: boolean; failWrite?: boolean; failRead?: boolean;
} = {}) {
	const lifetime = new EditorControllerLifetime();
	const settings = new Map<string, unknown>();
	const writes: [string, EffectMacroLibraryState][] = [];
	const errors: unknown[] = [];
	const state = {
		preferences: {}, deliveryPresets: createDeliveryPresetState(),
		effectMacros: createInitialEffectMacroLibrary(), effectMacrosReadOnly: false,
		macroScripts: createInitialMacroScriptLibrary(),
		showRms: false, showVerticalRulers: true, readOnly: false,
		monitoring: false, microphoneMetering: false, recordingInputGain: 0,
		latencyOffsetMs: 0, leadInRecording: false,
		preferredInputDeviceId: '', preferredInputChannelCount: 1, preferredOutputDeviceId: '',
		recordingInputGainDefault: 1,
		metronomeEnabled: false, pinnedPlayhead: false, playbackOnRulerClick: true,
		selectionFollowsLoop: false, scrollViewToPlayhead: true,
	};
	const access = createOwnedStateAccess(state, state);
	const runtime: ProjectBootstrapServiceRuntime<never, Record<string, never>, Record<string, never>> = {
		state, recordingState: access, transportState: access,
		effectsState: {
			setEffectPresets: () => undefined,
			setEffectMacros: (value, readOnly = false) => {
				state.effectMacros = value;
				state.effectMacrosReadOnly = readOnly;
			},
			setMacroScripts: (value) => { state.macroScripts = value; },
		},
		lifetimeSignal: lifetime.signal,
		store: {
			ready: () => undefined, requestPersistentStorage: () => undefined,
			loadSetting: async (key, fallback) => {
				if (failRead && key === EFFECT_MACRO_LIBRARY_SETTING_KEY) throw new Error('settings offline');
				return settings.has(key) ? settings.get(key) : fallback;
			},
			loadProject: async () => null,
		},
		engine: { loadProject: () => undefined },
		automaticAudioDeviceEnumeration: false,
		effectMacroDefaults: defaults,
		persistEffectMacroLibrary: async (key, value) => {
			if (failWrite) throw new Error('settings offline');
			writes.push([key, value]);
			settings.set(key, value);
		},
		productSettingKey: (key) => key, audioDevicePreferencesSettingKey: 'devices',
		recordingInputGainDefault: 1, loadPreferences: async () => undefined,
		createEffectPresets: () => ({}),
		normalizeRecordingInputGain: () => 1, normalizeLatencyOffset: () => 0,
		normalizeAudioDevicePreferences: () => ({ inputDeviceId: '', inputChannelCount: 1, outputDeviceId: '' }),
		refreshAudioDevices: () => undefined, setRemoveDeviceChangeListener: () => undefined,
		loadRecentProjectState: async () => null, openProject: async () => undefined,
		newProject: async () => undefined, publishProjectState: () => undefined,
		saveNow: () => undefined, refreshStorageUsage: () => undefined,
		hasMissingTimelineSources: () => false, setStatus: () => undefined,
		handleError: (error) => { errors.push(error); },
		isDisposed: () => false, isDisposedError: isEditorDisposedError,
		guard: (value, token) => lifetime.guard(value, token),
		copy: { webAudioUnsupported: 'Unavailable', missingSourcesBlocked: 'Missing', ready: 'Ready' },
	};
	return {
		state, settings, writes, errors,
		bootstrap: () => createProjectBootstrapService(runtime).bootstrap(lifetime.capture()),
	};
}
