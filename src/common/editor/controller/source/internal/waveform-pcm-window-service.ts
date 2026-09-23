/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../../../abort-race.ts';
import {
	audioWarpMinimumSourceSpanPerColumn,
	audioWarpSourceWindowRange,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
} from '../../../audio-warp-runtime.ts';
import { isRetiredSourceReadError } from '../source-audio.ts';
import { requestCachedWaveformPeakWindow } from './waveform-peak-window-cache.ts';
import {
	isAudioWarpRuntimeClip,
	isAudioWarpRuntimeProject,
} from './waveform-window-warp-validation.ts';
import {
	requireWaveformSourceFrameCount,
	resolveWaveformPcmSourcePadding,
	resolveWaveformPcmWindowRequest,
	resolveWaveformPeakPixelWidth,
	waveformPcmWindowForVisibleRange,
	type WaveformPcmWindowRequest,
} from './waveform-pcm-window-request.ts';
import type {
	SourceLifecycleClip,
	SourceLifecycleProject,
	SourceLifecycleServiceRuntime,
	SourceLifecycleSource,
	SourceLifecycleWaveformPeakRequest,
	SourceLifecycleWaveformPeakWindow,
	SourceLifecycleWaveformPcmRequest,
	SourceLifecycleWaveformPcmWindow,
} from './source-lifecycle-types.d.ts';

/** Own bounded PCM reads and the ordinary waveform's oversized peak fallback. */
export function createWaveformPcmWindowRequester<
	Buffer,
	Project extends SourceLifecycleProject,
	Provider,
	Peaks,
	Metadata,
