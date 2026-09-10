/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MicrophoneMeterSession } from '../microphone-meter-service.ts';
import type { RecordingInputRoute, RecordingPoolSource } from './recording-input-coordination-service.ts';
import type {
	normalizePreferredInputDeviceId,
	normalizePreferredOutputDeviceId,
} from '../recording-model.ts';
import type { ControllerAudioDevice, ControllerRecordingRouting } from '../recording-state.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface RecordingRoutingTrack {
	readonly id: string;
	readonly type?: string;
}

export interface RecordingRoutingProject {
	readonly id: string;
	readonly tracks: readonly RecordingRoutingTrack[];
}

export interface PersistedRecordingRouting {
	readonly routes?: Readonly<Record<string, unknown>> | null;
	readonly offsets?: Readonly<Record<string, unknown>> | null;
}

/** A browser or native device after it has crossed the inventory adapter. */
export interface RecordingRoutingDeviceRow extends ControllerAudioDevice {
	readonly channels?: readonly unknown[];
}

export interface RecordingRoutingMediaDevice {
	readonly deviceId: string;
	readonly groupId?: string;
	readonly kind: string;
	readonly label?: string;
}

export interface RecordingRoutingMediaDevices {
	readonly getUserMedia?: () => unknown;
	readonly getDisplayMedia?: () => unknown;
	readonly enumerateDevices?: () => PromiseLike<readonly RecordingRoutingMediaDevice[]>;
}

export interface RecordingRoutingNativeInventory {
	readonly inputs: readonly RecordingRoutingDeviceRow[];
	readonly outputs: readonly RecordingRoutingDeviceRow[];
}

export interface RecordingRoutingRefreshOptions {
	readonly nativeInventory?: RecordingRoutingNativeInventory | null;
	readonly probe?: boolean;
	readonly publish?: boolean;
}

export interface RecordingRoutingCapturePool<Stream = unknown> {
	acquireHardware(
		deviceId: string,
		options: Readonly<{ readonly channelCount: number; readonly sampleRate: number }>,
	): Awaitable<Stream>;
	acquireDisplay(): Awaitable<Stream>;
	replaceDisplay?(): Awaitable<Stream>;
	getDisplay?(): Stream | null;
	getSnapshot?(): readonly RecordingPoolSource[];
	releaseHardware(deviceId: string): boolean;
	releaseDisplay(): boolean;
	releaseAll(): boolean | number;
}

export interface RecordingRoutingState {
	recordingRouting: ControllerRecordingRouting;
	recordingDevices: readonly RecordingRoutingDeviceRow[];
	recordingEnumeratedDeviceIds: Set<string>;
	recordingPoolSources: readonly RecordingPoolSource[];
	recordingRouteHealth: Record<string, string>;
	recordingReleaseAfterStop: boolean;
	audioInputDevices: readonly ControllerAudioDevice[];
	audioOutputDevices: readonly ControllerAudioDevice[];
	audioInputAccess: boolean;
	preferredInputDeviceId: string;
	preferredInputChannelCount: number;
	preferredOutputDeviceId: string;
	activeOutputDeviceId: string;
	audioOutputStatus: string;
	microphoneMetering: boolean;
	recorder: object | null;
	recordingStarting: boolean;
	recordingFinishing: boolean;
	timedRecordingPreparing: boolean;
	timedRecording: object | null;
	readonly selectedTrackId: string | null;
	readonly preferences: Readonly<{ readonly recording: Readonly<{ readonly retainInputs: boolean }> }>;
}

export interface RecordingPreferencePatch {
	readonly recording: Readonly<{ readonly retainInputs: boolean }>;
}

export interface RecordingRoutingServiceRuntime<
	Project extends RecordingRoutingProject = RecordingRoutingProject,
	Stream = unknown,
> {
	readonly AUDIO_DEVICE_PREFERENCES_SETTING_KEY: string;
	readonly RECORDING_CHANNEL_COUNT_MAXIMUM: number;
	readonly RECORDING_DEFAULT_DEVICE_ID: string;
	readonly RECORDING_DISPLAY_SOURCE_KEY: string;
	readonly assignPreferredInputToTrack: (trackId: string) => boolean;
	readonly engine: Readonly<{
		setOutputDevice?: (
			deviceId: string,
		) => Awaitable<Readonly<{ readonly activeDeviceId?: string }> | null | undefined>;
	}>;
	readonly mediaDevices?: RecordingRoutingMediaDevices | null;
	readonly microphoneMeterDeviceId: () => string;
	readonly getMicrophoneMeterSession: () => Pick<MicrophoneMeterSession, 'deviceId'> | null;
	readonly invalidateMicrophoneMeter: () => unknown;
	readonly normalizePreferredInputDeviceId: typeof normalizePreferredInputDeviceId;
	readonly normalizePreferredOutputDeviceId: typeof normalizePreferredOutputDeviceId;
	readonly normalizeRecordingRouting: (
		value?: PersistedRecordingRouting | null,
		tracks?: readonly RecordingRoutingTrack[] | null,
	) => ControllerRecordingRouting;
	readonly persistSetting: (
		key: string,
		value: unknown,
		options?: Readonly<{ readonly policy?: 'best-effort' | 'required' }>,
	) => Promise<unknown>;
	readonly productSettingKey: (name: string) => string;
	readonly getProject: () => Project | null;
	readonly projectSampleRate: () => number;
	readonly publishDocumentSnapshot: () => void;
	readonly recordingCapturePool: RecordingRoutingCapturePool<Stream>;
	readonly recordingRouteSourceKey: (route: RecordingInputRoute) => string;
	readonly recordingRoutingSettingKey: (projectId: string) => string;
	readonly setRecordingSourceOffset: (
		routing: ControllerRecordingRouting,
		sourceKey: string,
		offset: unknown,
	) => ControllerRecordingRouting;
	readonly setRecordingTrackInput: (
		trackId: string,
		route: RecordingInputRoute | null,
	) => Awaitable<unknown>;
	readonly state: RecordingRoutingState;
	readonly stopMicrophoneMetering: (
		options: Readonly<{ readonly releaseInput: boolean }>,
	) => unknown;
	readonly store: Readonly<{
		loadSetting(key: string, fallback: unknown): PromiseLike<unknown> | unknown;
	}>;
	readonly updatePreferences: (patch: RecordingPreferencePatch) => Promise<unknown>;
}
