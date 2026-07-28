/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ExportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = ExportServiceRuntime[string];

const NO_TASK_PROGRESS = Object.freeze({
	setPhase: () => false,
	finish: () => false,
});

export function createEditorExportService(runtime: ExportServiceRuntime) {
	const {
		abortError, applyMediaChannelMapping, audioBufferChannels, cloneProject,
		copy, createAiffStreamEncoder, createCacheAwareRenderEngine, createExportPlan,
		createStableId, createStreamingStemArchive, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createVideoExportPlan, createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, fileService, findClip, findSource,
		handleError, hasMissingTimelineSources, lifetime, normalizeExportSettings,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches,
		productName,
		getProject, projectGeneration, projectSampleRate, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress,
	} = runtime;
	async function handleExportAction(action: RuntimeValue, requestedSettings: RuntimeValue = null) {
		if (action === 'cancel') {
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			ffmpeg.dispose();
			toggleExport(false);
			publishDocumentSnapshot();
			return;
		}
		if (String(requestedSettings?.format || '').startsWith('video-')) {
			return exportVideo(requestedSettings);
		}
		if (!getProject().clips.length || state.exportAbort) return;
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const generation = ++state.exportGeneration;
		const projectToken = projectGeneration.capture(getProject().id);
		const exportTask = lifetime.startTask('export');
		const abort = Object.freeze({
			signal: exportTask.signal,
			abort: () => lifetime.cancelTask('export'),
		});
		state.exportAbort = abort;
		toggleExport(true);
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0) || NO_TASK_PROGRESS;
		const exportProject = cloneProject(getProject());
		const exportSources = new Map(sourceBuffers);
		let pendingCleanup = null;
		try {
			const settings = normalizeExportSettings(requestedSettings || {});
			const plan = createExportPlan(exportProject, {
				...settings,
				// The ordered Web Audio master graph currently renders stereo.
				inputChannelCount: 2,
				mobile: state.mobile,
				livePcmBytes: undefined,
				productName,
			});
			await preflightStorage(
				plan.requiredTemporaryBytes ?? plan.outputBytesPerRender * Math.max(1, plan.outputs.length),
				'export',
			);
			setStatus(copy.rendering);
			let blob;
			let fileName;
			let outputCleanup = null;
			if (plan.mode === 'mix') {
				const encoded = await renderAndEncode(exportProject, plan, settings, abort.signal, exportSources);
				blob = encoded.blob || new Blob([encoded.bytes], { type: encoded.mimeType });
				outputCleanup = encoded.cleanup || null;
				pendingCleanup = outputCleanup;
				fileName = plan.outputs[0].fileName;
			} else {
				if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
				const archive = await createStreamingStemArchive(plan.archive, copy);
				try {
					for (let index = 0; index < plan.outputs.length; index += 1) {
						throwIfAborted(abort.signal);
						const output = plan.outputs[index];
						const snapshot = stemProject(exportProject, output.trackId);
						const encoded = await renderAndEncode(snapshot, plan, settings, abort.signal, exportSources, {
							start: index / plan.outputs.length,
							end: (index + 1) / plan.outputs.length,
						});
						try {
							await archive.add(output.fileName, encoded.blob || encoded.bytes, abort.signal);
						} finally {
							await encoded.cleanup?.();
						}
						updateExportProgress((index + 1) / plan.outputs.length);
					}
					const result = await archive.finish();
					blob = result.blob;
					outputCleanup = result.cleanup;
					pendingCleanup = outputCleanup;
					fileName = plan.archive.fileName;
				} catch (error) {
					await archive.abort();
					throw error;
				}
			}
			throwIfAborted(abort.signal);
			exportTask.assertCurrent();
			projectGeneration.assertCurrent(projectToken);
			if (generation !== state.exportGeneration) throw abortError();
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			state.outputUrl = null;
			state.outputCleanup = null;
			state.exportOutput = null;
			const published = await fileService.createDownload({
				purpose: 'audio',
				suggestedName: fileName,
				mimeType: blob.type || 'application/octet-stream',
				blob,
			});
			if (abort.signal.aborted || generation !== state.exportGeneration || state.disposed) {
				await published.cleanup?.();
				await outputCleanup?.();
				pendingCleanup = null;
				throw abortError();
			}
			if (published.cancelled) {
				await outputCleanup?.();
				pendingCleanup = null;
				return published;
			}
			state.outputCleanup = async () => {
				await published.cleanup?.();
				await outputCleanup?.();
			};
			pendingCleanup = null;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
				method: published.method,
			});
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await pendingCleanup?.().catch(() => undefined);
			if ((error as Readonly<{ name?: string }>)?.name !== 'AbortError') handleError(error);
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
			progressTask.finish();
			exportTask.finish();
		}
	}

	async function exportVideo(requestedSettings: RuntimeValue = {}) {
		if (state.exportAbort) return null;
		const hasTimelineVideo = getProject().tracks.some((track: RuntimeValue) => (
			track.type === 'video'
			&& track.hidden !== true
			&& (track.clipIds || []).some((clipId: RuntimeValue) => findClip(getProject(), clipId)?.kind === 'video')
		));
		if (!hasTimelineVideo) throw new Error('Add a visible video clip to the timeline before exporting video.');
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const generation = ++state.exportGeneration;
		const projectToken = projectGeneration.capture(getProject().id);
		const exportTask = lifetime.startTask('export');
		const abort = Object.freeze({
			signal: exportTask.signal,
			abort: () => lifetime.cancelTask('export'),
		});
		state.exportAbort = abort;
		toggleExport(true);
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0) || NO_TASK_PROGRESS;
		const exportProject = cloneProject(getProject());
		let pendingCleanup = null;
		try {
			const format = String(requestedSettings.format || 'video-mp4').replace(/^video-/, '');
			const includeAudio = exportProject.clips.some((clip: RuntimeValue) => clip.kind !== 'video');
			const plan = createVideoExportPlan(exportProject, {
				format,
				range: requestedSettings.range || 'project',
				includeAudio,
				canvas: requestedSettings.canvas,
			});
			const rawVideoBytes = plan.inputs
				.filter((input: RuntimeValue) => input.kind === 'video-source')
				.reduce((total: RuntimeValue, input: RuntimeValue) => {
					const source = findSource(exportProject, input.sourceId);
					return total + Math.max(0, Number(source?.opaqueExtensions?.byteLength) || 0);
				}, 0);
			await preflightStorage(Math.max(rawVideoBytes, 16 * 1024 * 1024), 'export');
			setStatus(copy.rendering);
			progressTask.setPhase(copy.rendering, { start: 0, end: 0.4, value: 0 });
			const videoBlobs = new Map();
			for (const input of plan.inputs.filter((candidate: RuntimeValue) => candidate.kind === 'video-source')) {
				throwIfAborted(abort.signal);
				const blob = await store.loadMediaAsset(input.storageKey || input.sourceId);
				if (!blob) throw new Error(copy.localSourcesMissing);
				videoBlobs.set(input.sourceId, blob);
			}
			let audioMixBlob = null;
			if (includeAudio) {
				const rendered = await renderSnapshot(exportProject, {
					startFrame: plan.range.startFrame,
					endFrame: plan.range.endFrame,
					includeTail: false,
					outputFrames: plan.range.durationFrames,
					preRollFrames: Math.min(plan.range.startFrame, projectSampleRate() * 10),
				}, sourceBuffers, abort.signal);
				throwIfAborted(abort.signal);
				const wav = encodeWav(audioBufferChannels(rendered), {
					sampleRate: rendered.sampleRate,
					bitDepth: 32,
					float: true,
					dither: 'none',
				});
				audioMixBlob = new Blob([wav], { type: 'audio/wav' });
			}
			setStatus(copy.encoding);
			progressTask.setPhase(copy.encoding, { start: 0.4, end: 1, value: 0 });
			const encoded = await ffmpeg.encodeVideo(videoBlobs, audioMixBlob, plan, {
				signal: abort.signal,
			});
			throwIfAborted(abort.signal);
			exportTask.assertCurrent();
			projectGeneration.assertCurrent(projectToken);
			if (generation !== state.exportGeneration) throw abortError();
			const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
			const fileName = `${sanitizeVideoFileName(exportProject.title)}.${plan.extension}`;
			if (state.outputUrl) globalThis.URL?.revokeObjectURL?.(state.outputUrl);
			await state.outputCleanup?.();
			state.outputUrl = null;
			state.outputCleanup = null;
			state.exportOutput = null;
			const published = await fileService.createDownload({
				purpose: 'video',
				suggestedName: fileName,
				mimeType: encoded.mimeType,
				blob,
			});
			if (abort.signal.aborted || generation !== state.exportGeneration || state.disposed) {
				await published.cleanup?.();
				pendingCleanup = null;
				throw abortError();
			}
			if (published.cancelled) return published;
			state.outputCleanup = published.cleanup || null;
			pendingCleanup = state.outputCleanup;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: encoded.mimeType,
				size: blob.size,
				method: published.method,
			});
			pendingCleanup = null;
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await pendingCleanup?.().catch(() => undefined);
			if ((error as Readonly<{ name?: string }>)?.name !== 'AbortError') handleError(error);
			return null;
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
			progressTask.finish();
			exportTask.finish();
		}
	}

	function sanitizeVideoFileName(value: RuntimeValue) {
		return String(value || 'video-project')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^[-_.]+|[-_.]+$/g, '')
			.slice(0, 96) || 'video-project';
	}

	async function renderAndEncode(snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue, sourceMap: RuntimeValue = sourceBuffers, progressRange: RuntimeValue = { start: 0, end: 1 }) {
		throwIfAborted(signal);
		const progressSpan = progressRange.end - progressRange.start;
		taskProgress?.setActivePhase?.(copy.rendering, {
			start: progressRange.start,
			end: progressRange.start + progressSpan * 0.7,
			value: 0,
		});
		const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
		if (plan.render.strategy === 'realtime-stream') {
			setStatus(copy.largeProjectRealtimeExport);
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
		try {
			const rendered = await renderSnapshot(snapshot, {
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				outputFrames: plan.range.durationFrames + plan.tailFrames,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
			}, sourceMap, signal);
			throwIfAborted(signal);
			taskProgress?.setActivePhase?.(copy.encoding, {
				start: progressRange.start + progressSpan * 0.7,
				end: progressRange.end,
				value: 0,
			});
			return await encodeRendered(rendered, plan, settings, signal);
		} catch (error) {
			if ((error as Readonly<{ name?: string }>)?.name === 'AbortError') throw error;
			setStatus(copy.realtimeExportFallback);
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
	}

	async function renderSnapshot(snapshot: RuntimeValue, range: RuntimeValue, sourceMap: RuntimeValue = sourceBuffers, signal: RuntimeValue = null) {
		throwIfAborted(signal);
		if (typeof options.renderSnapshot === 'function') {
			const rendered = await options.renderSnapshot(snapshot, range, sourceMap, signal);
			throwIfAborted(signal);
			return rendered;
		}
		await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderEngine = createCacheAwareRenderEngine();
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const rendered = await renderEngine.renderMix({ ...withRenderProgress(range), signal });
			throwIfAborted(signal);
			return rendered;
		} finally { await renderEngine.dispose(); }
	}

	function withRenderProgress(range: RuntimeValue) {
		const activeKind = taskProgress?.getSnapshot?.()?.kind;
		if (!activeKind) return range;
		return {
			...range,
			onProgress: (progress: RuntimeValue) => {
				const value = typeof progress === 'number' ? progress : progress?.progress;
				if (activeKind === 'export') updateExportProgress(value);
				else taskProgress.updateActive(value);
			},
		};
	}

	async function encodeRendered(rendered: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue) {
		throwIfAborted(signal);
		let output = rendered;
		if (plan.sampleRate !== rendered.sampleRate) {
			output = await resampleBuffer(rendered, plan.sampleRate, undefined, copy, plan.outputFrames);
		}
		throwIfAborted(signal);
		const bitDepth = plan.encoding.bitDepth || (settings.bitDepth === 32 ? 32 : settings.bitDepth) || 24;
		const sourceChannels = audioBufferChannels(output);
		if (plan.format === 'wav' || plan.format === 'bwf' || plan.format === 'aiff') {
			const mapped = applyMediaChannelMapping(sourceChannels, plan.channelMapping);
			const nativeOptions = {
				sampleRate: plan.sampleRate,
				bitDepth,
				float: plan.encoding.floatingPoint,
				sampleFormat: plan.encoding.sampleFormat,
				dither: plan.ditherMode,
				metadata: plan.metadata,
				markers: plan.markers,
				bext: plan.format === 'bwf' ? plan.bext : undefined,
			};
			const bytes = plan.format === 'aiff' ? encodeAiff(mapped, nativeOptions) : encodeWav(mapped, nativeOptions);
			return { bytes, mimeType: plan.mimeType };
		}
		const stagingFloat = plan.format !== 'flac';
		const stagingBitDepth = stagingFloat
			? 32
			: plan.format === 'flac' || plan.format === 'wavpack'
				? Math.min(24, bitDepth)
				: 24;
		const wav = encodeWav(sourceChannels, {
			sampleRate: plan.sampleRate,
			bitDepth: stagingBitDepth,
			float: stagingFloat,
			dither: stagingFloat ? 'none' : plan.ditherMode,
		});
		throwIfAborted(signal);
		setStatus(copy.encoding);
		return ffmpeg.encode(wav, plan.format, {
			...plan.encoding,
			bitDepth,
			sampleRate: plan.sampleRate,
			applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
			signal,
		});
	}

	async function renderRealtimeEncoded(snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue, sourceMap: RuntimeValue = sourceBuffers) {
		await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
		const nativeAiff = plan.format === 'aiff';
		const nativePcm = plan.format === 'wav' || plan.format === 'bwf' || nativeAiff;
		const sink = await createTemporaryFileSink(`audio-editor-${createStableId('render')}.${nativeAiff ? 'aiff' : 'wav'}`, copy);
		if (!sink.persistent
			&& (plan.outputFileBytesPerRender ?? plan.outputBytesPerRender) > 96 * 1024 ** 2) {
			await sink.abort();
			throw new Error(copy.realtimeStorageRequired);
		}
		const bitDepth = plan.encoding.bitDepth || (plan.format === 'flac' || plan.format === 'wavpack' ? settings.bitDepth : 24);
		const stagingFloat = !nativePcm && plan.format !== 'flac';
		const encoderOptions = {
			sampleRate: plan.sampleRate,
			channelCount: nativePcm ? plan.channelCount : 2,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: nativePcm ? plan.encoding.floatingPoint : stagingFloat,
			sampleFormat: nativePcm ? plan.encoding.sampleFormat : undefined,
			dither: stagingFloat ? 'none' : plan.ditherMode,
			metadata: nativePcm ? plan.metadata : undefined,
			markers: nativePcm ? plan.markers : undefined,
			bext: plan.format === 'bwf' ? plan.bext : undefined,
			collect: false,
			onChunk: (chunk: RuntimeValue) => sink.write(chunk),
		};
		const encoder = nativeAiff ? createAiffStreamEncoder(encoderOptions) : createWavStreamEncoder(encoderOptions);
		const renderEngine = createCacheAwareRenderEngine();
		let outputResampler = null;
		let renderedSampleRate = renderSampleRate;
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const renderResult = await renderEngine.renderMixRealtime({
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				sampleRate: renderSampleRate,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
				signal,
				onChunk: (channels: RuntimeValue, metadata: RuntimeValue = {}) => {
					renderedSampleRate = metadata.sampleRate || renderedSampleRate;
					outputResampler ||= createStreamingWindowedSincResampler(renderedSampleRate, plan.sampleRate, 2);
					const resampledChannels = outputResampler.push(channels);
					const outputChannels = nativePcm ? applyMediaChannelMapping(resampledChannels, plan.channelMapping) : resampledChannels;
					if (outputChannels[0]?.length) encoder.write(outputChannels);
				},
			});
			outputResampler ||= createStreamingWindowedSincResampler(renderResult.sampleRate || renderedSampleRate, plan.sampleRate, 2);
			const resampledFinalChannels = outputResampler.finish(plan.outputFrames);
			const finalChannels = nativePcm ? applyMediaChannelMapping(resampledFinalChannels, plan.channelMapping) : resampledFinalChannels;
			if (finalChannels[0]?.length) encoder.write(finalChannels);
			encoder.finalize();
			await encoder.settled();
			const stagingFile = await sink.close(nativeAiff ? 'audio/aiff' : 'audio/wav');
			if (nativePcm) {
				return { blob: stagingFile, bytes: null, mimeType: plan.mimeType, cleanup: () => sink.remove() };
			}
			setStatus(copy.encoding);
			const encoded = await ffmpeg.encodeFile(stagingFile, plan.format, {
				...plan.encoding,
				bitDepth,
				sampleRate: plan.sampleRate,
				applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
				signal,
			});
			await sink.remove();
			return encoded;
		} catch (error) {
			await sink.abort();
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}
	return Object.freeze({ exportVideo, handleExportAction, renderSnapshot });
}
