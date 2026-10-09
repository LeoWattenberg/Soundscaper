import { createLocalizedError, setLocalizedStatus } from '../../../../i18n/presentation-message.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */
import { independentTrackEffectParams } from './independent-track-effect-params.ts';
import { paulstretchPreviewInputFrames } from './paulstretch-preview-prefix.ts';
import { speedDelayPreviewInputFrames } from './speed-delay-preview-prefix.ts';

export interface SelectionEffectPreviewRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = SelectionEffectPreviewRuntime[string];

interface PreviewTarget {
	readonly full: RuntimeValue;
	readonly fullIndex: number;
	readonly offsetFrames: number;
	readonly preview: RuntimeValue;
	readonly spectralSelection: RuntimeValue;
}

interface FullPreviewTarget {
	readonly full: RuntimeValue;
	readonly fullIndex: number;
	readonly spectralSelection: RuntimeValue;
}

/** Build Audacity's temporary, processed mix from every current effect target. */
export function createSelectionEffectPreviewService(runtime: SelectionEffectPreviewRuntime) {
	const {
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, AUDIO_SELECTION_EFFECT_DEFINITIONS, abortError,
		assertAudacityEffectOutput, audacityEffectMemoryError, audacityEffectTargets,
		audacitySpectralEffectContext, bufferFromChannels, cancelAudacityEffectPreview, copy,
		currentAudacityEffectParams, engine, estimateAudioSelectionEffectPeakBytes,
		getProject, mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, projectDurationFrames,
		projectSampleRate, publishDocumentSnapshot, renderDryTrackRange, resolveInteractiveAudacityParams,
		runSelectionEffectWorker, setAudacityControlTrack, setAudacityEffectParamsFromController,
		setAudacityEffectType, setStatus, state,
	} = runtime;

	return async function previewAudacityEffectFromController(request: RuntimeValue = {}) {
		if (state.audacityEffectProcessing) return false;
		runtime.releasePreparedPcm?.();
		runtime.pauseSourcePreview?.();
		cancelAudacityEffectPreview({ publish: false });
		const previewGeneration = state.audacityPreviewGeneration;
		const requireCurrentPreview = (source: RuntimeValue = null) => {
			if (previewGeneration === state.audacityPreviewGeneration) return;
			if (source) stopStaleSource(source);
			throw abortError();
		};
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		const fullTargets = audacityEffectTargets();
		if (!fullTargets.length) throw createLocalizedError(Error, copy, 'audacitySelectionHint');
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const sampleRate = fullTargets[0]?.sourceSampleRate ?? projectSampleRate();
		const maximumFrames = Math.max(1, Math.round(sampleRate * 6));
		const previewStartFrame = Math.min(...fullTargets.map((target: RuntimeValue) => target.startFrame));
		const previewEndFrame = Math.min(
			previewStartFrame + maximumFrames,
			Math.max(...fullTargets.map((target: RuntimeValue) => target.endFrame)),
		);
		const previewFrameCount = previewEndFrame - previewStartFrame;
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		const processCompleteSelection = type === 'audacity-normalize' || type === 'audacity-loudness-normalization'
			|| (type === 'audacity-sliding-stretch' && (params.startTempoPercent !== params.endTempoPercent
				|| params.startPitchSemitones !== params.endPitchSemitones));
		const fullPreviewTargets: FullPreviewTarget[] = fullTargets.map((full: RuntimeValue, fullIndex: number) => ({
			full,
			fullIndex,
			spectralSelection: audacitySpectralEffectContext(full, definition),
		}));
		const targets: PreviewTarget[] = fullPreviewTargets.map(({ full, fullIndex, spectralSelection }) => {
			const startFrame = Math.max(previewStartFrame, full.startFrame);
			const auditionFrames = Math.max(0, Math.min(previewEndFrame, full.endFrame) - startFrame);
			if (auditionFrames === 0) return null;
			const inputFrames = type === 'multi-tap-delay'
				? speedDelayPreviewInputFrames(params, sampleRate, auditionFrames)
				: type === 'audacity-paulstretch' ? paulstretchPreviewInputFrames(params, sampleRate,
					Math.min(maximumFrames - (startFrame - previewStartFrame),
						Math.ceil(full.durationFrames * Number(params.stretchFactor)))) : auditionFrames;
			const endFrame = Math.min(startFrame + inputFrames, full.endFrame);
			if (endFrame <= startFrame) return null;
			return {
				full,
				fullIndex,
				offsetFrames: startFrame - previewStartFrame,
				preview: processCompleteSelection ? full : { ...full, startFrame, endFrame, durationFrames: endFrame - startFrame },
				spectralSelection,
			};
		}).filter((target): target is PreviewTarget => target !== null);
		const resolveFromFullSelection = type === 'audacity-amplify'
			&& !state.audacityEffectTouchedParams.get(type)?.has('gainDb')
			&& fullTargets.some((full: RuntimeValue) => (
				full.startFrame < previewStartFrame || full.endFrame > previewEndFrame
			));
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw createLocalizedError(Error, copy, 'noiseProfileMissing');
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw createLocalizedError(Error, copy, 'autoDuckControlTrack');
		const contextFrames = definition.preRollSeconds
			? Math.ceil(definition.preRollSeconds * sampleRate)
			: definition.requiresStaffPad ? sampleRate : definition.requiresContext ? 128 : 0;
		const afterContextFrames = definition.preRollSeconds ? 0 : contextFrames;
		const peakTargets = resolveFromFullSelection
			? fullPreviewTargets.map(({ full, spectralSelection }) => ({ target: full, spectralSelection }))
			: targets.map(({ preview, spectralSelection }) => ({ target: preview, spectralSelection }));
		const estimatedPeakBytes = peakTargets.reduce((sum, { target, spectralSelection }) => (
			sum + estimateAudioSelectionEffectPeakBytes(
				type,
				target.durationFrames,
				params,
				{
					channelCount: target.channelCount,
					controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
					sampleRate,
					beforeFrames: Math.min(target.startFrame, contextFrames),
					afterFrames: afterContextFrames,
					spectralWindowSize: spectralSelection?.windowSize,
				},
			)
		), 0);
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setLocalizedStatus(setStatus, copy, (copy.audacityPreviewProcessing ? "audacityPreviewProcessing" : "audacityProcessing"));
		publishDocumentSnapshot();
		try {
			const fullChannelSets = resolveFromFullSelection
				? await renderTargetChannels(fullTargets, renderDryTrackRange, requireCurrentPreview)
				: null;
			const previewChannelSets: RuntimeValue[] = [];
			for (let index = 0; index < targets.length; index += 1) {
				const { full, fullIndex, preview } = targets[index]!;
				const reusable = fullChannelSets?.[fullIndex];
				if (reusable && preview.startFrame === full.startFrame && preview.endFrame === full.endFrame) {
					previewChannelSets.push(reusable);
				} else if (reusable && runtime.canSliceDryPcm?.(reusable)
					&& preview.startFrame >= full.startFrame && preview.endFrame <= full.endFrame) {
					const start = preview.startFrame - full.startFrame;
					const end = preview.endFrame - full.startFrame;
					previewChannelSets.push(reusable.map((channel: Float32Array) => channel.subarray(start, end)));
				} else {
					previewChannelSets.push(await renderOneTarget(preview, renderDryTrackRange, requireCurrentPreview));
				}
			}
			params = resolveInteractiveAudacityParams(
				type,
				params,
				(fullChannelSets ?? previewChannelSets).flat(),
			);
			if (type === 'eq') {
				return previewEqualizer(
					mixNyquistPreviewChannels(targets.map(({ offsetFrames }, index) => (
						alignPreviewChannels(previewChannelSets[index], offsetFrames, previewFrameCount)
					)), previewFrameCount),
					params,
					sampleRate,
					requireCurrentPreview,
					runtime,
				);
			}
			const resultChannelSets: Float32Array[][] = [];
			const linkedTruncate = type === 'audacity-truncate-silence' && params.independent === false
				&& targets.length > 1 && targets.every(({ preview }) => (
					preview.startFrame === targets[0]!.preview.startFrame
					&& preview.endFrame === targets[0]!.preview.endFrame
				));
			if (linkedTruncate) {
				const result = await runSelectionEffectWorker({ operation: 'apply', effectType: type,
					channels: previewChannelSets.flat(), sampleRate, params, context: {} });
				requireCurrentPreview();
				assertAudacityEffectOutput(result.channels);
				let offset = 0;
				for (const channels of previewChannelSets) {
					resultChannelSets.push(result.channels.slice(offset, offset + channels.length));
					offset += channels.length;
				}
				if (offset !== result.channels.length) throw createLocalizedError(Error, copy, 'effectChannelLayoutChanged');
			}
			for (let index = 0; !linkedTruncate && index < targets.length; index += 1) {
				const { preview, spectralSelection } = targets[index]!;
				const channels = previewChannelSets[index];
				const effectContext: RuntimeValue = {};
				if (spectralSelection) effectContext.spectralSelection = spectralSelection;
				if (definition.requiresControlTrack) {
					effectContext.controlChannels = runtime.renderControlTrackRange ? await runtime.renderControlTrackRange(state.audacityControlTrackId, preview) : await renderDryTrackRange(
						state.audacityControlTrackId,
						preview.startFrame,
						preview.endFrame,
					);
					requireCurrentPreview();
				}
				if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
				if (contextFrames > 0) {
					await addPreviewContext(
						effectContext,
						preview,
						channels,
						contextFrames,
						afterContextFrames,
						preview.sourceFrameCount ?? projectDurationFrames(getProject()),
						renderDryTrackRange,
						requireCurrentPreview,
					);
				}
				const result = await runSelectionEffectWorker({
					operation: 'apply', effectType: type, channels, sampleRate,
					params: independentTrackEffectParams(type, params), context: effectContext,
				});
				requireCurrentPreview();
				assertAudacityEffectOutput(result.channels);
				resultChannelSets.push(result.channels);
			}
			const changedDuration = resultChannelSets.some((channels, index) => channels[0]!.length !== targets[index]!.preview.durationFrames);
			const resultFrameCount = Math.min(maximumFrames, Math.max(changedDuration ? 0 : previewFrameCount, ...resultChannelSets.map((channels, index) => (
				targets[index]!.offsetFrames + channels[0]!.length
			))));
			const mixedChannels = mixNyquistPreviewChannels(resultChannelSets.map((channels, index) => (
				alignPreviewChannels(channels, targets[index]!.offsetFrames, resultFrameCount)
			)), resultFrameCount);
			const context = await engine.getAudioContext({ resume: true });
			await context.resume?.();
			requireCurrentPreview();
			const buffer = await bufferFromChannels(mixedChannels, sampleRate, context, copy);
			requireCurrentPreview();
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(engine.getPlaybackDestination());
			attachPreviewSource(source, runtime);
			engine.pause();
			state.audacityPreviewSource = source;
			source.start();
			setLocalizedStatus(setStatus, copy, (copy.audacityPreviewPlaying ? "audacityPreviewPlaying" : "playing"), undefined, 'success');
			return true;
		} catch (error) {
			if ((error as Readonly<{ name?: string }>)?.name === 'AbortError') return false;
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	};
}

function alignPreviewChannels(
	channels: Float32Array[],
	offsetFrames: number,
	frameCount: number,
): Float32Array[] {
	return channels.map((channel) => {
		const aligned = new Float32Array(frameCount);
		aligned.set(channel.subarray(0, Math.max(0, frameCount - offsetFrames)), offsetFrames);
		return aligned;
	});
}

async function renderTargetChannels(
	targets: RuntimeValue[],
	render: RuntimeValue,
	requireCurrent: () => void,
): Promise<RuntimeValue[]> {
	const result = [];
	for (const target of targets) result.push(await renderOneTarget(target, render, requireCurrent));
	return result;
}

async function renderOneTarget(target: RuntimeValue, render: RuntimeValue, requireCurrent: () => void) {
	const channels = await render(
		target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds,
	);
	requireCurrent();
	return channels;
}

async function addPreviewContext(
	context: RuntimeValue,
	target: RuntimeValue,
	channels: RuntimeValue,
	contextFrames: number,
	afterContextFrames: number,
	projectEndFrame: number,
	render: RuntimeValue,
	requireCurrent: () => void,
): Promise<void> {
	if (contextFrames <= 0) return;
	const beforeStart = Math.max(0, target.startFrame - contextFrames);
	context.beforeChannels = beforeStart < target.startFrame
		? await render(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
		: channels.map(() => new Float32Array(0));
	requireCurrent();
	if (afterContextFrames <= 0) return;
	const afterEnd = Math.min(projectEndFrame, target.endFrame + afterContextFrames);
	context.afterChannels = target.endFrame < afterEnd
		? await render(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
		: channels.map(() => new Float32Array(0));
	requireCurrent();
}

async function previewEqualizer(
	channels: RuntimeValue,
	params: RuntimeValue,
	sampleRate: number,
	requireCurrent: (source?: RuntimeValue) => void,
	runtime: SelectionEffectPreviewRuntime,
): Promise<boolean> {
	const { bufferFromChannels, copy, engine, setStatus, state } = runtime;
	engine.pause();
	const context = await engine.getAudioContext({ resume: true });
	requireCurrent();
	const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
	requireCurrent();
	if (typeof engine.createParametricEqPreview !== 'function') {
		throw new Error('This browser cannot preview the parametric EQ without bypassing it.');
	}
	const preview = await engine.createParametricEqPreview(buffer, params, {
		effectId: 'selection-preview-eq',
	});
	requireCurrent(preview);
	preview.onended = () => {
		if (state.audacityPreviewSource !== preview) return;
		state.audacityPreviewSource = null;
		preview.disconnect?.();
		setLocalizedStatus(setStatus, copy, (copy.audacityPreviewComplete ? "audacityPreviewComplete" : "ready"), undefined, 'success');
		runtime.publishDocumentSnapshot();
	};
	state.audacityPreviewSource = preview;
	preview.onerror = () => {
		if (state.audacityPreviewSource !== preview) return;
		state.audacityPreviewSource = null;
		preview.onended = null;
		try { preview.stop?.(); } catch { /* A failed preview may already have ended. */ }
		preview.disconnect?.();
		runtime.publishDocumentSnapshot();
	};
	if (state.audacityPreviewSource !== preview) return false;
	if (state.audacityPreviewAuditionBandId != null) preview.audition?.(state.audacityPreviewAuditionBandId);
	preview.start();
	setLocalizedStatus(setStatus, copy, (copy.audacityPreviewPlaying ? "audacityPreviewPlaying" : "playing"), undefined, 'success');
	return true;
}

function attachPreviewSource(source: RuntimeValue, runtime: SelectionEffectPreviewRuntime): void {
	const { copy, publishDocumentSnapshot, setStatus, state } = runtime;
	source.onended = () => {
		if (state.audacityPreviewSource !== source) return;
		state.audacityPreviewSource = null;
		source.disconnect?.();
		setLocalizedStatus(setStatus, copy, (copy.audacityPreviewComplete ? "audacityPreviewComplete" : "ready"), undefined, 'success');
		publishDocumentSnapshot();
	};
}

function stopStaleSource(source: RuntimeValue): void {
	try { source.onended = null; source.onerror = null; source.stop?.(); } catch { /* A stale source may not have started. */ }
	try { source.disconnect?.(); } catch { /* A stale source may already be disconnected. */ }
}
