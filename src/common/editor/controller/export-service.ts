/* SPDX-License-Identifier: AGPL-3.0-only */

import { measureBextLoudness } from '../broadcast-loudness.ts';
import { isProjectAudioFallbackIntegrityError } from '../project-fallback-integrity-audio.ts';
import {
	admitAudioRenderedFallbackExport,
	assertAudioRenderedFallbackExportSettings,
	projectForAudioRenderedFallbackExport,
} from './audio-rendered-fallback-export.ts';
import { directPcmContainerLabel, prepareDirectPcmExportDestination } from './direct-export-dispatch.ts';
import { commitDirectMp3Destination, encodeDirectMp3StagedFile, prepareDirectMp3Destination, type DirectMp3Destination } from './direct-mp3-export.ts';
import { commitDirectPcmDestination, createDirectPcmEncoder, directPcmRenderQueueOptions, type DirectPcmDestination } from './direct-pcm-export.ts';
import { commitPreparedDirectStemArchiveDestination, directStemArchiveTemporaryBytes, prepareDirectStemArchiveDestination, streamDirectStemArchive } from './direct-stem-archive-export.ts';
import { createRealtimeExportPcmTransform, type RealtimeExportPcmTransform } from './realtime-export-pcm-transform.ts';
import { createEditorVideoExportAction } from './video-export-service.ts';
export interface ExportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}
type RuntimeValue = ExportServiceRuntime[string];

interface ExportRenderSources {
	readonly sourceMap: RuntimeValue;
	readonly chunkSources: RuntimeValue | null;
	readonly prepareTimePitchCaches: boolean;
}

const NO_TASK_PROGRESS = Object.freeze({
	setPhase: () => false,
	finish: () => false,
});

