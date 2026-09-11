/* SPDX-License-Identifier: AGPL-3.0-only */

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
		if (!fullTargets.length) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const sampleRate = projectSampleRate();
		const maximumFrames = Math.max(1, Math.round(sampleRate * 6));
		const previewStartFrame = Math.min(...fullTargets.map((target: RuntimeValue) => target.startFrame));
		const previewEndFrame = Math.min(
			previewStartFrame + maximumFrames,
			Math.max(...fullTargets.map((target: RuntimeValue) => target.endFrame)),
		);
		const previewFrameCount = previewEndFrame - previewStartFrame;
		const fullPreviewTargets: FullPreviewTarget[] = fullTargets.map((full: RuntimeValue, fullIndex: number) => ({
			full,
			fullIndex,
			spectralSelection: audacitySpectralEffectContext(full, definition),
		}));
		const targets: PreviewTarget[] = fullPreviewTargets.map(({ full, fullIndex, spectralSelection }) => {
			const startFrame = Math.max(previewStartFrame, full.startFrame);
			const endFrame = Math.min(previewEndFrame, full.endFrame);
			if (endFrame <= startFrame) return null;
			return {
				full,
				fullIndex,
				offsetFrames: startFrame - previewStartFrame,
				preview: { ...full, startFrame, endFrame, durationFrames: endFrame - startFrame },
				spectralSelection,
			};
		}).filter((target): target is PreviewTarget => target !== null);
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		const resolveFromFullSelection = type === 'audacity-amplify'
			&& !state.audacityEffectTouchedParams.get(type)?.has('gainDb')
			&& fullTargets.some((full: RuntimeValue) => (
				full.startFrame < previewStartFrame || full.endFrame > previewEndFrame
			));
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
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
		setStatus(copy.audacityPreviewProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const fullChannelSets = resolveFromFullSelection
				? await renderTargetChannels(fullTargets, renderDryTrackRange, requireCurrentPreview)
				: null;
			const previewChannelSets: RuntimeValue[] = [];
			for (let index = 0; index < targets.length; index += 1) {
				const { full, fullIndex, preview } = targets[index]!;
				const reusable = fullChannelSets?.[fullIndex];
				previewChannelSets.push(reusable
					&& preview.startFrame === full.startFrame && preview.endFrame === full.endFrame
					? reusable
					: await renderOneTarget(preview, renderDryTrackRange, requireCurrentPreview));
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
			const resultChannelSets = [];
			for (let index = 0; index < targets.length; index += 1) {
				const { preview, spectralSelection } = targets[index]!;
				const channels = previewChannelSets[index];
				const effectContext: RuntimeValue = {};
				if (spectralSelection) effectContext.spectralSelection = spectralSelection;
				if (definition.requiresControlTrack) {
					effectContext.controlChannels = await renderDryTrackRange(
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
						projectDurationFrames(getProject()),
						renderDryTrackRange,
						requireCurrentPreview,
					);
				}
				const result = await runSelectionEffectWorker({
					operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
				});
				requireCurrentPreview();
				assertAudacityEffectOutput(result.channels);
				resultChannelSets.push(alignPreviewChannels(
					result.channels,
					targets[index]!.offsetFrames,
					previewFrameCount,
				));
			}
			const mixedChannels = mixNyquistPreviewChannels(resultChannelSets, previewFrameCount);
			const context = await engine.getAudioContext({ resume: true });
			await context.resume?.();
			requireCurrentPreview();
			const buffer = await bufferFromChannels(mixedChannels, sampleRate, context, copy);
			requireCurrentPreview();
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			attachPreviewSource(source, runtime);
			engine.pause();
			state.audacityPreviewSource = source;
			source.start();
			setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
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
		setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
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
	setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
	return true;
}

function attachPreviewSource(source: RuntimeValue, runtime: SelectionEffectPreviewRuntime): void {
	const { copy, publishDocumentSnapshot, setStatus, state } = runtime;
	source.onended = () => {
		if (state.audacityPreviewSource !== source) return;
		state.audacityPreviewSource = null;
		source.disconnect?.();
		setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
		publishDocumentSnapshot();
	};
}

function stopStaleSource(source: RuntimeValue): void {
	try { source.onended = null; source.onerror = null; source.stop?.(); } catch { /* A stale source may not have started. */ }
	try { source.disconnect?.(); } catch { /* A stale source may already be disconnected. */ }
}
