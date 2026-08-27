/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVisibleVideoTrackPredicate } from '../video-timeline.js';

import { prepareBrowserExportBlob } from '../browser-export-output.ts';
import { getVideoExportFormat } from '../video-export.js';
import { projectTrackFolderMediaStateV12 } from '../track-folder-media-runtime.ts';
import { createExportRenderProject } from './export-render-project.ts';
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
	captureProductVideoExportTimingSourceIds,
	resolveProductVideoExportStrategy,
	type ProductVideoExportPlan,
} from './product-video-export-strategy.ts';
import { acquireVideoExportTimingIndexes } from './video-export-timing.ts';
import { createVideoDeliveryReportForPlan } from '../delivery-video-conversion-inventory.ts';
import { applyMediaChannelMapping } from '../media-export.js';
import { serializeAudioEditorLabels } from '../label-io.js';
import { saveLabelExport } from './app-helpers.ts';
import { resolveVideoCaptionCues } from '../video-caption-cues.ts';
import { videoExportPlanFormat } from '../video-export-request-format.ts';
import { loadVideoBurnInFonts } from '../video-burn-in-font.ts';
import { videoBurnInFontSubsetIds } from '../video-caption-burn-in.ts';
import { resolveVideoDeliveryEncoderTier, VIDEO_DELIVERY_FFMPEG_ENCODER } from '../video-delivery-encoder-tier.ts';
import { loadVideoExportOriginal } from './video-export-original-loader.ts';
import { assertDesktopVideoExportAvailable } from '../desktop-video-export-capability.ts';
import {
	stagedAudioChannelCount,
	stagedAudioChannelLayout,
} from './video-export-staged-audio.ts';

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

/**
 * Write the caption sidecar a plan asks for, after its video has been published.
 *
 * The order matters: a delivery that failed to publish its video must not leave
 * a caption file next to nothing. This reuses the label exporter's own writer,
 * so a caption sidecar and a label export land through the same path and the
 * same browser fallback.
 */
async function deliverCaptionSidecar(
	plan: RuntimeValue,
	exportProject: RuntimeValue,
	sampleRate: number,
	videoFileName: string,
	fileService: RuntimeValue,
): Promise<void> {
	const format = plan.captions?.sidecarFormat;
	if (!format) return;
	const cues = resolveVideoCaptionCues(exportProject, {
		trackId: plan.captions.trackId,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
	});
	const text = String(serializeAudioEditorLabels(cues, { format, sampleRate }));
	await saveLabelExport({
		format,
		fileName: `${videoFileName.replace(/\.[^.]+$/u, '')}.${format}`,
		mimeType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
		text,
		labelCount: cues.length,
		trackIds: Object.freeze([String(plan.captions.trackId)]),
	} as never, null, fileService as never);
}

/**
 * The cue document a plan asks to mux, or null for the deliveries that mux none.
 *
 * SubRip is what the plan stages regardless of any sidecar the caller chose,
 * because both subtitle encoders read it losslessly for plain cues and one
 * staged form keeps the muxed track independent of the sidecar decision.
 */
function stagedCaptionDocument(
	plan: RuntimeValue,
	exportProject: RuntimeValue,
	sampleRate: number,
): Blob | null {
	if (!plan.captions?.mux) return null;
	const cues = resolveVideoCaptionCues(exportProject, {
		trackId: plan.captions.trackId,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
	});
	const text = serializeAudioEditorLabels(cues, { format: 'srt', sampleRate });
	return new Blob([text], { type: 'application/x-subrip' });
}

