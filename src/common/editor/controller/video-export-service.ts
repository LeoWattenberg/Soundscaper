/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVisibleVideoTrackPredicate } from '../video-timeline.js';

import { prepareBrowserExportBlob } from '../browser-export-output.ts';
import { getVideoExportFormat } from '../video-export.js';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import { audioRenderedFallbackRenderSources } from './audio-rendered-fallback-export.ts';
import {
	admitVideoRenderedFallbackExport,
	assertVideoExportPublicationCurrent,
	projectForVideoRenderedFallbackExport,
	sanitizeVideoExportFileName,
} from './video-rendered-fallback-export.ts';
import {
	commitDirectVideoDestination,
	directVideoCancellation,
	prepareDirectVideoDestination,
	validateDirectVideoOutput,
	type DirectVideoDestination,
} from './direct-video-export.ts';
import {
	captureProductVideoExportActiveSourceIds,
	resolveProductVideoExportStrategy,
	type ProductVideoExportPlan,
} from './product-video-export-strategy.ts';
import { acquireVideoExportTimingIndexes } from './video-export-timing.ts';

export interface VideoExportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = VideoExportServiceRuntime[string];
type RenderSnapshot = (
	snapshot: RuntimeValue,
	range: RuntimeValue,
	sourceMap?: RuntimeValue,
	signal?: RuntimeValue,
	chunkSources?: RuntimeValue,
	prepareTimePitchCaches?: boolean,
) => Promise<RuntimeValue>;

const NO_TASK_PROGRESS = Object.freeze({
	setPhase: () => false,
	finish: () => false,
});

