/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRecordingRoutingService } from '../../src/common/editor/controller/recording-routing-service.ts';
import type {
	RecordingPreferencePatch,
	RecordingRoutingCapturePool,
	RecordingRoutingDeviceRow,
	RecordingRoutingMediaDevice,
	RecordingRoutingServiceRuntime,
	RecordingRoutingState,
} from '../../src/common/editor/controller/recording-routing-service-types.d.ts';
import type {
	RecordingInputRoute,
	RecordingInputRouting,
	RecordingPoolSource,
} from '../../src/common/editor/controller/recording-input-coordination-service.ts';

interface TestProject {
	readonly id: string;
	readonly tracks: ReadonlyArray<{ readonly id: string }>;
}

export type OutputDeviceResult = Readonly<{ readonly activeDeviceId?: string }> | null | undefined;
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
type FixtureState = Mutable<Omit<RecordingRoutingState, 'preferences'>> & Readonly<{
	preferences: Readonly<{ recording: { retainInputs: boolean } }>;
}>;

interface FixtureOptions {
	readonly project?: TestProject | null;
	readonly loadSetting?: (key: string, fallback: unknown) => Promise<unknown>;
	readonly normalizeRouting?: (
		saved?: Parameters<RecordingRoutingServiceRuntime<TestProject>['normalizeRecordingRouting']>[0],
		tracks?: TestProject['tracks'] | null,
	) => RecordingInputRouting;
	readonly enumerateDevices?: () => Promise<readonly RecordingRoutingMediaDevice[]>;
	readonly acquireHardware?: (deviceId: string) => Promise<unknown>;
	readonly persistSetting?: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
	readonly setOutputDevice?: (deviceId: string) => Promise<OutputDeviceResult>;
}

export function createFixture(options: FixtureOptions = {}) {
	const project = options.project === undefined
		? { id: 'project', tracks: [{ id: 'track' }] }
		: options.project;
	const normalizationCalls: Array<{ saved: unknown; tracks: unknown }> = [];
	const loadCalls: Array<[string, unknown]> = [];
	const hardwareRequests: string[] = [];
	const persistCalls: Array<[string, unknown, unknown]> = [];
	const stopMeterCalls: unknown[] = [];
	const assignedTrackIds: string[] = [];
	const releasedHardware: string[] = [];
	let publishes = 0;
	let meterInvalidations = 0;
	let releaseAllCalls = 0;
	let releaseDisplayCalls = 0;
	let poolSources: readonly RecordingPoolSource[] = [];
	const state: FixtureState = {
		recordingRouting: {
			routes: {} as Record<string, RecordingInputRoute>,
			offsets: {} as Record<string, number>,
		},
		recordingDevices: [] as readonly RecordingRoutingDeviceRow[],
		recordingRouteHealth: {} as Record<string, string>,
		recordingEnumeratedDeviceIds: new Set<string>(),
		recordingPoolSources: [] as readonly RecordingPoolSource[],
		audioInputDevices: [],
		audioOutputDevices: [],
		audioInputAccess: false,
		preferredInputDeviceId: 'default',
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		activeOutputDeviceId: '',
		audioOutputStatus: 'default',
		selectedTrackId: 'track',
		preferences: { recording: { retainInputs: true } },
		recorder: null as object | null,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: null as object | null,
		recordingFinishing: false,
		recordingReleaseAfterStop: false,
		microphoneMetering: false,
	};
	const recordingCapturePool: RecordingRoutingCapturePool<unknown> = {
		async acquireHardware(deviceId: string) {
			hardwareRequests.push(deviceId);
			return options.acquireHardware?.(deviceId);
		},
		async acquireDisplay() {
			return undefined;
		},
		getSnapshot: () => poolSources,
		releaseAll() {
			releaseAllCalls += 1;
			poolSources = [];
			return 2;
		},
		releaseDisplay: () => {
			releaseDisplayCalls += 1;
			return true;
		},
		releaseHardware: (deviceId: string) => {
			releasedHardware.push(deviceId);
			return true;
		},
	};
	const runtime = {
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY: 'audio-devices',
		RECORDING_CHANNEL_COUNT_MAXIMUM: 32,
		RECORDING_DEFAULT_DEVICE_ID: 'default',
		RECORDING_DISPLAY_SOURCE_KEY: 'display',
		assignPreferredInputToTrack: (trackId: string) => {
			assignedTrackIds.push(trackId);
			return false;
		},
		engine: { setOutputDevice: options.setOutputDevice || (async (deviceId: string) => ({ activeDeviceId: deviceId })) },
		mediaDevices: {
			getUserMedia: () => undefined,
			getDisplayMedia: () => undefined,
			enumerateDevices: options.enumerateDevices || (async () => []),
		},
		microphoneMeterDeviceId: () => 'meter-device',
		getMicrophoneMeterSession: () => null,
		invalidateMicrophoneMeter: () => { meterInvalidations += 1; },
		normalizePreferredInputDeviceId: (value: unknown) => String(value || 'default'),
		normalizePreferredOutputDeviceId: (value: unknown) => String(value || ''),
		normalizeRecordingRouting(
			saved?: Parameters<RecordingRoutingServiceRuntime<TestProject>['normalizeRecordingRouting']>[0],
			tracks?: TestProject['tracks'] | null,
		) {
			normalizationCalls.push({ saved, tracks });
			return options.normalizeRouting?.(saved, tracks) || { routes: {}, offsets: {} };
		},
		persistSetting(key: string, value: unknown, persistOptions?: unknown) {
			persistCalls.push([key, value, persistOptions]);
			return options.persistSetting?.(key, value, persistOptions) ?? Promise.resolve(value);
		},
		productSettingKey: (key: string) => key,
		getProject: () => project,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { publishes += 1; },
		recordingCapturePool,
		recordingRouteSourceKey: (route: RecordingInputRoute) => (
			route.kind === 'display' ? 'display' : `device:${route.deviceId}`
		),
		recordingRoutingSettingKey: (projectId: string) => `routing:${projectId}`,
		setRecordingSourceOffset: (routing: RecordingInputRouting, sourceKey: string, value: unknown) => ({
			...routing,
			offsets: { ...routing.offsets, [sourceKey]: Number(value) || 0 },
		}),
		setRecordingTrackInput: async () => undefined,
		state,
		stopMicrophoneMetering: (stopOptions: Readonly<{ readonly releaseInput: boolean }>) => {
			stopMeterCalls.push(stopOptions);
		},
		store: {
			async loadSetting(key: string, fallback: unknown) {
				loadCalls.push([key, fallback]);
				return options.loadSetting?.(key, fallback) ?? fallback;
			},
		},
		updatePreferences: async (patch: RecordingPreferencePatch) => {
			state.preferences.recording.retainInputs = patch.recording.retainInputs;
			return state.preferences;
		},
	} satisfies RecordingRoutingServiceRuntime<TestProject, unknown>;
	return {
		service: createRecordingRoutingService(runtime),
		assignedTrackIds,
		state,
		hardwareRequests,
		loadCalls,
		normalizationCalls,
		persistCalls,
		releasedHardware,
		stopMeterCalls,
		setPoolSources: (sources: readonly RecordingPoolSource[]) => { poolSources = sources; },
		publishes: () => publishes,
		meterInvalidations: () => meterInvalidations,
		releaseAllCalls: () => releaseAllCalls,
		releaseDisplayCalls: () => releaseDisplayCalls,
	};
}

