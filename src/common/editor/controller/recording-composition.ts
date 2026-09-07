/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddSourceCommand, preparePunchCommand } from '../commands.js';
import { createEbuR128Meter } from '../ebu-r128.js';
import { AUDIO_EDITOR_SAMPLE_RATE, createStableId, findSource, findTrack } from '../project.js';
import { RECORDING_CHANNEL_COUNT_MAXIMUM, normalizeRecordingInputGain } from '../recording.js';
import {
	RECORDING_DEFAULT_DEVICE_ID,
	RECORDING_DISPLAY_SOURCE_KEY,
	normalizeRecordingRouting,
	recordingRouteSourceKey,
	recordingRoutingSettingKey,
	setRecordingSourceOffset,
	setRecordingTrackRoute,
} from '../recording-routing.js';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { abortError } from './app-helpers.ts';
import { createLegacyRecordingCaptureService } from './legacy-recording-capture-service.ts';
import { createLegacyRecordingFinalization } from './legacy-recording-finalization.ts';
import type { RecordingFinalizationCommonRuntime } from './recording-finalization-types.ts';
import {
	createRecordingInputCoordinationService,
	type RecordingInputRoute,
} from './recording-input-coordination-service.ts';
import {
	appendRecordingPreview,
	createRecordingPreview,
	normalizeLatencyOffset,
	normalizePreferredInputDeviceId,
	normalizePreferredOutputDeviceId,
	normalizeTimedRecordingStart,
	recordingStreamIsLive,
	scaleRecordingFrames,
	streamAudioChannelCount,
} from './recording-model.ts';
import { createRecordingRoutingService } from './recording-routing-service.ts';
import {
	createRecordingSessionService,
	createRoutedRecordingController,
} from './recording-session-service.ts';
import type {
	RecordingCaptureCommonRuntime,
	RecordingSelection,
} from './recording-transaction-types.ts';
import { createRoutedRecordingCaptureService } from './routed-recording-capture-service.ts';
import { createRoutedRecordingFinalization } from './routed-recording-finalization.ts';
import { SOURCE_CHUNK_FRAMES, createCoalescingSourceWriter } from './source-audio.ts';
import { createTakeCycleAppComposition } from './take-cycle-app-composition.ts';
import { createTakeCycleOpenRecoveryCoordinator } from './take-cycle-open-recovery-app-port.ts';
import { createTakeCycleRecordingAppSession } from './take-cycle-recording-app-session.ts';
import { createTimedRecordingInputService } from './timed-recording-input-service.ts';
import { createTimedRecordingService } from './timed-recording-service.ts';
import { peakCacheKey } from './waveform-analysis.ts';
import type {
	RecordingCompositionDependencies,
	RecordingCompositionEngine,
	RecordingCompositionProject,
} from './recording-composition-types.ts';
import type { AudioEditorProjectV17 } from '../project-v17-validation.ts';

export type {
	RecordingCompositionCopy,
	RecordingCompositionDependencies,
	RecordingCompositionEngine,
	RecordingCompositionProject,
	RecordingCompositionState,
	RecordingCompositionStore,
} from './recording-composition-types.ts';

export const AUDIO_DEVICE_PREFERENCES_SETTING_KEY = 'audio-device-preferences-v1';
const LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS = 80;
const MAXIMUM_TIMER_DELAY_MS = 2_147_000_000;

/**
 * Build the recording domain: input routing and device inventory, the capture
 * and finalization transactions for legacy and routed recorders, take-cycle
 * recording with its open recovery, timed recording, and the session that
 * sequences them. The services refer to one another only through the
 * closures below, so the controller never holds their wiring order.
 */
