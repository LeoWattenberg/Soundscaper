/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingPreview } from './recording-model.ts';
import type { RecordingPoolSource } from './recording-input-coordination-service.ts';
import type { RecordingControllerLike } from './recording-session-service.ts';
import type {
	RecordingMediaStream,
	RecordingPreviewResampler,
	RecordingRoute,
	RecordingSelection,
	RecordingSourceWriter,
	RoutedRecordingEntry,
} from './recording-transaction-types.ts';
import type { TimedRecordingDescriptor } from './timed-recording-service.ts';

/** One row of the recording device inventory the routing service enumerates. */
export interface ControllerRecordingDevice {
	readonly deviceId: string;
	readonly label?: string;
	readonly channelCount?: number;
	readonly status?: string;
}

export interface ControllerRecordingRouting {
	readonly routes: Readonly<Record<string, RecordingRoute>>;
	readonly offsets: Readonly<Record<string, number>>;
}

/**
 * Every field the recording domain owns: the live capture session, its timed
 * arming, input routing and device inventory, monitoring and metering. The
 * controller state still exposes them flat for the services that read them
 * there, but they are declared, initialised and typed in one place.
 */
export interface ControllerRecordingState<Routing = ControllerRecordingRouting> {
	recorder: RecordingControllerLike | null;
	recordingKind: 'ordinary' | 'take-cycle' | null;
	recordingWriter: RecordingSourceWriter | null;
	recordingStream: RecordingMediaStream | null;
	recordingStarting: boolean;
	recordingStartGeneration: number;
	recordingStartPromise: Promise<void> | null;
	timedRecording: TimedRecordingDescriptor | null;
	timedRecordingTimer: unknown;
	timedRecordingGeneration: number;
	timedRecordingPreparing: boolean;
	timedRecordingCancelling: boolean;
	recordingPaused: boolean;
	recordingInputGain: number;
	leadInRecording: boolean;
	recordingSourceId: string | null;
	recordingStartFrame: number;
	recordingSourceOffsetFrames: number;
	recordingSampleRate: number | null;
	recordingTrackId: string | null;
	recordingSelection: RecordingSelection | null;
	recordingResampler: RecordingPreviewResampler | null;
	recordingPreview: RecordingPreview | null;
	recordingPreviews: RecordingPreview[];
	recordingEntries: readonly RoutedRecordingEntry[] | null;
	recordingPreviewLastPublishedAt: number;
	recordingCleanup: (() => void) | null;
	recordingFinishing: boolean;
	recordingFinalizePromise: Promise<void> | null;
	recordingFatalError: unknown;
	recordingDiscardRequested: boolean;
	recordingReleaseAfterStop: boolean;
	recordingRouting: Routing;
	recordingDevices: ControllerRecordingDevice[];
	recordingEnumeratedDeviceIds: Set<string>;
	audioInputDevices: unknown[];
	audioOutputDevices: unknown[];
	audioInputAccess: boolean;
	preferredInputDeviceId: string;
	preferredInputChannelCount: number;
	preferredOutputDeviceId: string;
	activeOutputDeviceId: string;
	audioOutputStatus: string;
	recordingRouteHealth: Record<string, string>;
	recordingPoolSources: RecordingPoolSource[];
	inputMeters: Record<string, number>;
	monitoring: boolean;
	microphoneMetering: boolean;
	latencyOffsetMs: number;
	inputMeterDb: number;
	inputMeter: unknown;
	inputLoudnessMeasurementManuallyPaused: boolean;
	inputLoudnessMeasurementExplicitlyRunning: boolean;
}

export interface ControllerRecordingStateOptions<Routing> {
	readonly recordingRouting: Routing;
	readonly recordingInputGain: number;
	readonly preferredInputDeviceId: string;
}

export function createControllerRecordingState<Routing = ControllerRecordingRouting>({
	recordingRouting,
	recordingInputGain,
	preferredInputDeviceId,
}: ControllerRecordingStateOptions<Routing>): ControllerRecordingState<Routing> {
	return {
		recorder: null,
		recordingKind: null,
		recordingWriter: null,
		recordingStream: null,
		recordingStarting: false,
		recordingStartGeneration: 0,
		recordingStartPromise: null,
		timedRecording: null,
		timedRecordingTimer: null,
		timedRecordingGeneration: 0,
		timedRecordingPreparing: false,
		timedRecordingCancelling: false,
		recordingPaused: false,
		recordingInputGain,
		leadInRecording: false,
		recordingSourceId: null,
		recordingStartFrame: 0,
		recordingSourceOffsetFrames: 0,
		recordingSampleRate: null,
		recordingTrackId: null,
		recordingSelection: null,
		recordingResampler: null,
		recordingPreview: null,
		recordingPreviews: [],
		recordingEntries: null,
		recordingPreviewLastPublishedAt: 0,
		recordingCleanup: null,
		recordingFinishing: false,
		recordingFinalizePromise: null,
		recordingFatalError: null,
		recordingDiscardRequested: false,
		recordingReleaseAfterStop: false,
		recordingRouting,
		recordingDevices: [],
		recordingEnumeratedDeviceIds: new Set(),
		audioInputDevices: [],
		audioOutputDevices: [],
		audioInputAccess: false,
		preferredInputDeviceId,
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		activeOutputDeviceId: '',
		audioOutputStatus: 'default',
		recordingRouteHealth: {},
		recordingPoolSources: [],
		inputMeters: {},
		monitoring: false,
		microphoneMetering: false,
		latencyOffsetMs: 0,
		inputMeterDb: -60,
		inputMeter: null,
		inputLoudnessMeasurementManuallyPaused: false,
		inputLoudnessMeasurementExplicitlyRunning: false,
	};
}
