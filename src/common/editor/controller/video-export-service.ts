/* SPDX-License-Identifier: AGPL-3.0-only */

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
		sourceBuffers, state, store, throwIfAborted, toggleExport, taskProgress,
		verifyProjectFallbackIntegrity,
	} = runtime;

	return async function exportVideo(requestedSettings: RuntimeValue = {}) {
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
		let pendingDirectDestination: DirectVideoDestination | null = null;
		try {
			const admittedVideoFallback = await admitVideoRenderedFallbackExport(canonicalProject, delivery, {
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
				const blob = admittedVideoFallback && input.sourceId === delivery.videoRenderedFallback?.sourceId
					? admittedVideoFallback
					: await store.loadMediaAsset(input.storageKey || input.sourceId, { signal: abort.signal });
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
			let encoded;
			if (pendingDirectDestination) {
				try {
					encoded = await ffmpeg.encodeVideoToSink(
						videoBlobs,
						audioMixBlob,
						plan,
						pendingDirectDestination,
						{ signal: abort.signal, assertCurrent: assertVideoExportCurrent },
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
				encoded = await ffmpeg.encodeVideo(videoBlobs, audioMixBlob, plan, {
					signal: abort.signal,
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
			const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
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
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
			progressTask.finish();
			exportTask.finish();
		}
	};
}