export function createRecordingComposition(dependencies: RecordingCompositionDependencies) {
	const { state, engine, copy, locale, store, microphoneMeter, soundActivation, capturePool } = dependencies;
	const requireProject = (): RecordingCompositionProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Recording requires an open project.');
		return project;
	};
	const projectSampleRateOf = ({ sampleRate }: Readonly<{ readonly sampleRate?: number }>): number => (
		sampleRate !== undefined && Number.isSafeInteger(sampleRate) && sampleRate > 0 ? sampleRate : AUDIO_EDITOR_SAMPLE_RATE
	);
	const activeSelectionOf = ({ selection }: Readonly<{ readonly selection?: unknown }>): RecordingSelection | null => (
		isRecordingSelection(selection) && selection.endFrame > selection.startFrame ? selection : null
	);
	const routing = createRecordingRoutingService({
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY,
		RECORDING_CHANNEL_COUNT_MAXIMUM,
		RECORDING_DEFAULT_DEVICE_ID,
		RECORDING_DISPLAY_SOURCE_KEY,
		assignPreferredInputToTrack: dependencies.assignPreferredInputToTrack,
		engine,
		getMicrophoneMeterSession: microphoneMeter.getSession,
		invalidateMicrophoneMeter: microphoneMeter.invalidate,
		mediaDevices: dependencies.mediaDevices,
		microphoneMeterDeviceId: microphoneMeter.getDeviceId,
		normalizePreferredInputDeviceId,
		normalizePreferredOutputDeviceId,
		normalizeRecordingRouting,
		persistSetting: dependencies.persistSetting,
		productSettingKey: dependencies.productSettingKey,
		getProject: dependencies.getProject,
		projectSampleRate: dependencies.projectSampleRate,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		recordingCapturePool: capturePool,
		recordingRouteSourceKey,
		recordingRoutingSettingKey,
		setRecordingSourceOffset,
		setRecordingTrackInput: (trackId: string, route: RecordingInputRoute | null) => (
			inputs.setRecordingTrackInput(trackId, route)
		),
		state,
		stopMicrophoneMetering: microphoneMeter.stopMicrophoneMetering,
		store,
		updatePreferences: dependencies.updatePreferences,
	});
	const releaseUnretainedRecordingInputs = (options: Readonly<{ readonly force?: boolean }> = {}): void => {
		routing.releaseUnretainedRecordingInputs({ force: options.force === true });
	};
	const syncRecordingPoolSnapshot = (): void => { routing.syncRecordingPoolSnapshot(); };
	const publishRecordingPreview = (): void => {
		const now = globalThis.performance?.now?.() ?? Date.now();
		if (now - state.recordingPreviewLastPublishedAt < LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS) return;
		state.recordingPreviewLastPublishedAt = now;
		dependencies.publishDocumentSnapshot();
	};

	const captureRuntime: RecordingCaptureCommonRuntime & Readonly<{ engine: RecordingCompositionEngine }> = {
		state,
		soundActivation,
		engine,
		capturePool,
		defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		messages: {
			armTrack: copy.armTrackForRecording,
			preparedInputClosed: copy.recordingPreparedInputClosed,
			recording: copy.recording,
			recordingLabel: copy.recordingLabel,
			timedRecordingPast: copy.timedRecordingPast,
			assignInput: copy.recordingAssignInput,
			noInputsAvailable: copy.recordingNoInputsAvailable,
		},
		getProject: requireProject,
		findTrack: (project, trackId) => findTrack(project, trackId) || null,
		projectSampleRate: projectSampleRateOf,
		activeSelection: activeSelectionOf,
		beginPlaybackCachePreparation: dependencies.beginPlaybackCachePreparation,
		currentTimeMs: dependencies.currentTimeMs,
		createStableId,
		createRecordingName: () => `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
		openSourceWriter: async (sourceId, metadata) => createCoalescingSourceWriter(
			await store.beginSourceWrite(sourceId, metadata),
		),
		createPreview: createRecordingPreview,
		createPreviewResampler: createStreamingWindowedSincResampler,
		appendPreview: appendRecordingPreview,
		scaleFrames: scaleRecordingFrames,
		streamAudioChannelCount,
		recordingStreamIsLive,
		createRecorder: dependencies.createRecorder,
		preflightStorage: dependencies.preflightStorage,
		startMicrophoneMetering: () => microphoneMeter.startMicrophoneMetering({ force: true }),
		syncRecordingPoolSnapshot,
		releaseUnretainedRecordingInputs: () => releaseUnretainedRecordingInputs(),
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		publishRecordingPreview,
		updatePlayhead: () => { dependencies.updatePlayhead(); },
		stopRecording: () => session.stopRecording(),
		finalizeRecording: () => session.finalizeRecording(),
		handleError: dependencies.handleError,
		setStatus: dependencies.setStatus,
		updateTransportState: dependencies.updateTransportState,
	};
	const legacyCapture = createLegacyRecordingCaptureService(captureRuntime);
	const routedCapture = createRoutedRecordingCaptureService({
		...captureRuntime,
		recordingRouteSourceKey,
		createRoutedController: createRoutedRecordingController,
		createLoudnessMeter: createEbuR128Meter,
		getLoudnessMeter: () => ({
			meter: microphoneMeter.getRoutedLoudnessMeter(),
			key: microphoneMeter.getRoutedLoudnessMeterKey(),
		}),
		setLoudnessMeter: microphoneMeter.setRoutedLoudnessMeter,
	});

	const finalizationRuntime: RecordingFinalizationCommonRuntime = {
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		captureProjectScope: () => {
			const captured = dependencies.getProject();
			if (!captured) throw abortError();
			const token = dependencies.projectGeneration.capture(captured.id);
			return Object.freeze({
				project: captured,
				projectId: captured.id,
				assertCurrent: () => {
					dependencies.projectGeneration.assertCurrent(token);
					if (dependencies.getProject() !== captured) throw abortError();
				},
			});
		},
		projectSampleRate: projectSampleRateOf,
		pauseTransport: () => engine.pause(),
		disposeRecorder: async (recorder) => { await recorder.dispose?.({ stopTracks: false }); },
		appendPreview: appendRecordingPreview,
		scaleFrames: scaleRecordingFrames,
		createStableId,
		createAddSourceCommand,
		preparePunchCommand,
		activateStoredSource: async (source, metadata) => { await dependencies.activateStoredSource(source, metadata); },
		commitBatch: (project, commands, selection) => {
			if (project !== dependencies.getProject()) throw abortError();
			dependencies.commit({ type: 'batch', commands }, selection);
		},
		setStatusDone: () => dependencies.setStatus(copy.done, 'success'),
		deactivateSource: async (sourceId) => {
			dependencies.sourceBuffers.delete(sourceId);
			dependencies.sourceChunkProviders.delete(sourceId);
			engine.setChunkSources(dependencies.sourceChunkProviders);
			await dependencies.sourceChunkProviders.drain();
			dependencies.sourcePeaks.delete(sourceId);
		},
		deleteStoredSource: (sourceId) => store.deleteSource(sourceId),
	};
	const legacyFinalization = createLegacyRecordingFinalization(finalizationRuntime);
	const routedFinalization = createRoutedRecordingFinalization({
		...finalizationRuntime,
		setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
		deleteSourceAnalysis: async (sourceId) => store.deleteAnalysis?.(peakCacheKey(sourceId)),
	});

	const takeCycle = createTakeCycleAppComposition({
		lifetime: dependencies.lifetime,
		store,
		session: dependencies.session,
		projectGeneration: dependencies.projectGeneration,
		state,
		recording: captureRuntime,
		getProject: dependencies.getProject,
		setProject: dependencies.setProject,
		activeSelection: activeSelectionOf,
		findAudioSource: (project, mediaId) => findSource(project, mediaId),
		trackName: (project, trackId) => findTrack(project, trackId)?.name || copy.recordingLabel,
		getRoutes: () => state.recordingRouting.routes,
		soundActivationEnabled: () => soundActivation.getSnapshot().preferences.enabled,
		recordingRouteSourceKey,
		createId: createStableId,
		createRecordingName: (name) => `${name} ${new Date().toLocaleTimeString(locale)}`,
		preflightRecording: (bytes) => dependencies.preflightStorage(bytes, 'recording'),
		releaseInputs: () => releaseUnretainedRecordingInputs(),
		activateStoredSource: (source, metadata) => (
			dependencies.activateStoredSource(source, metadata, { requireChunkStream: true })
		),
		// The product runtime edits its own document family; the take cycle is
		// typed against the audio schema it produces, which every family embeds.
		applyProjectCommand: (project, command, options) => (
			dependencies.projectRuntime.applyCommand(project, command, options) as AudioEditorProjectV17
		),
		validateProject: (project) => { dependencies.projectRuntime.cloneProject(project); },
		publishProject: () => { dependencies.retention.retainLiveClipIds(); dependencies.publishProjectState(); },
		synchronizeProject: async (project) => {
			await dependencies.applyProjectToPlaybackEngine(project);
			dependencies.publishProjectState();
		},
		now: () => new Date(dependencies.currentTimeMs()),
	});
	dependencies.openRecovery.bind(createTakeCycleOpenRecoveryCoordinator({
		state,
		inspect: takeCycle.inspectOpenRecovery,
		recover: takeCycle.recoverOnOpen,
		getCurrentProjectId: () => dependencies.getProject()?.id ?? null,
		isDisposed: () => state.disposed,
		isCurrentProjectWritable: () => Boolean(
			dependencies.getProject() && state.projectLock && !state.readOnly && !state.projectLock.readOnly,
		),
		publish: dependencies.publishDocumentSnapshot,
	}));
	const takeCycleSession = createTakeCycleRecordingAppSession({
		cycle: takeCycle,
		prepareCurrentProject: dependencies.flushProject,
		recordingMessage: copy.recording,
		setTransportState: dependencies.updateTransportState,
		setStatus: dependencies.setStatus,
	});

	const session = createRecordingSessionService({
		state,
		getProjectId: () => dependencies.getProject()?.id || null,
		abortError,
		addTrack: dependencies.addTrack,
		stopProjectBinPreview: dependencies.stopProjectBinPreview,
		cancelTimedRecording: () => timed.cancelTimedRecording(),
		beginRecording: (options, scope) => {
			const route = options.trackId ? state.recordingRouting.routes[options.trackId] : null;
			const routed = route && (
				route.kind === 'display'
				|| route.deviceId !== RECORDING_DEFAULT_DEVICE_ID
				|| route.channelStart > 0
				|| route.channelCount !== 2
			);
			return options.trackId && !routed
				? legacyCapture.capture(options, scope)
				: routedCapture.capture(options, scope);
		},
		beginTakeCycleRecording: takeCycleSession.begin,
		performLegacyFinalization: legacyFinalization.finalize,
		performRoutedFinalization: routedFinalization.finalize,
		releaseUnretainedRecordingInputs,
		retainInputs: () => state.preferences.recording.retainInputs,
		playTransport: () => engine.play(),
		pauseTransport: () => engine.pause(),
		getTransportState: () => engine.getState().state,
		updateTransportState: dependencies.updateTransportState,
		persistLeadIn: (enabled) => dependencies.persistSetting('recording-lead-in', enabled),
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		publishTelemetrySnapshot: dependencies.publishTelemetrySnapshot,
		syncRecordingPoolSnapshot,
		resetSoundActivationSources: soundActivation.resetSources,
		handleError: dependencies.handleError,
	});

	const timedInputs = createTimedRecordingInputService({
		getProject: requireProject,
		findTrack: (project, trackId) => findTrack(project, trackId) || null,
		projectSampleRate: projectSampleRateOf,
		getPreferredInputChannelCount: () => state.preferredInputChannelCount,
		getRecordingRoutes: () => state.recordingRouting.routes,
		setRecordingRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
		capturePool,
		defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		recordingRouteSourceKey,
		streamAudioChannelCount,
		recordingStreamIsLive,
		messages: {
			armTrack: copy.armTrackForRecording,
			assignInput: copy.recordingAssignInput,
			preparedInputClosed: copy.recordingPreparedInputClosed,
			assignedInputsUnavailable: copy.timedRecordingAssignedInputsUnavailable,
		},
	});
	const timed = createTimedRecordingService({
		state,
		getProjectId: () => dependencies.getProject()?.id || null,
		normalizeStartTime: normalizeTimedRecordingStart,
		currentTimeMs: dependencies.currentTimeMs,
		prepareInputs: timedInputs.prepareTimedRecordingInputs,
		prepareContext: async () => {
			const context = await engine.getAudioContext();
			await context.resume();
		},
		startRecording: session.startRecording,
		cancelRecordingStart: session.cancelRecordingStart,
		finalizeRecording: session.finalizeRecording,
		activatePreparedRecording: async (_scheduled, scope) => {
			await engine.play();
			try { scope.assertCurrent(); } catch (error) { engine.stop(); throw error; }
			for (const entry of state.recordingEntries || []) state.recordingRouteHealth[entry.trackId] = 'recording';
			dependencies.setStatus(copy.recording);
			dependencies.updateTransportState('recording');
			dependencies.publishDocumentSnapshot();
		},
		scheduleTimer: dependencies.scheduleTimer,
		clearTimer: dependencies.clearTimer,
		maximumTimerDelayMs: MAXIMUM_TIMER_DELAY_MS,
		retainInputs: () => state.preferences.recording.retainInputs,
		releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setStatus: dependencies.setStatus,
		handleError: dependencies.handleError,
		abortError,
		formatScheduledTime: (value) => new Date(value).toLocaleString(locale),
		messages: {
			projectReadOnly: copy.projectReadOnly,
			past: copy.timedRecordingPast,
			preparing: copy.timedRecordingPreparing,
			missed: copy.timedRecordingMissed || copy.timedRecordingPast,
			scheduled: (time) => copy.timedRecordingScheduled.replace('{time}', time),
			cancelled: copy.timedRecordingCancelled,
		},
	});

	const inputs = createRecordingInputCoordinationService({
		state,
		capturePool,
		captureOperation: () => {
			const lifetimeToken = dependencies.lifetime.capture();
			const targetProject = dependencies.getProject();
			const projectToken = targetProject ? dependencies.projectGeneration.capture(targetProject.id) : null;
			return Object.freeze({
				assertCurrent() {
					dependencies.lifetime.assertActive(lifetimeToken);
					if (projectToken) dependencies.projectGeneration.assertCurrent(projectToken);
					if (dependencies.getProject() !== targetProject) throw abortError();
				},
			});
		},
		meter: microphoneMeter,
		routing: {
			persistRecordingRouting: routing.persistRecordingRouting,
			releaseUnretainedRecordingInputs: routing.releaseUnretainedRecordingInputs,
			syncRecordingPoolSnapshot: routing.syncRecordingPoolSnapshot,
			updateRecordingDeviceRows: routing.updateRecordingDeviceRows,
		},
		cancelTimedRecording: timed.cancelTimedRecording,
		getTrack: (trackId) => findTrack(dependencies.getProject(), trackId) || null,
		projectSampleRate: dependencies.projectSampleRate,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		recordingRouteSourceKey,
		setRecordingTrackRoute,
		streamAudioChannelCount,
	});

	const setMonitoring = (enabled: unknown): boolean => {
		state.monitoring = Boolean(enabled);
		state.recorder?.setMonitoring?.(state.monitoring);
		void dependencies.persistSetting('input-monitor', state.monitoring);
		dependencies.publishDocumentSnapshot();
		return state.monitoring;
	};
	const setLatencyOffset = (value: unknown): number => {
		state.latencyOffsetMs = normalizeLatencyOffset(value);
		void dependencies.persistSetting('recording-latency-offset-ms', state.latencyOffsetMs);
		dependencies.publishDocumentSnapshot();
		return state.latencyOffsetMs;
	};
	const setRecordingInputGain = (value: unknown) => (
		microphoneMeter.setRecordingInputGain(value, normalizeRecordingInputGain)
	);
	const invalidateTakeCycleRecording = async (reason: unknown): Promise<void> => {
		state.recordingStartGeneration += 1;
		takeCycle.cancel(reason);
		await session.stopRecording().catch(dependencies.handleError);
	};

	return Object.freeze({
		routing,
		inputs,
		session,
		timed,
		takeCycle,
		publishRecordingPreview,
		releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot,
		setMonitoring,
		setLatencyOffset,
		setRecordingInputGain,
		invalidateTakeCycleRecording,
	});
}

export type RecordingComposition = ReturnType<typeof createRecordingComposition>;

function isRecordingSelection(value: unknown): value is RecordingSelection {
	return typeof value === 'object' && value !== null
		&& typeof (value as RecordingSelection).startFrame === 'number'
		&& typeof (value as RecordingSelection).endFrame === 'number';
}