export function createEditorExportService(runtime: ExportServiceRuntime) {
	const {
		abortError, applyMediaChannelMapping, audioBufferChannels, cloneProject,
		copy, createAiffStreamEncoder, createCacheAwareRenderEngine, createExportPlan,
		createStableId, createStreamingStemArchive, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, fileService,
		handleError, hasMissingTimelineSources, lifetime, normalizeExportSettings, playbackProjects,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches, productName,
		getProject, projectGeneration, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress, verifyProjectFallbackIntegrity,
	} = runtime;
	const exportVideo = createEditorVideoExportAction(runtime, renderSnapshot);
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
		if (state.exportAbort) return;
		const canonicalProject = getProject();
		const delivery = projectForAudioRenderedFallbackExport(canonicalProject, playbackProjects);
		let settings: RuntimeValue;
		try {
			settings = normalizeExportSettings(requestedSettings || {});
			assertAudioRenderedFallbackExportSettings(delivery, settings);
		} catch (error) {
			handleError(error);
			return;
		}
		if (!delivery.project.clips.length) return;
		if (!delivery.audioRenderedFallback && hasMissingTimelineSources()) {
			throw new Error(copy.localSourcesMissing);
		}
		const generation = ++state.exportGeneration;
		const projectToken = projectGeneration.capture(canonicalProject.id);
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
		let exportProject = cloneProject(delivery.project);
		let exportRenderSources: ExportRenderSources;
		let pendingCleanup = null;
		let pendingDirectDestination: DirectPcmDestination | DirectMp3Destination | null = null;
		let directStemArchive = false;
		let directMp3 = false;
		try {
			const fallbackProvider = await admitAudioRenderedFallbackExport(canonicalProject, delivery, {
				store, verifyProjectFallbackIntegrity,
			}, { signal: abort.signal, assertCurrent: assertExportCurrent });
			exportRenderSources = fallbackProvider && delivery.audioRenderedFallback
				? Object.freeze({
					sourceMap: new Map(),
					chunkSources: new Map([[delivery.audioRenderedFallback.sourceId, fallbackProvider]]),
					prepareTimePitchCaches: false,
				})
				: Object.freeze({
					sourceMap: new Map(sourceBuffers),
					chunkSources: null,
					prepareTimePitchCaches: true,
				});
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
			const directStemTemporaryBytes = directStemArchiveTemporaryBytes(plan);
			const stemPreparation = await prepareDirectStemArchiveDestination(
				fileService, plan,
				requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
				abort.signal,
			);
			if (stemPreparation.cancelled) return stemPreparation.cancelled;
			pendingDirectDestination = stemPreparation.destination;
			directStemArchive = Boolean(pendingDirectDestination);
			if (!pendingDirectDestination) {
				const mp3Preparation = await prepareDirectMp3Destination(
					fileService, plan,
					requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
					abort.signal,
				);
				if (mp3Preparation.cancelled) return mp3Preparation.cancelled;
				pendingDirectDestination = mp3Preparation.destination;
				directMp3 = Boolean(pendingDirectDestination);
			}
			if (!pendingDirectDestination) {
				const directPreparation = await prepareDirectPcmExportDestination(
					fileService, plan,
					requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
					abort.signal,
				);
				if (directPreparation.cancelled) return directPreparation.cancelled;
				pendingDirectDestination = directPreparation.destination;
			}
			if (directStemArchive) {
				if (directStemTemporaryBytes === null) throw new Error('The direct stem archive plan changed before rendering.');
				await preflightStorage(directStemTemporaryBytes, 'export');
			} else if (!pendingDirectDestination || directMp3) {
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
					exportProject, plan, settings, abort.signal, exportRenderSources,
					{ start: 0, end: 1 },
					directMp3 ? null : pendingDirectDestination as DirectPcmDestination | null,
					directMp3 ? pendingDirectDestination as DirectMp3Destination : null,
					assertExportCurrent,
				);
				if (encoded.directDestination) directOutput = encoded;
				else {
					blob = encoded.blob || new Blob([encoded.bytes], { type: encoded.mimeType });
					outputCleanup = encoded.cleanup || null;
					pendingCleanup = outputCleanup;
				}
				fileName = plan.outputs[0].fileName;
			} else if (directStemArchive) {
				if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
				directOutput = await streamDirectStemArchive({
					destination: pendingDirectDestination as DirectPcmDestination, plan, signal: abort.signal,
					assertCurrent: assertExportCurrent,
					async renderStem(output, index) {
						const snapshot = stemProject(exportProject, output.trackId);
						return renderAndEncode(snapshot, plan, settings, abort.signal, exportRenderSources, {
							start: index / plan.outputs.length,
							end: (index + 1) / plan.outputs.length,
						});
					},
					onStemComplete(progress) { updateExportProgress(progress); },
				});
				fileName = plan.archive.fileName;
			} else {
				if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
				const archive = await createStreamingStemArchive(plan.archive, copy);
				try {
					for (let index = 0; index < plan.outputs.length; index += 1) {
						throwIfAborted(abort.signal);
						const output = plan.outputs[index];
						const snapshot = stemProject(exportProject, output.trackId);
						const encoded = await renderAndEncode(snapshot, plan, settings, abort.signal, exportRenderSources, {
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
				const published = directStemArchive
					? await commitPreparedDirectStemArchiveDestination(
						pendingDirectDestination as DirectPcmDestination, plan, directOutput.byteLength, assertExportCurrent,
					)
					: directMp3
						? await commitDirectMp3Destination(
							pendingDirectDestination as DirectMp3Destination, plan, directOutput.byteLength, assertExportCurrent,
						)
					: await commitDirectPcmDestination(
						pendingDirectDestination as DirectPcmDestination, plan.outputFileBytesPerRender, directOutput.byteLength,
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
						'The streamed audio export and destination cleanup both failed.',
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

	async function renderAndEncode(
		snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
		renderSources: ExportRenderSources,
		progressRange: RuntimeValue = { start: 0, end: 1 },
		directDestination: DirectPcmDestination | null = null,
		directMp3Destination: DirectMp3Destination | null = null,
		assertDirectCurrent: () => void = () => undefined,
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
			return renderRealtimeEncoded(snapshot, plan, settings, signal, renderSources, directDestination, directMp3Destination, assertDirectCurrent);
		}
		try {
			const rendered = await renderSnapshot(snapshot, {
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				outputFrames: plan.range.durationFrames + plan.tailFrames,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
			}, renderSources.sourceMap, signal, renderSources.chunkSources, renderSources.prepareTimePitchCaches);
			throwIfAborted(signal);
			taskProgress?.setActivePhase?.(copy.encoding, {
				start: progressRange.start + progressSpan * 0.7,
				end: progressRange.end,
				value: 0,
			});
			return await encodeRendered(rendered, plan, settings, signal);
		} catch (error) {
			if ((error as Readonly<{ name?: string }>)?.name === 'AbortError'
				|| isProjectAudioFallbackIntegrityError(error)) throw error;
			setStatus(copy.realtimeExportFallback);
			return renderRealtimeEncoded(snapshot, plan, settings, signal, renderSources, directDestination, directMp3Destination, assertDirectCurrent);
		}
	}

	async function renderSnapshot(
		snapshot: RuntimeValue,
		range: RuntimeValue,
		sourceMap: RuntimeValue = sourceBuffers,
		signal: RuntimeValue = null,
		chunkSources: RuntimeValue = null,
		prepareTimePitchCaches = true,
	) {
		throwIfAborted(signal);
		if (typeof options.renderSnapshot === 'function') {
			const rendered = chunkSources === null
				? await options.renderSnapshot(snapshot, range, sourceMap, signal)
				: await options.renderSnapshot(snapshot, range, sourceMap, signal, chunkSources);
			throwIfAborted(signal);
			return rendered;
		}
		if (prepareTimePitchCaches) await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderEngine = createCacheAwareRenderEngine();
		try {
			if (chunkSources === null) renderEngine.loadProject(snapshot, sourceMap);
			else renderEngine.loadProject(snapshot, sourceMap, { chunkSources });
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
		renderSources: ExportRenderSources,
		directDestination: DirectPcmDestination | null = null,
		directMp3Destination: DirectMp3Destination | null = null,
		assertDirectCurrent: () => void = () => undefined,
	) {
		if (renderSources.prepareTimePitchCaches) await prepareCommittedTimePitchCaches(snapshot, signal);
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
		let directMp3Handoff = false;
		try {
			if (renderSources.chunkSources === null) renderEngine.loadProject(snapshot, renderSources.sourceMap);
			else renderEngine.loadProject(snapshot, renderSources.sourceMap, {
				chunkSources: renderSources.chunkSources,
			});
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
			const transcodeSettings = {
				...plan.encoding,
				bitDepth,
				sampleRate: plan.sampleRate,
				applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
				signal,
			};
			if (directMp3Destination) {
				directMp3Handoff = true;
				return encodeDirectMp3StagedFile({
					destination: directMp3Destination, plan, stagedFile: stagingFile, ffmpeg, signal,
					encodingSettings: transcodeSettings, assertCurrent: assertDirectCurrent,
					cleanupStagedFile: () => sink.remove(), abortStagedFile: () => sink.abort(),
				});
			}
			const encoded = await ffmpeg.encodeFile(stagingFile, plan.format, transcodeSettings);
			await sink.remove();
			return encoded;
		} catch (error) {
			if (sink && !directMp3Handoff) await sink.abort();
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}
	return Object.freeze({ exportVideo, handleExportAction, renderSnapshot });
}
