/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	assertAudacityEffectOutput,
	estimateAudacityEffectPeakBytes,
} from '../audacity-effects/contracts.js';
import { audacitySelectionChannelCount, matchAudacitySelectionChannels } from '../audacity-selection.js';
import {
	preparePasteCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	resolveEditingSelection,
} from '../commands.js';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioSelectionEffectLabel,
	isAudacityRackEffectType,
	normalizeAudioSelectionEffectParams,
} from '../effects.js';
import { effectRackLatencyFrames } from '../engine.js';
import { createStableId } from '../project.js';
import { audioTrackChannelCount } from '../project-audio-factory.js';
import {
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../selection-effects.js';
import {
	createAbsentEffectMacroService,
	createAbsentNyquistGeneratedAudioService,
	createAbsentNyquistHostService,
	createAbsentSelectionEffectExecutionService,
	createAbsentSelectionEffectWorkerService,
} from './absent-audio-subsystems.ts';
import { abortError, throwIfAborted } from './app-helpers.ts';
import { deferredEffectRuntime } from './deferred-effect-runtime.ts';
import { createEffectAudioService } from './effect-audio-service.ts';
import { createEffectControlsService } from './effect-controls-service.ts';
import { createSelectionEffectExecutionService } from './effect-execution-service.ts';
import { createEffectMacroService, type EffectMacroServiceRuntime } from './effect-macro-service.ts';
import { createSelectionEffectResultService } from './effect-result-service.ts';
import { createEffectSelectionService } from './effect-selection-service.ts';
import type { EffectsCompositionDependencies, EffectsCompositionProject } from './effects-composition-types.ts';
import {
	audacityEffectMemoryError,
	freezeNyquistResult,
	mixNyquistPreviewChannels,
	normalizeNyquistRole,
	nyquistAudioResultBytes,
	nyquistMaximumOutputFrames,
	nyquistResultStatus,
} from './nyquist-audio.ts';
import { createNyquistGeneratedAudioService } from './nyquist-generated-audio-service.ts';
import { createNyquistHostService } from './nyquist-host-service.ts';
import { createRackEffectService } from './rack-effect-service.ts';
import { createSelectionEffectWorkerService } from './selection-effect-worker-service.ts';
import {
	SOURCE_CHUNK_FRAMES,
	audioBufferChannels,
	bufferFromChannels,
	serializeAudacityNoiseProfile,
	writeBuffer,
	type AudioBufferLike,
} from './source-audio.ts';
import { generateWaveformPeaks, peakCacheKey } from './waveform-analysis.ts';

export type {
	EffectsCompositionCopy,
	EffectsCompositionDependencies,
	EffectsCompositionEngine,
	EffectsCompositionProject,
	EffectsCompositionState,
	EffectsCompositionStore,
} from './effects-composition-types.ts';

/** Total decoded audio one Nyquist evaluation may hold across its inputs and result. */
const NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES = 128 * 1024 * 1024;

type EffectControls = ReturnType<typeof createEffectControlsService>;
type EffectAudio = ReturnType<typeof createEffectAudioService<AudioBufferLike>>;
type EffectMacro = ReturnType<typeof createEffectMacroService<AudioBufferLike>>;
type SelectionEffectResult = ReturnType<typeof createSelectionEffectResultService>;

/**
 * Build the effects domain: the selection that effects target, the Audacity
 * effect controls and presets, the audio and spectral processing that applies
 * them, Nyquist hosting and its generated audio, effect macros, the worker
 * that runs selection effects off the main thread, rack effects with their
 * live gestures, and the result service that writes processed audio back into
 * the document. Products that do not compose effects, macros or workers get
 * the refusing stand-ins from `absent-audio-subsystems.ts`.
 */
export function createEffectsComposition(dependencies: EffectsCompositionDependencies) {
	const { state, copy, engine, store, taskProgress, absentSubsystem } = dependencies;
	const requireProject = (): EffectsCompositionProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Effects require an open project.');
		return project;
	};
	const captureProject = () => dependencies.projectGeneration.capture(requireProject().id);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	const memoryError = () => audacityEffectMemoryError(copy);

	const worker = dependencies.composition.selectionEffectWorkers
		? createSelectionEffectWorkerService({
			state,
			copy,
			captureProject,
			assertProject,
			loadParametricEqWasmModule: deferredEffectRuntime.loadParametricEqWasmModule,
			initializePffft: deferredEffectRuntime.initializePffft,
			captureNoiseProfile: deferredEffectRuntime.captureAudacityNoiseProfile,
			applySelectionEffect: deferredEffectRuntime.applyAudioSelectionEffectAsync,
			applySpectralGain: deferredEffectRuntime.applySpectralGain,
			onProgress: (value) => taskProgress.updateActive(value),
		})
		: createAbsentSelectionEffectWorkerService(absentSubsystem);
	const selection = createEffectSelectionService({
		state,
		copy,
		getProject: requireProject,
		activeSelection: dependencies.activeSelection,
		resolveEditingSelection,
		audacitySelectionChannelCount,
		audioTrackChannelCount,
		selectedTracksTimeRange: dependencies.selectedTracksTimeRange,
		projectSampleRate: dependencies.projectSampleRate,
		editingBlocked: dependencies.editingBlocked,
		setSelection: (...args) => dependencies.setSelection(...args),
	});
	const controls: EffectControls = createEffectControlsService({
		state,
		copy,
		createId: createStableId,
		getProject: requireProject,
		persistSetting: dependencies.persistSetting,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setStatus: dependencies.setStatus,
		applySelectedAudacityEffect: () => execution.applySelectedAudacityEffect(),
		captureRackNoiseProfile: (...args) => audio.captureRackNoiseProfile(...args),
	});
	const audio: EffectAudio = createEffectAudioService<AudioBufferLike>({
		lifetime: dependencies.lifetime,
		...(dependencies.projectRuntime.assistanceAssetCommands ? {
			assistanceStore: store,
			assistanceVideoStore: store,
			assistanceDerivativeRepository: store.assistanceDerivativeRepository,
		} : {}),
		captureProject,
		assertProject,
		state,
		copy,
		memoryLimitBytes: AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
		getProject: requireProject,
		activeSelection: dependencies.activeSelection,
		audacityEffectTarget: (...args) => selection.audacityEffectTarget(...args),
		audacityEffectTargets: (...args) => selection.audacityEffectTargets(...args),
		audacityEffectSelectionDetails: (...args) => selection.audacityEffectSelectionDetails(...args),
		editingBlocked: dependencies.editingBlocked,
		projectSampleRate: dependencies.projectSampleRate,
		currentAudacityEffectParams: (...args) => controls.currentAudacityEffectParams(...args),
		estimateAudacityEffectPeakBytes,
		audacityEffectMemoryError: memoryError,
		preflightStorage: dependencies.preflightStorage,
		createId: createStableId,
		cloneProject: dependencies.projectRuntime.cloneProject,
		audacitySelectionChannelCount,
		renderSnapshot: dependencies.renderSnapshot,
		prepareCommittedTimePitchCaches: dependencies.prepareCommittedTimePitchCaches,
		createRenderEngine: dependencies.createRenderEngine,
		sourceBuffers: dependencies.sourceBuffers,
		audioBufferChannels,
		matchAudacitySelectionChannels,
		// The worker answers a capture request with a profile; the audio service reads only that.
		runSelectionEffectWorker: async (request) => ({ profile: (await worker.runSelectionEffectWorker(request)).profile }),
		runSpectralEditWorker: (...args) => worker.runSpectralEditWorker(...args),
		serializeNoiseProfile: serializeAudacityNoiseProfile,
		commit: dependencies.commit,
		persistAudacityEffectResults: (...args) => result.persistAudacityEffectResults(...args),
		setStatus: dependencies.setStatus,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
	});
	const result: SelectionEffectResult = createSelectionEffectResultService({
		SOURCE_CHUNK_FRAMES,
		assertAudacityEffectOutput,
		audioSelectionEffectLabel,
		bufferFromChannels,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		commit: dependencies.commit,
		copy,
		createStableId,
		engine,
		generateWaveformPeaks,
		peakCacheKey,
		preparePasteCommand,
		prepareRangeDeleteCommand,
		prepareRangeReplacementCommand,
		getProject: requireProject,
		projectSampleRate: dependencies.projectSampleRate,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		state,
		store,
		throwIfAborted,
		writeBuffer,
	});
	const persistAudacityEffectResult: EffectMacroServiceRuntime['persistAudacityEffectResult'] = (target, type, channels, options) => (
		result.persistAudacityEffectResults([{ target, channels: [...channels] }], type, options)
	);
	const nyquistHost = dependencies.composition.effects
		? createNyquistHostService({
			state,
			copy,
			locale: dependencies.locale,
			getProject: requireProject,
			captureProject,
			assertProject,
			activeSelection: dependencies.activeSelection,
			projectSampleRate: dependencies.projectSampleRate,
			getPositionFrames: () => engine.getPositionFrames(),
			getAudioContext: () => engine.getAudioContext({ resume: true }),
			pauseTransport: () => engine.pause(),
			assertAudioOutput: assertAudacityEffectOutput,
			bufferFromChannels: (channels, sampleRate, context) => bufferFromChannels([...channels], sampleRate, context, copy),
			cancelAudacityEffectPreview: (...args) => controls.cancelAudacityEffectPreview(...args),
			createId: createStableId,
			commit: dependencies.commit,
			setStatus: dependencies.setStatus,
			publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		})
		: createAbsentNyquistHostService(absentSubsystem);
	const nyquistGenerated = dependencies.composition.effects
		? createNyquistGeneratedAudioService({
			state,
			copy,
			sourceChunkFrames: SOURCE_CHUNK_FRAMES,
			getProject: requireProject,
			captureProject,
			assertProject,
			activeSelection: dependencies.activeSelection,
			audacityEffectTarget: (...args) => selection.audacityEffectTarget(...args),
			persistAudacityEffectResult,
			matchAudacitySelectionChannels,
			assertAudioOutput: assertAudacityEffectOutput,
			projectSampleRate: dependencies.projectSampleRate,
			preflightStorage: dependencies.preflightStorage,
			createId: createStableId,
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			bufferFromChannels: (channels, sampleRate, context) => bufferFromChannels([...channels], sampleRate, context, copy),
			store,
			writeBuffer,
			snapTimelineFrame: dependencies.snapTimelineFrame,
			getPositionFrames: () => engine.getPositionFrames(),
			cacheSourceBuffer: dependencies.cacheSourceBuffer,
			generateWaveformPeaks: (channels) => generateWaveformPeaks([...channels], copy),
			peakCacheKey,
			sourceBuffers: dependencies.sourceBuffers,
			sourcePeaks: dependencies.sourcePeaks,
			commit: dependencies.commit,
		})
		: createAbsentNyquistGeneratedAudioService(absentSubsystem);
	const rack = createRackEffectService({
		state,
		copy,
		engine,
		getProject: dependencies.getProject,
		captureProject: () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null),
		assertProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		handleError: dependencies.handleError,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setStatus: dependencies.setStatus,
	});
	const macro = dependencies.composition.macros
		? createEffectMacroService<AudioBufferLike>({
			lifetime: dependencies.lifetime,
			projectGeneration: dependencies.projectGeneration,
			copy,
			memoryLimitBytes: AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
			getProject: requireProject,
			audacityEffectTarget: (...args) => selection.audacityEffectTarget(...args),
			editingBlocked: dependencies.editingBlocked,
			materializeRackEffect: (...args) => rack.materializeRackEffect(...args),
			projectSampleRate: dependencies.projectSampleRate,
			effectRackLatencyFrames,
			isAudacityRackEffectType,
			estimateAudacityEffectPeakBytes,
			audacityEffectMemoryError: memoryError,
			setProcessing: (value) => { state.audacityEffectProcessing = value; },
			setStatus: dependencies.setStatus,
			publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
			preflightStorage: dependencies.preflightStorage,
			cloneProject: dependencies.projectRuntime.cloneProject,
			renderSnapshot: dependencies.renderSnapshot,
			renderDryTrackRange: (...args) => audio.renderDryTrackRange(...args),
			// The worker answers an apply request with channels; a reply without them is a failed effect.
			runSelectionEffectWorker: async (request) => {
				const outcome = await worker.runSelectionEffectWorker({ ...request, channels: [...request.channels] });
				if (!outcome.channels) throw new Error(copy.effectProcessingFailed);
				return { channels: outcome.channels };
			},
			projectFrameCount: () => dependencies.projectDurationFrames(dependencies.getProject()),
			createAudioBuffer: async (channels) => bufferFromChannels(
				[...channels], dependencies.projectSampleRate(), await engine.getAudioContext({ resume: false }), copy,
			),
			audioBufferChannels,
			matchAudacitySelectionChannels,
			persistAudacityEffectResult,
			handleError: dependencies.handleError,
		})
		: createAbsentEffectMacroService(absentSubsystem);
	const execution = dependencies.composition.effects
		? createSelectionEffectExecutionService({
			AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
			AUDIO_SELECTION_EFFECT_DEFINITIONS,
			NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES,
			abortError,
			lifetime: dependencies.lifetime,
			captureProject: () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null),
			assertProject,
			activeSelection: dependencies.activeSelection,
			assertAudacityEffectOutput,
			audacityEffectMemoryError,
			audacityEffectSelectionDetails: selection.audacityEffectSelectionDetails,
			audacityEffectTarget: selection.audacityEffectTarget,
			audacityEffectTargets: selection.audacityEffectTargets,
			audacitySpectralEffectContext: selection.audacitySpectralEffectContext,
			bufferFromChannels,
			cancelAudacityEffectPreview: controls.cancelAudacityEffectPreview,
			copy,
			currentAudacityEffectParams: controls.currentAudacityEffectParams,
			editingBlocked: dependencies.editingBlocked,
			engine,
			estimateAudioSelectionEffectOutputFrames,
			estimateAudioSelectionEffectPeakBytes,
			freezeNyquistResult,
			mixNyquistPreviewChannels,
			normalizeAudioSelectionEffectParams,
			normalizeNyquistRole,
			nyquistAudioResultBytes,
			nyquistEvaluator: dependencies.nyquistEvaluator,
			nyquistHostProperties: nyquistHost.nyquistHostProperties,
			nyquistMaximumOutputFrames,
			nyquistResultStatus,
			persistAudacityEffectResults: (...args: Parameters<SelectionEffectResult['persistAudacityEffectResults']>) => (
				result.persistAudacityEffectResults(...args)
			),
			persistNyquistGeneratedAudio: nyquistGenerated.persistNyquistGeneratedAudio,
			persistNyquistLabels: nyquistHost.persistNyquistLabels,
			playNyquistPreview: nyquistHost.playNyquistPreview,
			preflightStorage: dependencies.preflightStorage,
			getProject: dependencies.getProject,
			projectDurationFrames: dependencies.projectDurationFrames,
			projectSampleRate: dependencies.projectSampleRate,
			publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
			renderDryTrackRange: audio.renderDryTrackRange,
			resolveInteractiveAudacityParams: controls.resolveInteractiveAudacityParams,
			runSelectionEffectWorker: worker.runSelectionEffectWorker,
			setAudacityControlTrack: controls.setAudacityControlTrack,
			setAudacityEffectParamsFromController: controls.setAudacityEffectParamsFromController,
			setAudacityEffectType: controls.setAudacityEffectType,
			setStatus: dependencies.setStatus,
			state,
			throwIfAborted,
			updateTaskProgress: (value: number) => taskProgress.updateActive(value),
		})
		: createAbsentSelectionEffectExecutionService(absentSubsystem);

	/** The long-running effect operations, reported through task progress. */
	const processing = (label: string | undefined) => label || copy.audacityProcessing;
	return Object.freeze({
		selection,
		controls,
		audio,
		result,
		nyquistHost,
		nyquistGenerated,
		rack,
		macro,
		worker,
		execution,
		persistAudacityEffectResult,
		runEffectMacro: (request: Parameters<EffectMacro['runEffectMacro']>[0]) => (
			taskProgress.run('effect', processing(copy.macroProcessing), () => macro.runEffectMacro(request))
		),
		applyAudacityEffectFromController: (...args: Parameters<EffectControls['applyAudacityEffectFromController']>) => (
			taskProgress.run('effect', copy.audacityProcessing, () => controls.applyAudacityEffectFromController(...args))
		),
		repeatLastAudacityEffect: (...args: Parameters<EffectControls['repeatLastAudacityEffect']>) => (
			taskProgress.run('effect', copy.audacityProcessing, () => controls.repeatLastAudacityEffect(...args))
		),
		applySpectralSelection: (...args: Parameters<EffectAudio['applySpectralSelection']>) => (
			taskProgress.run('effect', processing(copy.spectralProcessing), () => audio.applySpectralSelection(...args))
		),
		captureSelectedNoiseProfile: (...args: Parameters<EffectAudio['captureSelectedNoiseProfile']>) => (
			taskProgress.run('effect', copy.audacityProcessing, () => audio.captureSelectedNoiseProfile(...args))
		),
		runNyquistEvaluation: (request: unknown) => (
			taskProgress.run('effect', processing(copy.nyquistProcessing), () => execution.runNyquistEvaluation(request))
		),
	});
}

export type EffectsComposition = ReturnType<typeof createEffectsComposition>;