>(
	runtime: SourceLifecycleServiceRuntime<Buffer, Project, Provider, Peaks, Metadata>,
	registerStoredChunkProvider: (
		source: SourceLifecycleSource,
		metadata: Metadata | null | undefined,
	) => Provider | null,
) {
	const {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		audioBufferChannels, clipSourceWindowRange,
		clipWaveformPeakRequests = new Map<string, SourceLifecycleWaveformPeakRequest>(),
		clipWaveformPeakWindows = new Map<string, SourceLifecycleWaveformPeakWindow>(),
		clipWaveformPcmRequests, clipWaveformPcmWindows,
		findClip, findSource, getProject, publishDocumentSnapshot,
		readWaveformPeakWindow, readWaveformPcmWindow,
		sourceBuffers, sourceChunkProviders, store, waveformPcmWindowContains,
	} = runtime;

	async function loadWaveformProvider(projectAtStart: Project, source: SourceLifecycleSource) {
		const metadata = await store.getSourceMetadata(source.storageKey || source.id);
		if (getProject() !== projectAtStart) return null;
		const provider = registerStoredChunkProvider(source, metadata);
		return provider && getProject() === projectAtStart ? provider : null;
	}

	async function requestWaveformPcmWindow(
		clipId: string,
		options: WaveformPcmWindowRequest = {},
	): Promise<SourceLifecycleWaveformPcmWindow | SourceLifecycleWaveformPeakWindow | null> {
		const projectAtStart = getProject();
		if (!projectAtStart) return null;
		const clip = findClip(projectAtStart, clipId);
		const source = clip ? findSource(projectAtStart, clip.sourceId) : null;
		if (!clip || !source || source.kind === 'video' || source.kind === 'image') return null;
		const cacheKey = String(clip.id);
		const requestedRange = resolveWaveformPcmWindowRequest(options, clip.durationFrames);
		if (!requestedRange) return null;
		const { startFrame, endFrame } = requestedRange;
		const sourceFrameCount = requireWaveformSourceFrameCount(source.frameCount);
		let visibleRange;
		let peakRange;
		if (clip.warpMap == null) {
			visibleRange = clipSourceWindowRange(clip, startFrame, endFrame, sourceFrameCount);
			peakRange = clipSourceWindowRange(clip, startFrame, endFrame, sourceFrameCount, 0);
		} else {
			if (!isAudioWarpRuntimeProject(projectAtStart) || !isAudioWarpRuntimeClip(clip)) {
				throw new TypeError('A warped waveform window requires valid project and audio clip timing.');
			}
			visibleRange = audioWarpSourceWindowRange(projectAtStart, clip, { startFrame, endFrame, sourceFrameCount });
			peakRange = audioWarpSourceWindowRange(
				projectAtStart, clip, { startFrame, endFrame, sourceFrameCount, paddingFrames: 0 },
			);
		}
		const sourcePaddingFrames = resolveWaveformPcmSourcePadding(
			options.sourcePaddingFrames,
			MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		);
		const windowForCaller = (window: SourceLifecycleWaveformPcmWindow) => sourcePaddingFrames > 0
			? waveformPcmWindowForVisibleRange(window, visibleRange)
			: window;
		let range = {
			startFrame: Math.max(0, visibleRange.startFrame - sourcePaddingFrames),
			endFrame: Math.min(sourceFrameCount, visibleRange.endFrame + sourcePaddingFrames),
		};
		if (sourcePaddingFrames === 0 && range.endFrame - range.startFrame > MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES
			&& peakRange.endFrame - peakRange.startFrame <= MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES) range = peakRange;
		if (range.endFrame - range.startFrame > MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES) {
			if (sourcePaddingFrames > 0) return null;
			const pixelWidth = resolveWaveformPeakPixelWidth(options.pixelWidth);
			if (!pixelWidth || !readWaveformPeakWindow) return null;
			let maximumBlockSize;
			if (clip.warpMap != null) {
				const minimumSpan = audioWarpMinimumSourceSpanPerColumn(
					projectAtStart as Project & AudioWarpRuntimeProject,
					clip as SourceLifecycleClip & AudioWarpRuntimeClip,
					{ startFrame, endFrame, columnCount: Math.max(1, Math.ceil(pixelWidth)) },
				);
				maximumBlockSize = Math.floor(minimumSpan);
			} else {
				const durationFrames = Math.max(1, Number(clip.durationFrames) || 1);
				const sourceDurationFrames = Math.max(1, Number(clip.sourceDurationFrames) || durationFrames);
				maximumBlockSize = Math.floor(
					(endFrame - startFrame) * sourceDurationFrames / durationFrames / pixelWidth,
				);
			}
			if (maximumBlockSize < 1) return null;
			return requestCachedWaveformPeakWindow({
				cacheKey, sourceId: source.id, range: peakRange, pixelWidth, maximumBlockSize,
				maximumEntries: MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES,
				requests: clipWaveformPeakRequests, windows: clipWaveformPeakWindows,
				getProvider: async () => sourceChunkProviders.get(source.id)
					?? await loadWaveformProvider(projectAtStart, source),
				readWindow: readWaveformPeakWindow,
				isCurrent: () => getProject() === projectAtStart
					&& findClip(projectAtStart, clipId)?.sourceId === source.id
					&& Boolean(findSource(projectAtStart, source.id)),
				isRetiredError: isRetiredSourceReadError,
				publish: publishDocumentSnapshot,
			});
		}
		const cached = clipWaveformPcmWindows.get(cacheKey);
		if (cached && cached.sourceId === source.id && waveformPcmWindowContains(cached, range)) {
			clipWaveformPcmWindows.delete(cacheKey);
			clipWaveformPcmWindows.set(cacheKey, cached);
			return windowForCaller(cached);
		}
		const pending = clipWaveformPcmRequests.get(cacheKey);
		if (pending?.signal?.aborted) clipWaveformPcmRequests.delete(cacheKey);
		else if (pending && pending.sourceId === source.id
			&& (!pending.signal || pending.signal === options.signal)
			&& waveformPcmWindowContains(pending, range)) {
			return raceAbortableRead(() => pending.promise, options.signal).then((window) => window
				? windowForCaller(window)
				: null);
		}

		const buffer = sourceBuffers.get(source.id);
		if (buffer) {
			const bufferChannels = audioBufferChannels(buffer);
			if (bufferChannels.length) {
				const channels = bufferChannels.map((channel) => (
					channel.slice(range.startFrame, range.endFrame)
				));
				const window: SourceLifecycleWaveformPcmWindow = Object.freeze({
					clipId: cacheKey,
					sourceId: source.id,
					startFrame: range.startFrame,
					endFrame: range.endFrame,
					channels: Object.freeze(channels),
				});
				retainWaveformPcmWindow(cacheKey, window);
				publishDocumentSnapshot();
				return windowForCaller(window);
			}
		}

		let provider: Provider | null | undefined = sourceChunkProviders.get(source.id);
		provider ??= await loadWaveformProvider(projectAtStart, source);
		if (!provider) return null;
		const request: SourceLifecycleWaveformPcmRequest = {
			sourceId: source.id,
			signal: options.signal,
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			promise: Promise.resolve(readWaveformPcmWindow(provider, range, { signal: options.signal })).then((channels) => {
				if (clipWaveformPcmRequests.get(cacheKey) !== request) return null;
				clipWaveformPcmRequests.delete(cacheKey);
				const currentProject = getProject();
				if (!currentProject || currentProject !== projectAtStart || !findSource(currentProject, source.id)) return null;
				const window: SourceLifecycleWaveformPcmWindow = Object.freeze({
					clipId: cacheKey,
					sourceId: source.id,
					startFrame: range.startFrame,
					endFrame: range.endFrame,
					channels: Object.freeze(channels),
				});
				retainWaveformPcmWindow(cacheKey, window);
				publishDocumentSnapshot();
				return windowForCaller(window);
			}).catch((error: unknown) => {
				if (clipWaveformPcmRequests.get(cacheKey) === request) clipWaveformPcmRequests.delete(cacheKey);
				// A window is a speculative cache fill. Losing its provider to routine
				// retirement is not a fault the user can act on, and reporting it put a
				// generic error over an export that was still running fine.
				if (isRetiredSourceReadError(error)) return null;
				throw error;
			}),
		};
		clipWaveformPcmRequests.set(cacheKey, request);
		return request.promise;
	}

	function retainWaveformPcmWindow(cacheKey: string, window: SourceLifecycleWaveformPcmWindow): void {
		clipWaveformPcmWindows.delete(cacheKey);
		clipWaveformPcmWindows.set(cacheKey, window);
		while (clipWaveformPcmWindows.size > MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES) {
			const oldestKey = clipWaveformPcmWindows.keys().next().value;
			if (oldestKey === undefined) break;
			clipWaveformPcmWindows.delete(oldestKey);
		}
	}

	return requestWaveformPcmWindow;
}
