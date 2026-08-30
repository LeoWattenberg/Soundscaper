/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TakeCycleLiveCaptureSession,
	TakeCycleLiveLaneCapture,
} from './take-cycle-live-capture-session.ts';
import type { TakeCycleRoutedPcmStream } from './take-cycle-routed-pcm-stream.ts';
import type {
	RecordingMediaStream,
	RecordingRoute,
	RecordingTrack,
} from './recording-transaction-types.ts';
import type {
	RecordingCaptureControllerLike,
	RecordingStartScope,
} from './recording-session-service.ts';

export interface TakeCycleRoutedPlannedLane {
	readonly track: RecordingTrack;
	readonly route: RecordingRoute;
	readonly sourceKey: string;
	readonly groupId: string;
	readonly sequenceId: string;
}

export interface TakeCycleRoutedLiveLane extends TakeCycleRoutedPlannedLane {
	capture: TakeCycleLiveLaneCapture | null;
	pcm: TakeCycleRoutedPcmStream | null;
	status: 'capturing' | 'sealed' | 'failed';
	error: unknown | null;
}

export interface TakeCycleRoutedLiveSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: RecordingMediaStream;
	readonly channelCount: number;
	readonly lanes: TakeCycleRoutedLiveLane[];
	controller: RecordingCaptureControllerLike | null;
	tail: Promise<void>;
	accepting: boolean;
	stopping: boolean;
	expectedFrameStart: number | null;
}

export interface TakeCycleRoutedActiveCapture {
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly scope: RecordingStartScope;
	readonly session: TakeCycleLiveCaptureSession;
	readonly lanes: TakeCycleRoutedLiveLane[];
	readonly sources: TakeCycleRoutedLiveSource[];
	cleanupLifetime: () => void;
	abortReason: unknown | null;
	abortPromise: Promise<void> | null;
}

export interface TakeCycleRoutedCaptureFailure {
	readonly reason: unknown;
	readonly source: TakeCycleRoutedLiveSource | null;
}
