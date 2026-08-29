/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectToken, EditorTaskScope } from './lifecycle.ts';

const SELECTION_EFFECT_TASK = 'selection-effect-apply';

export interface SelectionEffectExecutionRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = SelectionEffectExecutionRuntime[string];

export function createSelectionEffectExecutionService(runtime: SelectionEffectExecutionRuntime) {
	const {
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, AUDIO_SELECTION_EFFECT_DEFINITIONS, NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES, abortError,
		activeSelection, assertAudacityEffectOutput, audacityEffectMemoryError, audacityEffectSelectionDetails,
		audacityEffectTarget, audacityEffectTargets, audacitySpectralEffectContext, bufferFromChannels,
		cancelAudacityEffectPreview, copy, currentAudacityEffectParams, editingBlocked,
		engine, estimateAudioSelectionEffectOutputFrames, estimateAudioSelectionEffectPeakBytes, freezeNyquistResult,
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, normalizeNyquistRole, nyquistAudioResultBytes,
		nyquistEvaluator, nyquistHostProperties, nyquistMaximumOutputFrames, nyquistResultStatus,
		persistAudacityEffectResults, persistNyquistGeneratedAudio, persistNyquistLabels, playNyquistPreview,
		preflightStorage, getProject, projectDurationFrames, projectSampleRate,
		publishDocumentSnapshot, renderDryTrackRange, resolveInteractiveAudacityParams, runSelectionEffectWorker,
		setAudacityControlTrack, setAudacityEffectParamsFromController, setAudacityEffectType, setStatus,
		state, throwIfAborted, updateTaskProgress,
	} = runtime;
	async function previewAudacityEffectFromController(request: RuntimeValue = {}) {
		if (state.audacityEffectProcessing) return false;
		cancelAudacityEffectPreview({ publish: false });
		const previewGeneration = state.audacityPreviewGeneration;
		const requireCurrentPreview = (source: RuntimeValue = null) => {
			if (previewGeneration === state.audacityPreviewGeneration) return;
			if (source) {
				try { source.onended = null; source.onerror = null; source.stop?.(); } catch { /* A stale source may not have started. */ }
				try { source.disconnect?.(); } catch { /* A stale source may already be disconnected. */ }
			}
			throw abortError();
		};
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		const fullTarget = audacityEffectTarget();
		if (!fullTarget) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const sampleRate = projectSampleRate();
		const spectralSelection = audacitySpectralEffectContext(fullTarget, definition);
		const durationFrames = Math.min(fullTarget.durationFrames, sampleRate * 6);
		const target = {
			...fullTarget,
			endFrame: fullTarget.startFrame + durationFrames,
			durationFrames,
		};
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.preRollSeconds
			? Math.min(fullTarget.startFrame, Math.ceil(definition.preRollSeconds * sampleRate))
			: definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const afterContextFrames = definition.preRollSeconds ? 0 : contextFrames;
		const estimatedPeakBytes = estimateAudioSelectionEffectPeakBytes(type, durationFrames, params, {
			channelCount: target.channelCount,
			controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
			sampleRate,
			beforeFrames: contextFrames,
			afterFrames: afterContextFrames,
			spectralWindowSize: spectralSelection?.windowSize,
		});
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityPreviewProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds);
			requireCurrentPreview();
			params = resolveInteractiveAudacityParams(type, params, channels);
			if (type === 'eq') {
				engine.pause();
				const context = await engine.getAudioContext({ resume: true });
				requireCurrentPreview();
				const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
				requireCurrentPreview();
				if (typeof engine.createParametricEqPreview !== 'function') {
					throw new Error('This browser cannot preview the parametric EQ without bypassing it.');
				}
				const preview = await engine.createParametricEqPreview(buffer, params, {
					effectId: 'selection-preview-eq',
				});
				requireCurrentPreview(preview);
				preview.onended = () => {
					if (state.audacityPreviewSource !== preview) return;
					state.audacityPreviewSource = null;
					preview.disconnect?.();
					setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
					publishDocumentSnapshot();
				};
				state.audacityPreviewSource = preview;
				preview.onerror = () => {
					if (state.audacityPreviewSource !== preview) return;
					state.audacityPreviewSource = null;
					preview.onended = null;
					try { preview.stop?.(); } catch { /* A failed preview may already have ended. */ }
					preview.disconnect?.();
					publishDocumentSnapshot();
				};
				if (state.audacityPreviewSource !== preview) return false;
				if (state.audacityPreviewAuditionBandId != null) {
					preview.audition?.(state.audacityPreviewAuditionBandId);
				}
				preview.start();
				setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
				return true;
			}
			const effectContext: RuntimeValue = {};
			if (spectralSelection) effectContext.spectralSelection = spectralSelection;
			if (definition.requiresControlTrack) {
				effectContext.controlChannels = await renderDryTrackRange(
					state.audacityControlTrackId,
					target.startFrame,
					target.endFrame,
				);
			}
			if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
			if (contextFrames > 0) {
				const beforeStart = Math.max(0, target.startFrame - contextFrames);
				effectContext.beforeChannels = beforeStart < target.startFrame
					? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
					: channels.map(() => new Float32Array(0));
				if (afterContextFrames > 0) {
					const afterEnd = Math.min(projectDurationFrames(getProject()), target.endFrame + afterContextFrames);
					effectContext.afterChannels = target.endFrame < afterEnd
						? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
						: channels.map(() => new Float32Array(0));
				}
			}
			const result = await runSelectionEffectWorker({
				operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
			});
			requireCurrentPreview();
			assertAudacityEffectOutput(result.channels);
			const context = await engine.getAudioContext({ resume: true });
			await context.resume?.();
			requireCurrentPreview();
			const buffer = await bufferFromChannels(result.channels, sampleRate, context, copy);
			requireCurrentPreview();
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			source.onended = () => {
				if (state.audacityPreviewSource !== source) return;
				state.audacityPreviewSource = null;
				source.disconnect?.();
				setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
				publishDocumentSnapshot();
			};
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
	}

	async function applySelectedAudacityEffect() {
		if (editingBlocked()) return;
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const targets = audacityEffectTargets({ includeSilentTracks: Boolean(definition.lengthChanging) });
		if (!targets.length) throw new Error(copy.audacitySelectionHint);
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const spectralSelections: RuntimeValue = new Map(targets.map((target: RuntimeValue) => [
			target.track.id,
			audacitySpectralEffectContext(target, definition),
		]));
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.preRollSeconds
			? Math.ceil(definition.preRollSeconds * sampleRate)
			: definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const afterContextFrames = definition.preRollSeconds ? 0 : contextFrames;
		let estimatedOutputBytes = 0;
		let estimatedPeakBytes = 0;
		for (const target of targets) {
			const estimatedFrames = estimateAudioSelectionEffectOutputFrames(type, target.durationFrames, params);
			if (target.hasAudio !== false) {
				estimatedOutputBytes += estimatedFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
			}
			estimatedPeakBytes += estimateAudioSelectionEffectPeakBytes(type, target.durationFrames, params, {
				channelCount: target.channelCount,
				controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
				sampleRate,
				beforeFrames: Math.min(target.startFrame, contextFrames),
				afterFrames: afterContextFrames,
				spectralWindowSize: spectralSelections.get(target.track.id)?.windowSize,
			});
		}
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		const ownership = beginSelectionEffectOwnership(runtime);
		const renderCurrentDryTrackRange = async (...args: RuntimeValue[]) => {
			const channels = await renderDryTrackRange(...args);
			assertSelectionEffectOwnership(runtime, ownership);
			return channels;
		};
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			await preflightStorage(estimatedOutputBytes, 'effect');
			assertSelectionEffectOwnership(runtime, ownership);
			const dryResults = [];
			for (const target of targets) {
				const channels = await renderCurrentDryTrackRange(
					target.track.id,
					target.startFrame,
					target.endFrame,
					target.channelCount,
					target.clipIds,
				);
				dryResults.push({ target, channels });
			}
			params = resolveInteractiveAudacityParams(
				type,
				params,
				dryResults.flatMap(({ channels }: RuntimeValue) => channels),
			);
			const controlChannels = definition.requiresControlTrack && !targets.some((target: RuntimeValue) => target.clipId)
				? await renderCurrentDryTrackRange(
					state.audacityControlTrackId,
					targets[0].startFrame,
					targets[0].endFrame,
				)
				: null;
			const linkedTruncateSilence = type === 'audacity-truncate-silence'
				&& params.independent === false
				&& !targets.some((target: RuntimeValue) => target.clipId)
				&& dryResults.length > 1;
			let results = [];
			if (linkedTruncateSilence) {
				const linkedChannels = dryResults.flatMap(({ channels }: RuntimeValue) => channels);
				const result = await runSelectionEffectWorker({
					operation: 'apply', effectType: type, channels: linkedChannels, sampleRate, params, context: {},
				});
				assertSelectionEffectOwnership(runtime, ownership);
				const processedChannels = Array.isArray(result.channels) ? result.channels : [];
				let channelOffset = 0;
				results = dryResults.map(({ target, channels }: RuntimeValue) => {
					const targetChannels = processedChannels.slice(channelOffset, channelOffset + channels.length);
					channelOffset += channels.length;
					return { target, channels: targetChannels };
				});
				if (channelOffset !== processedChannels.length) throw new Error(copy.effectChannelLayoutChanged);
			} else {
				for (const { target, channels } of dryResults) {
					const effectContext: RuntimeValue = {};
					const spectralSelection = spectralSelections.get(target.track.id);
					if (spectralSelection) effectContext.spectralSelection = spectralSelection;
					if (definition.requiresControlTrack) {
						effectContext.controlChannels = controlChannels || await renderCurrentDryTrackRange(
							state.audacityControlTrackId,
							target.startFrame,
							target.endFrame,
						);
					}
					if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
					if (contextFrames > 0) {
						const beforeStart = Math.max(0, target.startFrame - contextFrames);
						effectContext.beforeChannels = beforeStart < target.startFrame
							? await renderCurrentDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
							: channels.map(() => new Float32Array(0));
						if (afterContextFrames > 0) {
							const afterEnd = Math.min(projectDurationFrames(getProject()), target.endFrame + afterContextFrames);
							effectContext.afterChannels = target.endFrame < afterEnd
								? await renderCurrentDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
								: channels.map(() => new Float32Array(0));
						}
					}
					const result = await runSelectionEffectWorker({
						operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
					});
					assertSelectionEffectOwnership(runtime, ownership);
					results.push({ target, channels: result.channels });
				}
			}
			await persistAudacityEffectResults(results, type, {
				allowIndependentLengths: type === 'audacity-truncate-silence' && params.independent === true,
				assertCurrent: () => assertSelectionEffectOwnership(runtime, ownership),
				selectionDetails: audacityEffectSelectionDetails(selection, targets),
			});
			assertSelectionEffectOwnership(runtime, ownership);
			state.lastAudacityEffect = {
				type,
				params: structuredClone(params),
				controlTrackId: state.audacityControlTrackId,
			};
			setStatus(copy.audacityApplied, 'success');
		} finally {
			finishSelectionEffectProcessing(runtime, ownership);
		}
	}

	async function runNyquistEvaluation(request: RuntimeValue = {}) {
		if (state.audacityEffectProcessing) return null;
		const source = String(request.source || '');
		if (!source.trim()) throw new TypeError(copy.nyquistSource || 'Nyquist source is required.');
		const role = normalizeNyquistRole(request.role || request.pluginType || request.type);
		const preview = Boolean(request.preview);
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const availableTargets = audacityEffectTargets();
		const targets = role === 'generate'
			? [null]
			: availableTargets.length ? availableTargets : role === 'prompt' ? [null] : [];
		if (!targets.length) throw new Error(copy.nyquistSelectionRequired || copy.audacitySelectionHint);
		if (!preview && editingBlocked()) return null;

		cancelAudacityEffectPreview({ publish: false });
		state.nyquistAbort?.abort();
		const abort = new AbortController();
		state.nyquistAbort = abort;
		state.audacityEffectProcessing = true;
		state.nyquistResult = null;
		setStatus(copy.nyquistProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const evaluations = [];
			let aggregateAudioBytes = 0;
			for (let index = 0; index < targets.length; index += 1) {
				const target = targets[index];
				// Nyquist's `$preview selection` contract requires the complete
				// selected sound and duration. The evaluator still caps rendered
				// output to six seconds through maxOutputFrames below.
				const runTarget = target;
				const channels = runTarget
					? await renderDryTrackRange(
						runTarget.track.id,
							runTarget.startFrame,
							runTarget.endFrame,
							runTarget.channelCount,
							runTarget.clipIds,
						)
					: [];
				throwIfAborted(abort.signal);
				const maxOutputFrames = nyquistMaximumOutputFrames({
					sampleRate,
					inputFrames: channels[0]?.length || 0,
					preview,
					requested: request.maxOutputFrames,
				});
				const hostTargets = availableTargets.length ? availableTargets : targets;
				const hostTargetIndex = target ? Math.max(0, hostTargets.indexOf(target)) : index;
				const result = await nyquistEvaluator({
					source,
					language: request.language === 'sal' ? 'sal' : 'lisp',
					sampleRate,
					channels,
					controls: { ...(request.controls || {}) },
					properties: nyquistHostProperties(runTarget, hostTargets, hostTargetIndex, channels, request),
					globals: { PREVIEWP: preview },
					maxOutputFrames,
					debug: Boolean(request.debug),
				}, {
					signal: abort.signal,
					timeoutMs: request.timeoutMs,
					transferInput: true,
					onProgress: updateTaskProgress,
				});
				throwIfAborted(abort.signal);
				if (result?.type === 'audio') {
					aggregateAudioBytes += nyquistAudioResultBytes(result);
					if (aggregateAudioBytes > NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES) {
						throw audacityEffectMemoryError(copy);
					}
				}
				evaluations.push({ target: runTarget, result });
			}
			throwIfAborted(abort.signal);

			const returnedResult = freezeNyquistResult(evaluations);
			const audio = evaluations.filter(({ result }: RuntimeValue) => result?.type === 'audio');
			const labels = evaluations.flatMap(({ target, result }: RuntimeValue) => result?.type === 'labels'
				? result.labels.map((label: RuntimeValue) => ({ ...label, baseFrame: target?.startFrame ?? selection?.startFrame ?? 0 }))
				: []);
			if (preview) {
				const previewChannels = mixNyquistPreviewChannels(
					audio.map(({ result }: RuntimeValue) => result.channels),
					sampleRate * 6,
				);
				if (previewChannels.length) await playNyquistPreview(previewChannels, sampleRate, abort.signal);
				throwIfAborted(abort.signal);
				state.nyquistResult = freezeNyquistResult(evaluations, { summarizeAudio: true });
				if (!audio.length) setStatus(nyquistResultStatus(evaluations, copy), 'success');
				return returnedResult;
			}

			const replacements = audio.filter(({ target }: RuntimeValue) => target);
			if (replacements.length) {
				await preflightStorage(replacements.reduce((sum: RuntimeValue, { result }: RuntimeValue) => (
					sum + nyquistAudioResultBytes(result)
				), 0), 'effect');
				throwIfAborted(abort.signal);
				await persistAudacityEffectResults(replacements.map(({ target, result }: RuntimeValue) => ({
					target,
					channels: result.channels,
				})), null, {
					allowIndependentLengths: true,
					effectName: request.name || copy.nyquistPrompt,
					selectionDetails: audacityEffectSelectionDetails(selection, replacements.map(({ target }: RuntimeValue) => target)),
					signal: abort.signal,
				});
			}
			for (const { target, result } of audio.filter(({ target }: RuntimeValue) => !target)) {
				throwIfAborted(abort.signal);
				await persistNyquistGeneratedAudio(result.channels, {
					name: request.name || copy.nyquistPrompt,
					atFrame: request.atFrame,
					trackId: request.trackId || target?.track?.id,
					signal: abort.signal,
				});
			}
			throwIfAborted(abort.signal);
			if (labels.length) persistNyquistLabels(labels, request.name);
			state.nyquistResult = freezeNyquistResult(evaluations, { summarizeAudio: true });
			setStatus(labels.length && !audio.length
				? copy.nyquistLabelsAdded
				: audio.length ? copy.nyquistApplied : nyquistResultStatus(evaluations, copy), 'success');
			return returnedResult;
		} catch (error) {
			if ((error as Readonly<{ name?: string }>)?.name === 'AbortError') {
				setStatus(copy.audacityPreviewCancelled || copy.ready);
				return null;
			}
			throw error;
		} finally {
			if (state.nyquistAbort === abort) state.nyquistAbort = null;
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}
	return Object.freeze({
		applySelectedAudacityEffect,
		previewAudacityEffectFromController,
		runNyquistEvaluation,
	});
}

