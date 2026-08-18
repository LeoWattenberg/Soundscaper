/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorLifetimeToken } from './lifecycle.ts';
import type { ProjectLifecycleProject } from './project-lifecycle-types.ts';
import { DELIVERY_PRESETS_SETTING_KEY } from './delivery-preset-service.ts';

export interface ProjectBootstrapState<Preferences, EffectPresets, DeliveryPresets> {
	preferences: Preferences;
	effectPresets: EffectPresets;
	deliveryPresets: DeliveryPresets;
	monitoring: boolean;
	microphoneMetering: boolean;
	recordingInputGain: number;
	latencyOffsetMs: number;
	leadInRecording: boolean;
	showRms: boolean;
	showVerticalRulers: boolean;
	updateDisplayWhilePlaying: boolean;
	pinnedPlayhead: boolean;
	playbackOnRulerClick: boolean;
	metronomeEnabled: boolean;
	selectionFollowsLoop: boolean;
	preferredInputDeviceId: string;
	preferredInputChannelCount: number;
	preferredOutputDeviceId: string;
	readOnly: boolean;
	takeCycleRecovery?: unknown;
	takeCycleRecoveryInspecting?: boolean;
}

export interface ProjectBootstrapStore<Project extends ProjectLifecycleProject> {
	ready(): PromiseLike<unknown> | unknown;
	reconcileLinkedOriginalLocators?(): PromiseLike<unknown> | unknown;
	reconcileLinkedVideoOriginalLocators?(): PromiseLike<unknown> | unknown;
	cleanupTemporaryAssets?(): PromiseLike<unknown> | unknown;
	requestPersistentStorage(): PromiseLike<unknown> | unknown;
	loadSetting(key: string, fallback: unknown): Promise<unknown>;
	loadProject(
		projectId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Project | null>;
}

export interface ProjectBootstrapMediaDevices {
	addEventListener?(type: 'devicechange', listener: () => void): void;
	removeEventListener?(type: 'devicechange', listener: () => void): void;
}

export interface ProjectBootstrapServiceRuntime<
	Project extends ProjectLifecycleProject,
	Preferences,
	EffectPresets,
	DeliveryPresets,
> {
	readonly state: ProjectBootstrapState<Preferences, EffectPresets, DeliveryPresets>;
	readonly lifetimeSignal: AbortSignal;
	readonly store: ProjectBootstrapStore<Project>;
	readonly engine: Readonly<{
		loadProject?: unknown;
		setOutputDevice?: (deviceId: string) => PromiseLike<unknown> | unknown;
	}> | null;
	readonly mediaDevices?: ProjectBootstrapMediaDevices | null;
	readonly productSettingKey: (key: string) => string;
	readonly audioDevicePreferencesSettingKey: string;
	readonly recordingInputGainDefault: number;
	readonly loadPreferences: (token: EditorLifetimeToken) => Promise<unknown>;
	readonly createEffectPresets: (value?: unknown) => EffectPresets;
	readonly createDeliveryPresets: (value?: unknown) => DeliveryPresets;
	readonly normalizeRecordingInputGain: (value: unknown) => number;
	readonly normalizeLatencyOffset: (value: unknown) => number;
	readonly normalizeAudioDevicePreferences: (value: unknown) => Readonly<{
		inputDeviceId: string;
		inputChannelCount: number;
		outputDeviceId: string;
	}>;
	readonly refreshAudioDevices: (options: Readonly<{
		probe: false;
		publish?: false;
	}>) => PromiseLike<unknown> | unknown;
	readonly setRemoveDeviceChangeListener: (remove: () => void) => void;
	readonly loadRecentProjectState: <Value>(
		guard: (value: PromiseLike<Value> | Value) => Promise<Value>,
	) => Promise<string | null>;
	readonly openProject: (project: Project) => Promise<unknown>;
	readonly newProject: () => Promise<unknown>;
	readonly openRecovery?: Readonly<{
		deferInitialSave(operation: () => PromiseLike<unknown> | unknown): PromiseLike<boolean>;
		deferMaintenance(operation: () => PromiseLike<unknown> | unknown): PromiseLike<boolean>;
	}>;
	readonly publishProjectState: () => void;
	readonly saveNow: () => PromiseLike<unknown> | unknown;
	readonly refreshStorageUsage: () => PromiseLike<unknown> | unknown;
	readonly hasMissingTimelineSources: () => boolean;
	readonly setStatus: (message: string, state: 'error' | 'success') => void;
	readonly handleError: (error: unknown) => void;
	readonly isDisposed: () => boolean;
	readonly isDisposedError: (error: unknown) => boolean;
	readonly guard: <Value>(
		value: PromiseLike<Value> | Value,
		token: EditorLifetimeToken,
	) => Promise<Value>;
	readonly copy: Readonly<{
		webAudioUnsupported: string;
		missingSourcesBlocked: string;
		ready: string;
	}>;
}

/**
 * Bootstraps settings and the first project under one terminal lifetime token.
 * Resources are registered only after their preceding async work is guarded.
 */
export function createProjectBootstrapService<
	Project extends ProjectLifecycleProject,
	Preferences,
	EffectPresets,
	DeliveryPresets,
>(runtime: ProjectBootstrapServiceRuntime<Project, Preferences, EffectPresets, DeliveryPresets>) {
	const deferInitialSave = runtime.openRecovery?.deferInitialSave
		?? runProjectBootstrapOperation;
	const deferMaintenance = runtime.openRecovery?.deferMaintenance
		?? runProjectBootstrapOperation;
	return Object.freeze({ bootstrap });

	async function bootstrap(token: EditorLifetimeToken): Promise<void> {
		const guard = <Value>(value: PromiseLike<Value> | Value) => runtime.guard(value, token);
		if (!runtime.engine || typeof runtime.engine.loadProject !== 'function') {
			throw new Error(runtime.copy.webAudioUnsupported);
		}
		await guard(runtime.store.ready());
		const reconcileLinkedOriginalLocators = runtime.store.reconcileLinkedOriginalLocators
			?? runtime.store.reconcileLinkedVideoOriginalLocators;
		await guard(reconcileLinkedOriginalLocators?.call(runtime.store));
		void Promise.resolve()
			.then(() => runtime.store.requestPersistentStorage())
			.catch((error: unknown) => {
				if (!runtime.isDisposed()) runtime.handleError(error);
			});
		await runtime.loadPreferences(token);
		try {
			const storedPresets = await guard(runtime.store.loadSetting('audio-editor-effect-presets-v1', null));
			runtime.state.effectPresets = runtime.createEffectPresets(storedPresets || {});
		} catch (error) {
			if (runtime.isDisposedError(error)) throw error;
			runtime.state.effectPresets = runtime.createEffectPresets();
		}
		// Delivery presets hydrate the same way effect presets do. Without this the
		// preset service is write-only: every session starts with an empty
		// collection, and its first save persists that empty collection with the
		// new preset alone, taking every preset saved before it with it.
		try {
			const storedDeliveryPresets = await guard(
				runtime.store.loadSetting(DELIVERY_PRESETS_SETTING_KEY, null),
			);
			runtime.state.deliveryPresets = runtime.createDeliveryPresets(storedDeliveryPresets || {});
		} catch (error) {
			if (runtime.isDisposedError(error)) throw error;
			runtime.state.deliveryPresets = runtime.createDeliveryPresets();
		}
		runtime.state.monitoring = Boolean(await guard(runtime.store.loadSetting('input-monitor', false)));
		runtime.state.microphoneMetering = Boolean(await guard(runtime.store.loadSetting('microphone-metering', false)));
		try {
			runtime.state.recordingInputGain = runtime.normalizeRecordingInputGain(await guard(runtime.store.loadSetting(
				'recording-input-gain',
				runtime.recordingInputGainDefault,
			)));
		} catch (error) {
			if (runtime.isDisposedError(error)) throw error;
			runtime.state.recordingInputGain = runtime.recordingInputGainDefault;
		}
		runtime.state.latencyOffsetMs = runtime.normalizeLatencyOffset(await guard(runtime.store.loadSetting(
			'recording-latency-offset-ms',
			0,
		)));
		runtime.state.leadInRecording = Boolean(await guard(runtime.store.loadSetting('recording-lead-in', false)));
		runtime.state.showRms = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('waveform-show-rms'),
			false,
		)));
		runtime.state.showVerticalRulers = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('timeline-show-vertical-rulers'),
			true,
		)));
		runtime.state.updateDisplayWhilePlaying = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('timeline-update-while-playing'),
			true,
		)));
		runtime.state.pinnedPlayhead = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('timeline-pinned-playhead'),
			false,
		)));
		runtime.state.playbackOnRulerClick = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('timeline-ruler-playback'),
			true,
		)));
		runtime.state.metronomeEnabled = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('transport-metronome'),
			false,
		)));
		runtime.state.selectionFollowsLoop = Boolean(await guard(runtime.store.loadSetting(
			runtime.productSettingKey('selection-follows-loop'),
			false,
		)));
		const savedAudioDevices = runtime.normalizeAudioDevicePreferences(await guard(runtime.store.loadSetting(
			runtime.productSettingKey(runtime.audioDevicePreferencesSettingKey),
			null,
		)));
		runtime.state.preferredInputDeviceId = savedAudioDevices.inputDeviceId;
		runtime.state.preferredInputChannelCount = savedAudioDevices.inputChannelCount;
		runtime.state.preferredOutputDeviceId = savedAudioDevices.outputDeviceId;
		await guard(Promise.resolve(runtime.engine.setOutputDevice?.(savedAudioDevices.outputDeviceId)).catch(() => undefined));
		await guard(runtime.refreshAudioDevices({ probe: false, publish: false }));
		registerDeviceChangeListener();
		const lastProjectId = await runtime.loadRecentProjectState(guard);
		const saved = lastProjectId
			? await guard(runtime.store.loadProject(lastProjectId, { signal: runtime.lifetimeSignal }))
			: null;
		if (saved) await guard(runtime.openProject(saved));
		else await guard(runtime.newProject());
		runtime.publishProjectState();
		if (!runtime.state.readOnly) {
			await guard(deferInitialSave(() => runtime.saveNow()));
		}
		await guard(deferMaintenance(
			() => runtime.store.cleanupTemporaryAssets?.(),
		));
		await guard(runtime.refreshStorageUsage());
		if (runtime.hasMissingTimelineSources()) runtime.setStatus(runtime.copy.missingSourcesBlocked, 'error');
		else if (!runtime.state.readOnly && !runtime.state.takeCycleRecovery
			&& !runtime.state.takeCycleRecoveryInspecting) runtime.setStatus(runtime.copy.ready, 'success');
	}

	function registerDeviceChangeListener(): void {
		if (typeof runtime.mediaDevices?.addEventListener !== 'function') return;
		const handleDeviceChange = () => {
			void Promise.resolve(runtime.refreshAudioDevices({ probe: false })).catch((error: unknown) => {
				if (!runtime.isDisposed()) runtime.handleError(error);
			});
		};
		runtime.mediaDevices.addEventListener('devicechange', handleDeviceChange);
		runtime.setRemoveDeviceChangeListener(() => {
			runtime.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
		});
	}
}

async function runProjectBootstrapOperation(
	operation: () => PromiseLike<unknown> | unknown,
): Promise<true> {
	await operation();
	return true;
}
