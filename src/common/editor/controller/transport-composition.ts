/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MicrophoneMeterService } from './microphone-meter-service.ts';
import {
	createEditorTransportService,
	type TransportCopy,
	type TransportEngine,
	type TransportProject,
	type TransportServiceRuntime,
	type TransportServiceState,
} from './transport-service.ts';
import {
	createViewStateService,
	type ViewStateProject,
	type ViewStateServiceRuntime,
	type ViewStateServiceState,
} from './view-state-service.ts';

/** What the transport and the timeline view together read from the active document. */
export type TransportCompositionProject = TransportProject & ViewStateProject;

export type TransportCompositionState = TransportServiceState & ViewStateServiceState;

export type TransportCompositionCopy = TransportCopy & ViewStateServiceRuntime['copy'];

type TransportPorts = Omit<TransportServiceRuntime<TransportCompositionProject>,
	| 'AUDIO_EDITOR_SAMPLE_RATE' | 'copy' | 'engine' | 'state'
>;
type ViewPorts = Omit<ViewStateServiceRuntime<TransportCompositionProject>,
	| 'MAX_PIXELS_PER_SECOND' | 'copy' | 'getMicrophoneMeterSession' | 'getProject' | 'getRoutedInputLoudnessMeter'
	| 'projectDurationFrames' | 'projectSampleRate' | 'state' | 'stopMicrophoneMetering' | 'syncMetronome'
	| 'editorTimelineDurationFrames' | 'commit'
>;

export interface TransportCompositionDependencies extends TransportPorts, ViewPorts {
	readonly state: TransportCompositionState;
	readonly engine: TransportEngine;
	readonly copy: TransportCompositionCopy;
	readonly sampleRate: number;
	readonly maximumPixelsPerSecond: number;
	readonly microphoneMeter: Pick<MicrophoneMeterService, 'getSession' | 'getRoutedLoudnessMeter' | 'stopMicrophoneMetering'>;
}

/**
 * Build the transport domain: the transport service that owns play, loop,
 * play-at-speed and the metronome, and the view-state service that publishes
 * the playhead, transport state and meters the engine reports and owns the
 * timeline's zoom and track heights. The view resynchronises the metronome
 * through the transport, which is the only edge between them.
 */
export function createTransportComposition(dependencies: TransportCompositionDependencies) {
	const { state, engine, copy, microphoneMeter } = dependencies;
	const transport = createEditorTransportService<TransportCompositionProject>({
		AUDIO_EDITOR_SAMPLE_RATE: dependencies.sampleRate,
		abortError: dependencies.abortError,
		activeSelection: dependencies.activeSelection,
		assertPlayAtSpeedStaffPadMemorySafe: dependencies.assertPlayAtSpeedStaffPadMemorySafe,
		beginPlaybackCachePreparation: dependencies.beginPlaybackCachePreparation,
		calculateAudioEditorMetronomeSchedule: dependencies.calculateAudioEditorMetronomeSchedule,
		cancelPlaybackCachePreparation: dependencies.cancelPlaybackCachePreparation,
		cancelTimedRecording: dependencies.cancelTimedRecording,
		commit: dependencies.commit,
		copy,
		editorTimelineDurationFrames: dependencies.editorTimelineDurationFrames,
		engine,
		formatPlaybackRate: dependencies.formatPlaybackRate,
		hasMissingTimelineSources: dependencies.hasMissingTimelineSources,
		persistSetting: dependencies.persistSetting,
		playAtSpeedPitchPreserver: dependencies.playAtSpeedPitchPreserver,
		productSettingKey: dependencies.productSettingKey,
		getProject: dependencies.getProject,
		projectDurationFrames: dependencies.projectDurationFrames,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setSelection: dependencies.setSelection,
		setStatus: dependencies.setStatus,
		startRecording: dependencies.startRecording,
		state,
		stopProjectBinPreview: dependencies.stopProjectBinPreview,
		stopRecording: dependencies.stopRecording,
		throwIfAborted: dependencies.throwIfAborted,
	});
	const view = createViewStateService<TransportCompositionProject>({
		MAX_PIXELS_PER_SECOND: dependencies.maximumPixelsPerSecond,
		commit: dependencies.commit,
		copy,
		editingBlocked: dependencies.editingBlocked,
		editorTimelineDurationFrames: dependencies.editorTimelineDurationFrames,
		findTrack: dependencies.findTrack,
		getMicrophoneMeterSession: microphoneMeter.getSession,
		getProject: dependencies.getProject,
		getRoutedInputLoudnessMeter: microphoneMeter.getRoutedLoudnessMeter,
		projectDurationFrames: dependencies.projectDurationFrames,
		projectSampleRate: transport.projectSampleRate,
		publishProjectState: dependencies.publishProjectState,
		publishTelemetrySnapshot: dependencies.publishTelemetrySnapshot,
		sampleEditingAvailable: dependencies.sampleEditingAvailable,
		state,
		stopMicrophoneMetering: microphoneMeter.stopMicrophoneMetering,
		syncMetronome: transport.syncMetronome,
	});
	return Object.freeze({ transport, view });
}

export type TransportComposition = ReturnType<typeof createTransportComposition>;