/** Create the video delivery action without coupling audio export orchestration to video runtime details. */
export function createEditorVideoExportAction(
	runtime: VideoExportServiceRuntime,
	renderSnapshot: RenderSnapshot,
) {
	const {
		abortError, audioBufferChannels, cloneProject, copy, createVideoExportPlan,
		encodeWav, ffmpeg, fileService, findClip, findSource, getProject, handleError,
		hasMissingTimelineSources, lifetime, playbackProjects, preflightStorage,
		projectGeneration, projectSampleRate, publishDocumentSnapshot, setStatus,
		sourceBuffers, sourceChunkProviders, state, store, throwIfAborted, toggleExport, taskProgress,
		verifyProjectFallbackIntegrity,
	} = runtime;
	const productStrategy = resolveProductVideoExportStrategy(runtime.options);

	return async function exportVideo(requestedSettings: RuntimeValue = {}) {
		if (state.exportAbort) return null;
		const canonicalProject = getProject();
		const delivery = projectForVideoRenderedFallbackExport(canonicalProject, playbackProjects);
		const deliveredProject = projectTrackFolderMediaStateV12(delivery.project);
		const productExportProject = productStrategy?.createExportProject({
			canonicalProject,
			delivery,
		}) ?? null;
		const exportProject = productExportProject
			? productExportProject
			: inheritTrackFolderMediaStateProjectionV12(
				deliveredProject,
				cloneProject(deliveredProject),
			);
		const visibleVideoTrack = createVisibleVideoTrackPredicate(exportProject.tracks);
		const hasTimelineVideo = exportProject.tracks.some((track: RuntimeValue) => (
			visibleVideoTrack(track)
			&& (track.clipIds || []).some((clipId: RuntimeValue) => findClip(exportProject, clipId)?.kind === 'video')
		));
		if (!hasTimelineVideo) throw new Error('Add a visible video clip to the timeline before exporting video.');
		const fallbackSourceIds = new Set([
			...delivery.requiredAudioSourceIds,
			...delivery.requiredVideoSourceIds,
		]);
		if (hasMissingTimelineSources(exportProject, { excludedSourceIds: fallbackSourceIds })) {
			throw new Error(copy.localSourcesMissing);
		}
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
		let pendingDirectDestination: DirectVideoDestination | null = null;
		let keyedTimingIndexes: Awaited<ReturnType<typeof acquireVideoExportTimingIndexes>> | null = null;
		const browserMaximumOutputBytes = requestedSettings.maximumOutputBytes;
		try {
			const admittedFallbacks = await admitVideoRenderedFallbackExport(canonicalProject, delivery, {
				store, verifyProjectFallbackIntegrity,
			}, { signal: abort.signal, assertCurrent: assertVideoExportCurrent });
			const formatValue = String(requestedSettings.format || 'video-mp4').replace(/^video-/, '');
			const descriptor = getVideoExportFormat(formatValue) as Readonly<{ id: 'mp4' | 'webm' }>;
			const format = descriptor.id;
			const includeAudio = exportProject.clips.some((clip: RuntimeValue) => clip.kind !== 'video');
			const requestedRange = requestedSettings.range || 'project';
			assertVideoExportCurrent();
			const productPlan = productStrategy?.createPlan({
				canonicalProject,
				exportProject,
				format,
				range: requestedRange,
				includeAudio,
				canvas: requestedSettings.canvas,
			}) ?? null;
			const productActiveSourceIds = productPlan
				? captureProductVideoExportActiveSourceIds(productPlan)
				: null;
			let plan: RuntimeValue;
			if (productPlan) {
				keyedTimingIndexes = await acquireVideoExportTimingIndexes(
					exportProject,
					store,
					{ findClip, findSource },
					{
						signal: abort.signal,
						assertCurrent: assertVideoExportCurrent,
						requiredSourceIds: productActiveSourceIds!,
					},
				);
				plan = productPlan;
			} else {
				const timingIndexes = await acquireVideoExportTimingIndexes(
					exportProject,
					store,
					{ findClip, findSource },
					{ signal: abort.signal, assertCurrent: assertVideoExportCurrent },
				);
				try {
					assertVideoExportCurrent();
					plan = createVideoExportPlan(exportProject, {
						format,
						range: requestedRange,
						includeAudio,
						canvas: requestedSettings.canvas,
					});
				} finally {
					timingIndexes.release();
				}
			}
			const fileName = `${sanitizeVideoExportFileName(exportProject.title)}.${plan.extension}`;
			const directPreparation = await prepareDirectVideoDestination(
				fileService,
				plan,
				fileName,
				requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : null,
				abort.signal,
			);
			if (directPreparation.cancelled) return directPreparation.cancelled;
			assertVideoExportCurrent();
			pendingDirectDestination = directPreparation.destination;
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
				const blob = admittedFallbacks.videoBlob && input.sourceId === delivery.videoRenderedFallback?.sourceId
					? admittedFallbacks.videoBlob
					: await store.loadMediaAsset(input.storageKey || input.sourceId, { signal: abort.signal });
				if (!blob) throw new Error(copy.localSourcesMissing);
				videoBlobs.set(input.sourceId, blob);
			}
			let audioMixBlob = null;
			if (includeAudio) {
				const range = {
					startFrame: plan.range.startFrame,
					endFrame: plan.range.endFrame,
					includeTail: false,
					outputFrames: plan.range.durationFrames,
					preRollFrames: Math.min(plan.range.startFrame, projectSampleRate() * 10),
				};
				const fallbackRenderSources = admittedFallbacks.audioChunkProvider && delivery.audioRenderedFallback
					? audioRenderedFallbackRenderSources(
						delivery.audioRenderedFallback,
						admittedFallbacks.audioChunkProvider,
						{ sourceBuffers, sourceChunkProviders: sourceChunkProviders ?? new Map() },
					)
					: null;
				const rendered = fallbackRenderSources
					? await renderSnapshot(
						exportProject,
						range,
						fallbackRenderSources.sourceMap,
						abort.signal,
						fallbackRenderSources.chunkSources,
						fallbackRenderSources.prepareTimePitchCaches,
					)
					: await renderSnapshot(exportProject, range, sourceBuffers, abort.signal);
				assertVideoExportCurrent();
				const renderedChannels = audioBufferChannels(rendered);
				assertVideoExportCurrent();
				const wav = encodeWav(renderedChannels, {
					sampleRate: rendered.sampleRate,
					bitDepth: 32,
					float: true,
					dither: 'none',
				});
				assertVideoExportCurrent();
				audioMixBlob = new Blob([wav], { type: 'audio/wav' });
			}
			setStatus(copy.encoding);
			progressTask.setPhase(copy.encoding, { start: 0.4, end: 1, value: 0 });
			assertVideoExportCurrent();
			let encoded;
			if (pendingDirectDestination) {
				try {
					encoded = productPlan
						? await productStrategy!.encodeToSink(
							productEncodeRequest(
								canonicalProject, exportProject, productPlan, keyedTimingIndexes,
								videoBlobs, audioMixBlob, ffmpeg, abort.signal,
								assertVideoExportCurrent, browserMaximumOutputBytes,
							),
							pendingDirectDestination,
						)
						: await ffmpeg.encodeVideoToSink(
							videoBlobs,
							audioMixBlob,
							plan,
							pendingDirectDestination,
							{
								signal: abort.signal, assertCurrent: assertVideoExportCurrent,
								maximumOutputBytes: browserMaximumOutputBytes,
							},
						);
				} catch (error) {
					const cancellation = directVideoCancellation(error);
					if (cancellation) {
						pendingDirectDestination = null;
						return cancellation;
					}
					throw error;
				}
			} else {
				encoded = productPlan
					? await productStrategy!.encode(productEncodeRequest(
						canonicalProject, exportProject, productPlan, keyedTimingIndexes,
						videoBlobs, audioMixBlob, ffmpeg, abort.signal,
						assertVideoExportCurrent, browserMaximumOutputBytes,
					))
					: await ffmpeg.encodeVideo(videoBlobs, audioMixBlob, plan, {
						signal: abort.signal, maximumOutputBytes: browserMaximumOutputBytes,
					});
			}
			assertVideoExportCurrent();
			if (pendingDirectDestination) {
				const directOutput = validateDirectVideoOutput(
					encoded,
					pendingDirectDestination,
					plan,
					fileName,
				);
				if (state.outputUrl) globalThis.URL?.revokeObjectURL?.(state.outputUrl);
				await state.outputCleanup?.();
				assertVideoExportCurrent();
				state.outputUrl = null;
				state.outputCleanup = null;
				state.exportOutput = null;
				const published = await commitDirectVideoDestination(
					pendingDirectDestination,
					plan,
					fileName,
					directOutput.byteLength,
					assertVideoExportCurrent,
				);
				pendingDirectDestination = null;
				const result = Object.freeze({
					url: null,
					fileName: published.fileName || fileName,
					mimeType: directOutput.mimeType,
					size: published.size,
					method: published.method,
				});
				try { assertVideoExportCurrent(); } catch { return result; }
				state.exportOutput = result;
				setStatus(copy.done, 'success');
				publishDocumentSnapshot();
				return result;
			}
			const blob = prepareBrowserExportBlob(
				encoded, 'Video export', browserMaximumOutputBytes,
			);
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
		} catch (caughtError) {
			let error = caughtError;
			if (pendingDirectDestination) {
				try {
					await pendingDirectDestination.abort(error);
				} catch (cleanupError) {
					error = new AggregateError(
						[error, cleanupError],
						'The streamed video export and destination cleanup both failed.',
					);
				}
			}
			await pendingCleanup?.().catch(() => undefined);
			if ((error as Readonly<{ name?: string }>)?.name !== 'AbortError') handleError(error);
			return null;
		} finally {
			keyedTimingIndexes?.release();
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
			progressTask.finish();
			exportTask.finish();
		}
	};
}

function productEncodeRequest(
	canonicalProject: RuntimeValue,
	exportProject: RuntimeValue,
	plan: ProductVideoExportPlan,
	timingIndexes: Awaited<ReturnType<typeof acquireVideoExportTimingIndexes>> | null,
	videoBlobs: ReadonlyMap<string, Blob>,
	audioMix: Blob | null,
	editorFfmpeg: RuntimeValue,
	signal: AbortSignal,
	assertCurrent: () => void,
	maximumOutputBytes: unknown,
) {
	if (!timingIndexes) throw new Error('Keyed video export lost its exact timing lease.');
	return Object.freeze({
		canonicalProject,
		exportProject,
		plan,
		timingBySourceId: timingIndexes.timingBySourceId,
		videoBlobs,
		audioMix,
		editorFfmpeg,
		signal,
		assertCurrent,
		maximumOutputBytes,
	});
}
