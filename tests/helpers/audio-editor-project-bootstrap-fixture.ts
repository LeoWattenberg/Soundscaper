/* SPDX-License-Identifier: AGPL-3.0-only */

import { createOwnedStateAccess } from '../../src/common/editor/controller/shared/owned-state.ts';
import { EditorControllerLifetime, isEditorDisposedError } from '../../src/common/editor/controller/shared/lifecycle.ts';
import {
	createProjectBootstrapService,
	type ProjectBootstrapServiceRuntime,
} from '../../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';
import { createInitialEffectMacroLibrary } from '../../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { createInitialMacroScriptLibrary } from '../../src/common/editor/controller/effects/macro-script-library-service.ts';
import { createDeliveryPresetState } from '../../src/common/editor/delivery-preset-store.ts';

export interface TestProject {
	readonly id: string;
	readonly tracks: readonly Readonly<{ id: string; type: string }>[];
}

interface TestPreferences {
	readonly loaded: boolean;
}

interface TestPresets {
	readonly source: unknown;
}

export function createFixture(options: Readonly<{
	genericReconciliation?: boolean;
	automaticAudioDeviceEnumeration?: boolean;
	startupProjectId?: (lastProjectId: string | null) => string | null;
}> = {}) {
	const lifetime = new EditorControllerLifetime();
	const settings = new Map<string, unknown>();
	const failedSettings = new Set<string>();
	let ready: () => PromiseLike<unknown> | unknown = () => Promise.resolve();
	let reconcileLinkedVideoOriginalLocators: () => PromiseLike<unknown> | unknown = () => undefined;
	let lastProjectId: string | null = null;
	let savedProject: TestProject | null = null;
	let loadProject: (
		projectId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<TestProject | null> = async () => savedProject;
	let openProject: (value: TestProject) => Promise<unknown> = async () => undefined;
	let missingSources = false;
	let removeDeviceListener: () => void = () => undefined;
	let deviceListener: (() => void) | null = null;
	let disposed = false;
	let recoveryBlocked = false;
	const deferredRecovery: Array<() => PromiseLike<unknown> | unknown> = [];
	const events: string[] = [];
	const statuses: Array<readonly [string, string]> = [];
	const errors: unknown[] = [];
	const state = {
		preferences: { loaded: false },
		effectPresets: { source: 'initial' } as TestPresets,
		// Bootstrap hydrates this from the stored collection, so the fixture has
		// to start with the empty state rather than without the field.
		deliveryPresets: createDeliveryPresetState(),
		deliveryPresetsReadOnly: false,
		effectMacros: createInitialEffectMacroLibrary(),
		macroScripts: createInitialMacroScriptLibrary(),
		effectPresetsReadOnly: false,
		// Bootstrap withholds writes for a library it could not read, so the
		// fixture starts with the writable state the flag is toggled from.
		effectMacrosReadOnly: false,
		macroScriptsReadOnly: false,
		monitoring: false,
		microphoneMetering: false,
		recordingInputGain: 0,
		latencyOffsetMs: 0,
		leadInRecording: false,
		showRms: false,
		showVerticalRulers: true,
		scrollViewToPlayhead: true,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		metronomeEnabled: false,
		selectionFollowsLoop: false,
		preferredInputDeviceId: '',
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		readOnly: false,
		takeCycleRecovery: null as unknown,
		takeCycleRecoveryInspecting: false,
	};
	const ownedState = createOwnedStateAccess(state, state);
	const runtime: ProjectBootstrapServiceRuntime<TestProject, TestPreferences, TestPresets> = {
		state, effectsState: { setEffectPresets: (value, readOnly = false) => { state.effectPresets = value; state.effectPresetsReadOnly = readOnly; }, setEffectMacros: (value, readOnly = false) => { state.effectMacros = value; state.effectMacrosReadOnly = readOnly; }, setMacroScripts: (value, readOnly = false) => { state.macroScripts = value; state.macroScriptsReadOnly = readOnly; } },
		recordingState: ownedState,
		transportState: ownedState,
		lifetimeSignal: lifetime.signal,
		store: {
			ready: () => ready(),
			...(options.genericReconciliation === false ? {} : {
				reconcileLinkedOriginalLocators: () => {
					events.push('reconcile-linked-originals');
					return reconcileLinkedVideoOriginalLocators();
				},
			}),
			reconcileLinkedVideoOriginalLocators: () => {
				events.push('reconcile-linked-video');
				return reconcileLinkedVideoOriginalLocators();
			},
			cleanupTemporaryAssets: () => { events.push('cleanup-assets'); },
			requestPersistentStorage: () => { events.push('request-persistence'); },
			async loadSetting(key, fallback) {
				events.push(`load:${key}`);
				if (failedSettings.has(key)) throw new Error(`Cannot read ${key}`);
				return settings.has(key) ? settings.get(key) : fallback;
			},
			async loadProject(
				projectId: string,
				options: Readonly<{ signal?: AbortSignal }> = {},
			) {
				events.push(`load-project:${projectId}`);
				return loadProject(projectId, options);
			},
		},
		engine: {
			loadProject() {},
			setOutputDevice: (deviceId) => { events.push(`output:${deviceId}`); },
		},
		mediaDevices: {
			addEventListener(_type, listener) {
				deviceListener = listener;
				events.push('listen-devices');
			},
			removeEventListener() { events.push('unlisten-devices'); },
		},
		automaticAudioDeviceEnumeration: options.automaticAudioDeviceEnumeration,
		productSettingKey: (key) => `product:${key}`,
		audioDevicePreferencesSettingKey: 'audio-devices',
		recordingInputGainDefault: 1,
		loadPreferences: async (token) => {
			await lifetime.guard(Promise.resolve(), token);
			state.preferences = { loaded: true };
			events.push('load-preferences');
		},
		createEffectPresets: (value = 'default') => ({ source: value }),
		normalizeRecordingInputGain: (value) => Number(value),
		normalizeLatencyOffset: (value) => Number(value),
		normalizeAudioDevicePreferences: (value) => {
			const record = value as Readonly<Record<string, unknown>> | null;
			return {
				inputDeviceId: String(record?.inputDeviceId ?? ''),
				inputChannelCount: Number(record?.inputChannelCount ?? 1),
				outputDeviceId: String(record?.outputDeviceId ?? ''),
			};
		},
		refreshAudioDevices: async (options) => { events.push(`refresh-devices:${String(options.publish)}`); },
		setRemoveDeviceChangeListener: (remove) => { removeDeviceListener = remove; },
		loadRecentProjectState: async () => lastProjectId,
		...(options.startupProjectId ? { startupProjectId: options.startupProjectId } : {}),
		openProject: (value) => openProject(value),
		newProject: async () => { events.push('new-project'); },
		openRecovery: {
			deferInitialSave: (operation) => deferRecovery(operation),
			deferMaintenance: (operation) => deferRecovery(operation),
		},
		publishProjectState: () => { events.push('publish'); },
		saveNow: async () => { events.push('save-now'); },
		refreshStorageUsage: async () => { events.push('storage-usage'); },
		hasMissingTimelineSources: () => missingSources,
		setStatus: (message, status) => { statuses.push([message, status]); },
		handleError: (error) => { errors.push(error); },
		isDisposed: () => disposed,
		isDisposedError: (error) => isEditorDisposedError(error),
		guard: (value, token) => lifetime.guard(value, token),
		copy: {
			webAudioUnsupported: 'Web Audio unavailable',
			missingSourcesBlocked: 'Missing sources',
			ready: 'Ready',
		},
	};
	return {
		runtime,
		deviceChange() { deviceListener?.(); },
		errors,
		events,
		lifetime,
		removeDeviceListener: () => removeDeviceListener(),
		service: createProjectBootstrapService(runtime),
		failSettingRead(key: string) { failedSettings.add(key); },
		recoverSettingRead(key: string) { failedSettings.delete(key); },
		settings,
		state,
		statuses,
		setDisposed(value: boolean) { disposed = value; },
		setLastProject(value: string | null, loaded: TestProject | null) {
			lastProjectId = value;
			savedProject = loaded;
		},
		setMissingSources(value: boolean) { missingSources = value; },
		setLoadProject(value: typeof loadProject) { loadProject = value; },
		setOpenProject(value: typeof openProject) { openProject = value; },
		setReady(value: typeof ready) { ready = value; },
		setReconciliation(value: typeof reconcileLinkedVideoOriginalLocators) {
			reconcileLinkedVideoOriginalLocators = value;
		},
		setRecoveryBlocked(value: boolean) {
			recoveryBlocked = value;
			state.takeCycleRecovery = value ? {} : null;
		},
		async resolveRecovery() {
			recoveryBlocked = false;
			state.takeCycleRecovery = null;
			for (const operation of deferredRecovery.splice(0)) await operation();
		},
	};

	async function deferRecovery(
		operation: () => PromiseLike<unknown> | unknown,
	): Promise<boolean> {
		if (!recoveryBlocked) { await operation(); return true; }
		deferredRecovery.push(operation);
		return false;
	}
}
