/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EnginePlayAtSpeedOptions, EnginePublicApi } from '../engine/public-api.ts';
import type { calculateAudioEditorMetronomeSchedule } from './transport-model.ts';
import type { ControllerTransportState } from './transport-state.ts';

export interface TransportLoop {
	readonly enabled?: boolean;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface TransportSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly frequencyRange?: unknown;
}

/** What the transport reads from the active document. */
export interface TransportProject {
	readonly sampleRate?: number;
	readonly loop?: TransportLoop | null;
	readonly selection?: TransportSelection | null;
	readonly tempo?: Readonly<{ readonly bpm?: unknown; readonly timeSignature?: unknown }>;
	readonly tempoMap?: unknown;
	readonly signatureMap?: unknown;
}

export type TransportEngine = Pick<EnginePublicApi,
	| 'getAudioContext' | 'getPositionFrames' | 'getState' | 'pause' | 'play' | 'playAtSpeed'
	| 'seek' | 'setLoop' | 'setPlayRange' | 'stop'
>;

export interface TransportServiceState extends Pick<ControllerTransportState,
	| 'metronomeAnchor' | 'metronomeEnabled' | 'metronomePending' | 'metronomeTimer'
	| 'playAtSpeedAbort' | 'playAtSpeedGeneration' | 'playAtSpeedRate' | 'playbackCacheAbort'
	| 'selectionFollowsLoop' | 'transportState'
> {
	readonly disposed: boolean;
	readonly preferences: Readonly<{ readonly playback?: Readonly<{ readonly playAtSpeedMode?: unknown }> }>;
	readonly projectBinPreview: unknown;
	readonly recorder: unknown;
	readonly recordingStarting: boolean;
	readonly selectedClipId: string | null;
	readonly timedRecording: unknown;
	readonly timedRecordingPreparing: boolean;
}

export interface TransportCopy {
	readonly ready: string;
	readonly localSourcesMissing: string;
	readonly playAtSpeedPreparing: string;
	readonly playAtSpeedPlaying: string;
	readonly timeSelectionRequired: string;
	readonly timelineFramesFinite: string;
}

export type TransportLoopCommand = Readonly<{
	readonly type: 'loop/set';
	readonly enabled?: boolean;
	readonly startFrame: number;
	readonly endFrame: number;
}>;
export type TransportCommand = TransportLoopCommand | Readonly<{
	readonly type: 'batch';
	readonly commands: readonly unknown[];
}>;

export interface TransportServiceRuntime<Project extends TransportProject = TransportProject> {
	readonly AUDIO_EDITOR_SAMPLE_RATE: number;
	readonly abortError: () => Error;
	readonly activeSelection: () => TransportSelection | null;
	readonly assertPlayAtSpeedStaffPadMemorySafe: (
		durationFrames: number,
		sampleRate: number,
		playbackRate: number,
	) => unknown;
	readonly beginPlaybackCachePreparation: (
		project: Project | null,
		options?: Readonly<{ readonly abortController?: AbortController }>,
	) => Promise<unknown>;
	readonly calculateAudioEditorMetronomeSchedule: typeof calculateAudioEditorMetronomeSchedule;
	readonly cancelPlaybackCachePreparation: () => unknown;
	readonly cancelTimedRecording: () => unknown;
	/** Apply a loop or batch command and return the document it produced. */
	readonly commit: (command: TransportCommand) => Project & Readonly<{ readonly loop: TransportLoop }>;
	readonly copy: TransportCopy;
	readonly editorTimelineDurationFrames: (project: Project | null, sampleRate: number) => number;
	readonly engine: TransportEngine;
	readonly formatPlaybackRate: (rate: number) => string;
	readonly hasMissingTimelineSources: () => boolean;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly playAtSpeedPitchPreserver: EnginePlayAtSpeedOptions['pitchPreserver'];
	readonly productSettingKey: (name: string) => string;
	readonly getProject: () => Project | null;
	readonly projectDurationFrames: (project: Project | null) => number;
	readonly publishDocumentSnapshot: () => void;
	readonly setSelection: (startFrame: number, endFrame: number) => unknown;
	readonly setStatus: (message: string, state?: 'info' | 'success' | 'error') => void;
	readonly startRecording: () => unknown;
	readonly state: TransportServiceState;
	readonly stopProjectBinPreview: () => PromiseLike<unknown> | unknown;
	readonly stopRecording: () => unknown;
	readonly throwIfAborted: (signal: AbortSignal | null | undefined) => void;
}
