/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useReducer, useRef } from 'react';

import type { AudioWarpRuntimeProject } from '../../audio-warp-runtime.ts';
import { createWaveformContentKey } from '../waveform-preview-cache.ts';
import {
	MINIMUM_VISIBLE_CLIP_PIXELS,
	pcmWindowCoversProjectedClip,
	projectedClipVisibleSourceSamples,
} from './preview.ts';
import {
	generateSpectrogramPcmTiles,
	type SpectrogramPcmColumns,
} from './spectrogram-pcm-tiles.ts';
import type {
	TimelineClipVisualData,
	TimelinePcmWindow,
	TimelineWaveformClip,
	TimelineWaveformSource,
} from './waveform-view-model.ts';

interface SpectrogramProjectedClip extends TimelineWaveformClip {
	readonly isRecordingPreview?: boolean;
}

interface SpectrogramTileController {
	getClipVisualData(clipId: string): TimelineClipVisualData | null | undefined;
	getProjectBinClipVisualData?(clipId: string): TimelineClipVisualData | null | undefined;
	readonly actions: Readonly<{ timeline: Readonly<{
		requestWaveformPcmWindow(
			clipId: string,
			options: Readonly<{ startFrame: number; endFrame: number; signal?: AbortSignal }>,
		): Promise<unknown> | unknown;
	}> }>;
}

export interface SpectrogramPcmTileHookOptions {
	readonly controller: SpectrogramTileController;
	readonly projectedClips: readonly SpectrogramProjectedClip[];
	readonly sourceLookup: ReadonlyMap<string, TimelineWaveformSource>;
	readonly project: (AudioWarpRuntimeProject & Readonly<{ id?: string }>) | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly displayMode: string;
	readonly fftWindowSize: number;
	readonly windowType: string;
	/** Rerenders when visual data behind the controller changes; it is not a request key. */
	readonly visualRevision: unknown;
}

interface TileRequest {
	readonly clip: SpectrogramProjectedClip;
	readonly key: string;
	readonly width: number;
}

interface ActiveTileRequest {
	readonly key: string;
	readonly abort: AbortController;
}

interface CompletedTileRequest {
	readonly key: string;
	readonly columns: SpectrogramPcmColumns;
}

// Smaller clips already use the ordinary whole-clip PCM window request.
const MAXIMUM_WHOLE_CLIP_PCM_FRAMES = 262_144;

/** Retain streamed spectrograms across the document snapshots each PCM tile publishes. */
export function useSpectrogramPcmTiles({
	controller,
	projectedClips,
	sourceLookup,
	project,
	pixelsPerSecond,
	sampleRate,
	displayMode,
	fftWindowSize,
	windowType,
	visualRevision,
}: SpectrogramPcmTileHookOptions): ReadonlyMap<string, SpectrogramPcmColumns> {
	const active = useRef(new Map<string, ActiveTileRequest>());
	const completed = useRef(new Map<string, CompletedTileRequest>());
	const [resultRevision, publishResult] = useReducer((value: number) => value + 1, 0);
	const requests = useMemo((): readonly TileRequest[] => {
		void visualRevision;
		if (displayMode !== 'spectrogram' && displayMode !== 'multiview') return [];
		if (!(sampleRate > 0) || !(pixelsPerSecond > 0)) return [];
		const output: TileRequest[] = [];
		for (const clip of projectedClips) {
			if (clip.isRecordingPreview) continue;
			const visual = controller.getClipVisualData(clip.id)
				?? controller.getProjectBinClipVisualData?.(clip.projectBinClipId ?? clip.id);
			if (!visual?.available || visual.buffer
				|| pcmWindowCoversProjectedClip(visual.pcmWindow, clip, project)) continue;
			if (!(projectedClipVisibleSourceSamples(clip, project) > MAXIMUM_WHOLE_CLIP_PCM_FRAMES)) continue;
			const frameCount = clip.waveformEndFrame - clip.waveformStartFrame;
			if (!(frameCount > 0)) continue;
			const width = Math.max(MINIMUM_VISIBLE_CLIP_PIXELS,
				frameCount / sampleRate * pixelsPerSecond);
			const source = visual.source ?? sourceLookup.get(clip.sourceId);
			const key = JSON.stringify([
				createWaveformContentKey(source, clip),
				source?.sampleRate ?? null,
				source?.frameCount ?? null,
				clip.waveformStartFrame,
				clip.waveformEndFrame,
				width,
				fftWindowSize,
				windowType,
				sampleRate,
				project?.id ?? null,
				project?.sampleRate ?? null,
				project?.tempoMap ?? null,
			]);
			output.push({ clip, key, width });
		}
		return output;
	}, [controller, displayMode, fftWindowSize, pixelsPerSecond, project, projectedClips,
		sampleRate, sourceLookup, visualRevision, windowType]);

	useEffect(() => {
		const wanted = new Map(requests.map((request) => [request.clip.id, request]));
		for (const [clipId, request] of active.current) {
			if (wanted.get(clipId)?.key === request.key) continue;
			request.abort.abort();
			active.current.delete(clipId);
		}
		for (const [clipId, result] of completed.current) {
			if (wanted.get(clipId)?.key !== result.key) completed.current.delete(clipId);
		}
		for (const request of requests) {
			const clipId = request.clip.id;
			if (active.current.has(clipId)) continue;
			const abort = new AbortController();
			const job: ActiveTileRequest = { key: request.key, abort };
			active.current.set(clipId, job);
			void generateSpectrogramPcmTiles({
				clip: request.clip,
				project,
				width: request.width,
				fftWindowSize,
				windowType,
				signal: abort.signal,
				requestPcmWindow: async (startFrame, endFrame) => {
					abort.signal.throwIfAborted();
					const value: unknown = await controller.actions.timeline.requestWaveformPcmWindow(clipId, {
						startFrame,
						endFrame,
						signal: abort.signal,
					});
					abort.signal.throwIfAborted();
					return pcmWindowOrNull(value);
				},
			}).then((columns) => {
				if (!columns || abort.signal.aborted || active.current.get(clipId) !== job) return;
				completed.current.set(clipId, { key: request.key, columns });
				publishResult();
			}).catch(() => {
				// A clip can lose its source while analysis is in flight.
			});
		}
	}, [controller, fftWindowSize, project, requests, windowType]);

	useEffect(() => () => {
		for (const request of active.current.values()) request.abort.abort();
		active.current.clear();
		completed.current.clear();
	}, []);

	return useMemo(() => {
		void resultRevision;
		const output = new Map<string, SpectrogramPcmColumns>();
		for (const request of requests) {
			const result = completed.current.get(request.clip.id);
			if (result?.key === request.key) output.set(request.clip.id, result.columns);
		}
		return output;
	}, [requests, resultRevision]);
}

function pcmWindowOrNull(value: unknown): TimelinePcmWindow | null {
	if (!value || typeof value !== 'object') return null;
	if (!('startFrame' in value) || !Number.isSafeInteger(value.startFrame)
		|| !('endFrame' in value) || !Number.isSafeInteger(value.endFrame)
		|| !('channels' in value) || !Array.isArray(value.channels)
		|| !value.channels.every((channel: unknown) => channel instanceof Float32Array)) return null;
	return value as TimelinePcmWindow;
}