interface SelectionEffectOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

function beginSelectionEffectOwnership(runtime: SelectionEffectExecutionRuntime): SelectionEffectOwnership {
	return {
		task: runtime.lifetime.startTask(SELECTION_EFFECT_TASK),
		project: runtime.captureProject(),
	};
}

function assertSelectionEffectOwnership(
	runtime: SelectionEffectExecutionRuntime,
	ownership: SelectionEffectOwnership,
): void {
	ownership.task.assertCurrent();
	runtime.assertProject(ownership.project);
}

function finishSelectionEffectProcessing(
	runtime: SelectionEffectExecutionRuntime,
	ownership: SelectionEffectOwnership,
): void {
	const taskCurrent = selectionEffectTaskIsCurrent(ownership.task);
	if (taskCurrent) runtime.state.audacityEffectProcessing = false;
	if (taskCurrent && selectionEffectProjectIsCurrent(runtime, ownership.project)) {
		runtime.publishDocumentSnapshot();
	}
	ownership.task.finish();
}

function selectionEffectTaskIsCurrent(task: EditorTaskScope): boolean {
	try { task.assertCurrent(); return true; } catch { return false; }
}

function selectionEffectProjectIsCurrent(
	runtime: SelectionEffectExecutionRuntime,
	token: EditorProjectToken,
): boolean {
	try { runtime.assertProject(token); return true; } catch { return false; }
}