export function createEditorVideoExportAction(
	runtime: VideoExportServiceRuntime,
	renderSnapshot: RenderSnapshot,
) {
	const {
		abortError, audioBufferChannels, copy, createVideoExportPlan,
		encodeWav, ffmpeg, fileService, findClip, findSource, getProject, handleError,
		hasMissingTimelineSources, lifetime, playbackProjects, preflightStorage,
		projectGeneration, projectSampleRate, publishDocumentSnapshot, setStatus,
		sourceBuffers, sourceChunkProviders, state, store, throwIfAborted, toggleExport, taskProgress,
		verifyProjectFallbackIntegrity,
	} = runtime;
	// The service owns its own default so no product entry has to remember to
	// pass a font; an app that wants another one still overrides it.
	const loadBurnInFonts = (runtime.loadBurnInFonts as
		((subsetIds: readonly string[]) => Promise<ReadonlyMap<string, Blob>>) | undefined)
		?? ((subsetIds: readonly string[]) => loadVideoBurnInFonts(subsetIds));
	const productStrategy = resolveProductVideoExportStrategy(runtime.options);

	return async function exportVideo(requestedSettings: RuntimeValue = {}) {
		if (state.exportAbort) return null;
		const formatValue = videoExportPlanFormat(requestedSettings.format || 'video-mp4');
		await assertDesktopVideoExportAvailable(fileService, formatValue);
		if (typeof runtime.prepareProjectForExport === 'function') await runtime.prepareProjectForExport('video-export');
		const canonicalProject = getProject();
		const delivery = projectForVideoRenderedFallbackExport(canonicalProject, playbackProjects);
		const deliveredProject = projectTrackFolderMediaStateV12(delivery.project);
		const productExportProject = productStrategy?.createExportProject({
			canonicalProject,
			delivery,
		}) ?? null;
		const exportProject = productExportProject
			? productExportProject
			: createExportRenderProject(deliveredProject);
		const visibleVideoTrack = createVisibleVideoTrackPredicate(exportProject.tracks);
		const hasTimelinePicture = exportProject.tracks.some((track: RuntimeValue) => (
			visibleVideoTrack(track)
			&& (track.clipIds || []).some((clipId: RuntimeValue) => findClip(exportProject, clipId)?.kind === 'video')
		)) || productStrategy?.hasPicture?.(exportProject) === true;
		if (!hasTimelinePicture) throw new Error('Add visible picture content to the timeline before exporting video.');
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
			const descriptor = getVideoExportFormat(formatValue) as Readonly<{ id: 'mp4' | 'webm' }>;
			const format = descriptor.id;
			const includeAudio = exportProject.clips.some((clip: RuntimeValue) => clip.kind === 'audio');
			const requestedRange = requestedSettings.range || 'project';
			assertVideoExportCurrent();
			const productPlan = productStrategy?.createPlan({
				canonicalProject,
				exportProject,
				format,
				range: requestedRange,
				includeAudio,
				canvas: requestedSettings.canvas,
				quality: requestedSettings.quality,
				audioLayout: requestedSettings.audioLayout,
				captions: requestedSettings.captions,
			}) ?? null;
			const productTimingSourceIds = productPlan
				? captureProductVideoExportTimingSourceIds(productStrategy!, productPlan)
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
						requiredSourceIds: productTimingSourceIds!,
						allowInactiveRequiredSources: productStrategy!.captureTimingSourceIds !== undefined,
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
						quality: requestedSettings.quality,
						audioLayout: requestedSettings.audioLayout,
						captions: requestedSettings.captions,
					});
				} finally {
					timingIndexes.release();
				}
			}
			// Decided before anything is encoded, because the report below is
			// written from the plan and a decision taken later could not appear
			// in it. Only the keyed path can be handed encoded chunks: the
			// composed graph asks FFmpeg to build the picture itself.
			const encoderDecision = fileService.isDesktop === true ? VIDEO_DELIVERY_FFMPEG_ENCODER
				: await resolveVideoDeliveryEncoderTier({
				format,
				canvas: plan.canvas,
				quality: plan.quality,
				eligible: Boolean(productPlan),
				...(includeAudio ? {
					audio: {
						sampleRate: Number(plan.sampleRate),
						channelCount: stagedAudioChannelCount(plan, exportProject),
					},
				} : {}),
			});
			assertVideoExportCurrent();
			// Same rule as the audio path: the report describes the plan that runs.
			// It is session state, never project state.
			state.deliveryReport = createVideoDeliveryReportForPlan(plan, {
				hasNonMediaStreams: videoSourcesCarryNonMediaStreams(exportProject, plan),
				videoEncoder: encoderDecision.tier,
				...(encoderDecision.codec ? { videoEncoderCodec: encoderDecision.codec } : {}),
				...(encoderDecision.reason ? { videoEncoderReason: encoderDecision.reason } : {}),
				...(requestedSettings.deliveryTarget
					? { deliveryTargetId: String(requestedSettings.deliveryTarget) }
					: {}),
				...(requestedSettings.degradedFrom
					? { degradedFrom: String(requestedSettings.degradedFrom) }
					: {}),
			});
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
					: await loadVideoExportOriginal({
						store,
						project: canonicalProject,
						sourceId: String(input.sourceId),
						storageKey: String(input.storageKey || input.sourceId),
						signal: abort.signal,
						assertCurrent: assertVideoExportCurrent,
					});
				if (!blob) throw videoExportMissingOriginalError(
					canonicalProject,
					String(input.sourceId),
					String(copy.localSourcesMissing),
				);
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
				// The delivered layout is applied to the mix, not to an encoder
				// argument: both video paths consume this staged file, so a downmix
				// left to the encoder would reach only one of them.
				const renderedChannels = applyMediaChannelMapping(
					audioBufferChannels(rendered),
					stagedAudioChannelLayout(plan),
				);
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
			// The cue document is serialized from the label model the plan named and
			// staged like any other input, so the muxer reads it in the same run
			// that encodes the picture rather than reopening a finished file.
			const captionDocument = stagedCaptionDocument(plan, exportProject, projectSampleRate());
			// The app owns which font a burn-in draws with, so the bytes arrive as a
			// runtime dependency rather than as a bundler import in shared code.
			const burnInSubsets = videoBurnInFontSubsetIds(plan.filterPlan?.burnIn ?? null);
			const burnInFonts = burnInSubsets.length > 0 ? await loadBurnInFonts(burnInSubsets) : null;
			if (burnInSubsets.some((subsetId) => !(burnInFonts?.get(subsetId) instanceof Blob))) {
				throw new Error(copy.burnInFontUnavailable || 'The caption font could not be loaded.');
			}
			assertVideoExportCurrent();
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
								encoderDecision.tier === 'webcodecs'
									? { codec: encoderDecision.codec!, bitrate: encoderDecision.bitrate! }
									: null,
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
								...(captionDocument ? { captions: captionDocument } : {}),
								...(burnInFonts ? { burnInFonts } : {}),
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
						encoderDecision.tier === 'webcodecs'
							? { codec: encoderDecision.codec!, bitrate: encoderDecision.bitrate! }
							: null,
					))
					: await ffmpeg.encodeVideo(videoBlobs, audioMixBlob, plan, {
						signal: abort.signal, maximumOutputBytes: browserMaximumOutputBytes,
						...(captionDocument ? { captions: captionDocument } : {}),
						...(burnInFonts ? { burnInFonts } : {}),
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
				await deliverCaptionSidecar(plan, exportProject, projectSampleRate(), fileName, fileService);
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
			await deliverCaptionSidecar(plan, exportProject, projectSampleRate(), fileName, fileService);
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

export function videoExportMissingOriginalError(
	project: unknown,
	sourceId: string,
	fallbackMessage: string,
): Error {
	const sources = project && typeof project === 'object'
		? (project as Readonly<{ readonly sources?: readonly unknown[] }>).sources
		: null;
	const source = Array.isArray(sources) ? sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as Readonly<{ readonly id?: unknown }>).id === sourceId
	)) as Readonly<{ readonly proxyAttachment?: unknown }> | undefined : undefined;
	return new Error(source?.proxyAttachment
		? 'The original video is unavailable. Relink the original; proxies are preview-only and cannot be delivered.'
		: fallbackMessage);
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
	webCodecs: Readonly<{ codec: string; bitrate: number }> | null,
) {
	if (!timingIndexes) throw new Error('Keyed video export lost its exact timing lease.');
	return Object.freeze({
		canonicalProject,
		exportProject,
		plan,
		timingBySourceId: timingIndexes.timingBySourceId,
		timingViewsBySourceId: timingIndexes.timingViewsBySourceId,
		videoBlobs,
		audioMix,
		editorFfmpeg,
		webCodecs,
		signal,
		assertCurrent,
		maximumOutputBytes,
	});
}

/**
 * Whether any delivered source carries subtitle or data streams, which the
 * encoder's unconditional `-sn`/`-dn` will drop. Probed characteristics are the
 * only place this is known; an unprobed source reports nothing rather than
 * guessing that it lost nothing.
 */
function videoSourcesCarryNonMediaStreams(
	project: RuntimeValue,
	plan: RuntimeValue,
): boolean {
	const inputs = Array.isArray(plan?.inputs) ? plan.inputs : [];
	for (const input of inputs) {
		if (input?.kind !== 'video-source') continue;
		const source = (project?.sources ?? []).find(
			(candidate: RuntimeValue) => candidate?.id === input.sourceId,
		);
		const characteristics = source?.characteristics;
		if (Number(characteristics?.subtitleStreamCount) > 0
			|| Number(characteristics?.dataStreamCount) > 0) return true;
	}
	return false;
}
