/* SPDX-License-Identifier: AGPL-3.0-only */

import { measureBextLoudness } from '../broadcast-loudness.ts';
import { directPcmContainerLabel, prepareDirectPcmExportDestination } from './direct-export-dispatch.ts';
import { commitDirectPcmDestination, createDirectPcmEncoder, directPcmRenderQueueOptions, type DirectPcmDestination } from './direct-pcm-export.ts';
import { createRealtimeExportPcmTransform, type RealtimeExportPcmTransform } from './realtime-export-pcm-transform.ts';
import { admitVideoRenderedFallbackExport, assertVideoExportPublicationCurrent, projectForVideoRenderedFallbackExport, sanitizeVideoExportFileName } from './video-rendered-fallback-export.ts';
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
		handleError, hasMissingTimelineSources, lifetime, normalizeExportSettings, playbackProjects,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches, productName,
		getProject, projectGeneration, projectSampleRate, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress, verifyProjectFallbackIntegrity,
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
		const abort = Object.freeze({ signal: exportTask.signal, abort: () => lifetime.cancelTask('export') });
		const assertExportCurrent = () => {
			throwIfAborted(abort.signal);
			exportTask.assertCurrent();
			projectGeneration.assertCurrent(projectToken);
			if (generation !== state.exportGeneration || state.disposed) throw abortError();
		};
		state.exportAbort = abort;
		toggleExport(true);
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0) || NO_TASK_PROGRESS;
		let exportProject = cloneProject(getProject());
		const exportSources = new Map(sourceBuffers);
		let pendingCleanup = null;
		let pendingDirectDestination: DirectPcmDestination | null = null;
		try {
			const settings = normalizeExportSettings(requestedSettings || {});
			const plan = createExportPlan(exportProject, {
				...settings,
				inputChannelCount: exportProject.masterChannels,
				mobile: state.mobile,
				livePcmBytes: undefined,
				productName,
			});
			if (plan.format === 'bw64' && plan.adm) {
				exportProject = {
					...exportProject,
					masterChannels: plan.channelCount,
					metadata: { ...exportProject.metadata, adm: plan.adm.metadata },
				};
			}
			const directPreparation = await prepareDirectPcmExportDestination(
				fileService, plan,
				requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
				abort.signal,
			);
			if (directPreparation.cancelled) return directPreparation.cancelled;
			pendingDirectDestination = directPreparation.destination;
			if (!pendingDirectDestination) {
				await preflightStorage(
					plan.requiredTemporaryBytes ?? plan.outputBytesPerRender * Math.max(1, plan.outputs.length),
					'export',
				);
			}
			setStatus(copy.rendering);
			let blob;
			let fileName;
			let outputCleanup = null;
			let directOutput = null;
			if (plan.mode === 'mix') {
				const encoded = await renderAndEncode(
					exportProject, plan, settings, abort.signal, exportSources,
					{ start: 0, end: 1 },
					pendingDirectDestination,
				);
				if (encoded.directDestination) directOutput = encoded;
				else {
					blob = encoded.blob || new Blob([encoded.bytes], { type: encoded.mimeType });
					outputCleanup = encoded.cleanup || null;
					pendingCleanup = outputCleanup;
				}
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
			assertExportCurrent();
			if (directOutput) {
				await clearPreviousExportOutput();
				const published = await commitDirectPcmDestination(
					pendingDirectDestination!,
					plan.outputFileBytesPerRender,
					directOutput.byteLength,
					assertExportCurrent, directPcmContainerLabel(plan.format),
				);
				pendingDirectDestination = null;
				const result = Object.freeze({
					url: null,
					fileName: published.fileName || fileName,
					mimeType: directOutput.mimeType,
					size: published.size,
					method: published.method,
				});
				try { assertExportCurrent(); } catch { return result; }
				state.exportOutput = result;
				setStatus(copy.done, 'success');
				publishDocumentSnapshot();
				return result;
			}
			await clearPreviousExportOutput();
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
		} catch (caughtError) {
			let error = caughtError;
			if (pendingDirectDestination) {
				try {
					await pendingDirectDestination.abort(error);
				} catch (cleanupError) {
					error = new AggregateError(
						[error, cleanupError],
						'The streamed PCM export and destination cleanup both failed.',
					);
				}
			}
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

	async function clearPreviousExportOutput() {
		if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
		await state.outputCleanup?.();
		state.outputUrl = null;
		state.outputCleanup = null;
		state.exportOutput = null;
	}

	async function exportVideo(requestedSettings: RuntimeValue = {}) {
		if (state.exportAbort) return null;
		const canonicalProject = getProject();
		const delivery = projectForVideoRenderedFallbackExport(canonicalProject, playbackProjects);
		const exportProject = cloneProject(delivery.project);
		const hasTimelineVideo = exportProject.tracks.some((track: RuntimeValue) => (
			track.type === 'video'
			&& track.hidden !== true
			&& (track.clipIds || []).some((clipId: RuntimeValue) => findClip(exportProject, clipId)?.kind === 'video')
		));
		if (!hasTimelineVideo) throw new Error('Add a visible video clip to the timeline before exporting video.');
		if (hasMissingTimelineSources(exportProject)) throw new Error(copy.localSourcesMissing);
		const generation = ++state.exportGeneration;
		const projectToken = projectGeneration.capture(canonicalProject.id);
		const exportTask = lifetime.startTask('export');
		const abort = Object.freeze({
			signal: exportTask.signal,
			abort: () => lifetime.cancelTask('export'),
		});
		const assertVideoExportCurrent = () => {
			throwIfAborted(abort.signal);
			exportTask.assertCurrent();
			projectGeneration.assertCurrent(projectToken);
			if (generation !== state.exportGeneration || state.disposed) throw abortError();
		};
		state.exportAbort = abort;
		toggleExport(true);
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0) || NO_TASK_PROGRESS;
		let pendingCleanup = null;
		try {
			await admitVideoRenderedFallbackExport(canonicalProject, delivery, {
				store, verifyProjectFallbackIntegrity,
			}, { signal: abort.signal, assertCurrent: assertVideoExportCurrent });
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
				const blob = await store.loadMediaAsset(input.storageKey || input.sourceId, { signal: abort.signal });
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
			assertVideoExportCurrent();
			const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
			const fileName = `${sanitizeVideoExportFileName(exportProject.title)}.${plan.extension}`;
			if (state.outputUrl) globalThis.URL?.revokeObjectURL?.(state.outputUrl);
			await state.outputCleanup?.();
			assertVideoExportCurrent();
			state.outputUrl = null;
			state.outputCleanup = null;
			state.exportOutput = null;
			const published = await fileService.createDownload({
				purpose: 'video',
				suggestedName: fileName,
				mimeType: encoded.mimeType,
				blob,
				signal: abort.signal,
			});
			await assertVideoExportPublicationCurrent(published, assertVideoExportCurrent);
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

	async function renderAndEncode(
		snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
		sourceMap: RuntimeValue = sourceBuffers,
		progressRange: RuntimeValue = { start: 0, end: 1 },
		directDestination: DirectPcmDestination | null = null,
	) {
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
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap, directDestination);
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
		if (plan.format === 'wav' || plan.format === 'bwf' || plan.format === 'bw64' || plan.format === 'aiff') {
			const mapped = applyMediaChannelMapping(sourceChannels, plan.channelMapping);
			const broadcast = plan.format === 'bwf' || plan.format === 'bw64';
			const measuredBext = broadcast && settings.measureLoudness === true
				? { ...plan.bext, ...measureBextLoudness(mapped, plan.sampleRate) }
				: plan.bext;
			const nativeOptions = {
				container: plan.container,
				sampleRate: plan.sampleRate,
				bitDepth,
				float: plan.encoding.floatingPoint,
				sampleFormat: plan.encoding.sampleFormat,
				dither: plan.ditherMode,
				metadata: plan.metadata,
				markers: plan.markers,
				ixml: plan.ixml,
				cart: plan.cart,
				bext: broadcast ? measuredBext : undefined,
				preDataChunks: plan.preDataChunks,
				trailingChunks: plan.trailingChunks,
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

	async function renderRealtimeEncoded(
		snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
		sourceMap: RuntimeValue = sourceBuffers,
		directDestination: DirectPcmDestination | null = null,
	) {
		await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
		const nativeAiff = plan.format === 'aiff';
		const nativeWav = plan.format === 'wav' || plan.format === 'bwf' || plan.format === 'bw64';
		const nativePcm = nativeWav || nativeAiff;
		const containerLabel = directPcmContainerLabel(plan.format);
		const broadcast = plan.format === 'bwf' || plan.format === 'bw64';
		const sink = directDestination
			? null
			: await createTemporaryFileSink(`audio-editor-${createStableId('render')}.${nativeAiff ? 'aiff' : 'wav'}`, copy);
		if (sink && !sink.persistent
			&& (plan.outputFileBytesPerRender ?? plan.outputBytesPerRender) > 96 * 1024 ** 2) {
			await sink.abort();
			throw new Error(copy.realtimeStorageRequired);
		}
		const bitDepth = plan.encoding.bitDepth || (plan.format === 'flac' || plan.format === 'wavpack' ? settings.bitDepth : 24);
		const stagingFloat = !nativePcm && plan.format !== 'flac';
		const encoderOptions = {
			container: nativeWav ? plan.container : undefined,
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: nativePcm ? plan.encoding.floatingPoint : stagingFloat,
			sampleFormat: nativePcm ? plan.encoding.sampleFormat : undefined,
			dither: stagingFloat ? 'none' : plan.ditherMode,
			metadata: nativePcm ? plan.metadata : undefined,
			markers: nativePcm ? plan.markers : undefined,
			ixml: nativePcm ? plan.ixml : undefined,
			cart: broadcast ? plan.cart : undefined,
			bext: broadcast ? plan.bext : undefined,
			preDataChunks: nativeWav ? plan.preDataChunks : undefined,
			trailingChunks: nativeWav ? plan.trailingChunks : undefined,
		};
		const directEncoder = directDestination
			? await createDirectPcmEncoder(directDestination, nativeAiff ? createAiffStreamEncoder : createWavStreamEncoder, encoderOptions, containerLabel)
			: null;
		const encoder = directEncoder ? null : (nativeAiff
			? createAiffStreamEncoder({
				...encoderOptions,
				collect: false,
				onChunk: (chunk: RuntimeValue) => sink.write(chunk),
			})
			: createWavStreamEncoder({
				...encoderOptions,
				collect: false,
				onChunk: (chunk: RuntimeValue) => sink.write(chunk),
			}));
		const renderEngine = createCacheAwareRenderEngine();
		const outputTransform: { current: RealtimeExportPcmTransform | null } = { current: null };
		let renderedSampleRate = renderSampleRate;
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			await renderEngine.renderMixRealtime({
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				sampleRate: renderSampleRate,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
				...(directDestination ? directPcmRenderQueueOptions(Number(snapshot.masterChannels || 2), containerLabel) : {}),
				...withRenderProgress({}),
				signal,
				onChunk: (channels: RuntimeValue, metadata: RuntimeValue = {}) => {
					renderedSampleRate = metadata.sampleRate || renderedSampleRate;
					outputTransform.current ||= createRealtimeExportPcmTransform({
						inputChannelCount: channels.length, inputSampleRate: renderedSampleRate,
						outputChannelCount: plan.channelCount, outputSampleRate: plan.sampleRate,
						channelMapping: plan.channelMapping, applyChannelMapping: applyMediaChannelMapping,
						createResampler: createStreamingWindowedSincResampler, optimizeSelectionUpmix: Boolean(directEncoder),
					});
					const outputChannels = outputTransform.current.push(channels);
					if (!outputChannels[0]?.length) return undefined;
					if (directEncoder) return directEncoder.write(outputChannels);
					encoder.write(outputChannels);
					return undefined;
				},
			});
			if (!outputTransform.current) throw new Error('Realtime export produced no PCM chunks.');
			const finalChannels = outputTransform.current.finish(plan.outputFrames);
			if (finalChannels[0]?.length && directEncoder) await directEncoder.write(finalChannels);
			else if (finalChannels[0]?.length) encoder.write(finalChannels);
			if (directEncoder) {
				const byteLength = await directEncoder.finalize();
				return { blob: null, bytes: null, byteLength, mimeType: plan.mimeType, directDestination };
			}
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
			if (sink) await sink.abort();
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}
	return Object.freeze({ exportVideo, handleExportAction, renderSnapshot });
}
