/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleCaptureOrchestrator } from './take-cycle-capture-orchestrator.ts';
import type {
	TakeCycleFinalizationResult,
	TakeCycleRecordingOptions,
} from './take-cycle-recording-service.ts';
import type { TakeCycleRoutedResamplerFactory } from './take-cycle-routed-pcm-stream.ts';
import type { TakeCycleRoutedCaptureProject } from './take-cycle-routed-capture-validation.ts';
import type {
	RecordingAudioContext,
	RecordingCapturePool,
	RecordingControllerFactory,
	RecordingMediaStream,
	RecordingRoute,
	RecordingSelection,
} from './recording-transaction-types.ts';
import type { RecordingStartScope } from './recording-session-service.ts';

export type { TakeCycleRoutedCaptureProject } from './take-cycle-routed-capture-validation.ts';

export interface TakeCycleRoutedCaptureEngine {
	getAudioContext(): Promise<RecordingAudioContext>;
	setLoop(loop: Readonly<{ readonly enabled: true; readonly startFrame: number; readonly endFrame: number }>): unknown;
	seek(frame: number): unknown;
	playAt(contextTime: number, frame: number): Promise<unknown>;
	pause(): void;
}

export interface TakeCycleRoutedCaptureRuntime {
	readonly orchestrator: Pick<TakeCycleCaptureOrchestrator, 'beginLiveSession'>;
	readonly capturePool: RecordingCapturePool;
	readonly engine: TakeCycleRoutedCaptureEngine;
	readonly sourceChunkFrames: number;
	getProject(): TakeCycleRoutedCaptureProject;
	getRoutes(): Readonly<Record<string, RecordingRoute>>;
	activeSelection(project: TakeCycleRoutedCaptureProject): RecordingSelection | null;
	soundActivationEnabled(): boolean;
	recordingRouteSourceKey(route: RecordingRoute): string;
	streamAudioChannelCount(stream: RecordingMediaStream): number;
	recordingStreamIsLive(stream: RecordingMediaStream, kind: 'device' | 'display'): boolean;
	createRecorder: RecordingControllerFactory;
	createGroupId(trackId: string): string;
	createRecordingName(trackId: string): string;
	preflightStorage(requiredBytes: number, operation: 'take-cycle-recording'): Promise<void>;
	beginPlaybackCachePreparation(project: TakeCycleRoutedCaptureProject): Promise<unknown>;
	handleError(error: unknown): void;
	createResampler?: TakeCycleRoutedResamplerFactory;
	releaseInputs?(): void;
	readonly monitor?: boolean;
	readonly inputGain?: number;
}

export interface TakeCycleRoutedCaptureStartRequest {
	readonly kind: 'take-cycle-routed-capture';
}

export interface TakeCycleRoutedStartedLane {
	readonly trackId: string;
	readonly groupId: string;
	readonly laneId: string;
}

export interface TakeCycleRoutedCaptureStarted {
	readonly kind: 'take-cycle-routed-capture-started';
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly lanes: readonly TakeCycleRoutedStartedLane[];
}

export interface TakeCycleRoutedLaneResult {
	readonly trackId: string;
	readonly groupId: string;
	readonly laneId: string | null;
	readonly status: 'committed' | 'failed';
	readonly error: unknown | null;
}

export interface TakeCycleRoutedCaptureResult {
	readonly kind: 'take-cycle-routed-capture-result';
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly lanes: readonly TakeCycleRoutedLaneResult[];
	readonly finalization: TakeCycleFinalizationResult | null;
}

export interface TakeCycleRoutedCaptureService {
	readonly active: boolean;
	start(
		request: TakeCycleRoutedCaptureStartRequest,
		scope: RecordingStartScope,
	): Promise<TakeCycleRoutedCaptureStarted>;
	stop(options?: TakeCycleRecordingOptions): Promise<TakeCycleRoutedCaptureResult>;
	pause(): never;
}
