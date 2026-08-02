/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectAudioFallbackIntegrityError } from '../project-fallback-integrity-audio.ts';
import type { DirectCompressedDestination } from './direct-compressed-export.ts';
import type { DirectPcmDestination } from './direct-pcm-export.ts';
import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from './rendered-audio-encoding.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface ExportRenderSnapshot {
	readonly sampleRate: number;
}

interface ExportRenderPlan extends RenderedAudioEncodingPlan {
	readonly range: Readonly<{
		readonly durationFrames: number;
		readonly endFrame: number;
		readonly startFrame: number;
	}>;
	readonly render: Readonly<{ readonly strategy: string }>;
	readonly tailFrames: number;
}

interface ExportRenderSettings {
	readonly bitDepth?: number;
	readonly includeTail?: boolean;
	readonly measureLoudness?: boolean;
}

export interface ExportRenderSources {
	readonly chunkSources: unknown | null;
	readonly prepareTimePitchCaches: boolean;
	readonly sourceMap: unknown;
}

interface ExportProgressRange {
	readonly end: number;
	readonly start: number;
}

interface OfflineRenderRange {
	readonly endFrame: number;
	readonly includeTail: number | false;
	readonly outputFrames: number;
	readonly preRollFrames: number;
	readonly startFrame: number;
}

export interface ExportEncodedOutput {
	readonly blob?: Blob | null;
	readonly byteLength?: number;
	readonly bytes?: Uint8Array | null;
	readonly cleanup?: () => Awaitable<void>;
	readonly directDestination?: DirectCompressedDestination | DirectPcmDestination;
	readonly mimeType: string;
}

export interface AudioExportRenderOrchestrationRuntime {
	readonly encodingRuntime: RenderedAudioEncodingRuntime;
	normalizeProjectSampleRate(sampleRate: number): number;
	renderRealtimeEncoded(
		snapshot: ExportRenderSnapshot,
		plan: ExportRenderPlan,
		settings: ExportRenderSettings,
		signal: AbortSignal,
		renderSources: ExportRenderSources,
		directDestination: DirectPcmDestination | null,
		directCompressedDestination: DirectCompressedDestination | null,
		assertDirectCurrent: () => void,
	): Awaitable<ExportEncodedOutput>;
	renderSnapshot(
		snapshot: ExportRenderSnapshot,
		range: OfflineRenderRange,
		sourceMap: unknown,
		signal: AbortSignal,
		chunkSources: unknown | null,
		prepareTimePitchCaches: boolean,
	): Awaitable<ExportRenderSnapshot>;
	readonly taskProgress?: Readonly<{
		setActivePhase?(label: unknown, progress: Readonly<{
			readonly end: number;
			readonly start: number;
			readonly value: number;
		}>): unknown;
	}>;
}

export interface AudioExportRenderOptions {
	readonly assertDirectCurrent?: () => void;
	readonly directCompressedDestination?: DirectCompressedDestination | null;
	readonly directDestination?: DirectPcmDestination | null;
	readonly plan: ExportRenderPlan;
	readonly progressRange?: ExportProgressRange;
	readonly renderSources: ExportRenderSources;
	readonly settings: ExportRenderSettings;
	readonly signal: AbortSignal;
	readonly snapshot: ExportRenderSnapshot;
}

/** Render and encode one export, retrying only failures safe for realtime reuse. */
export async function renderAndEncodeAudioExport(
	runtime: AudioExportRenderOrchestrationRuntime,
	options: AudioExportRenderOptions,
): Promise<ExportEncodedOutput> {
	const {
		encodingRuntime, normalizeProjectSampleRate,
		renderRealtimeEncoded, renderSnapshot, taskProgress,
	} = runtime;
	const {
		plan, renderSources, settings, signal, snapshot,
		directCompressedDestination = null,
		directDestination = null,
		assertDirectCurrent = () => undefined,
		progressRange = { start: 0, end: 1 },
	} = options;
	const { copy, setStatus, throwIfAborted } = encodingRuntime;
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
		return renderRealtimeEncoded(
			snapshot, plan, settings, signal, renderSources,
			directDestination, directCompressedDestination, assertDirectCurrent,
		);
	}
	let rendered: ExportRenderSnapshot;
	try {
		rendered = await renderSnapshot(snapshot, {
			startFrame: plan.range.startFrame,
			endFrame: plan.range.endFrame,
			includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
			outputFrames: plan.range.durationFrames + plan.tailFrames,
			preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
		}, renderSources.sourceMap, signal, renderSources.chunkSources, renderSources.prepareTimePitchCaches);
		throwIfAborted(signal);
	} catch (error) {
		if (signal.aborted
			|| (error as Readonly<{ name?: string }>)?.name === 'AbortError'
			|| isProjectAudioFallbackIntegrityError(error)) throw error;
		assertDirectCurrent();
		if (!allowsRealtimeFallback(plan, settings)
			|| !directRenderFallbackAvailable(directDestination, directCompressedDestination)) {
			throw error;
		}
		setStatus(copy.realtimeExportFallback);
		return renderRealtimeEncoded(
			snapshot, plan, settings, signal, renderSources,
			directDestination, directCompressedDestination, assertDirectCurrent,
		);
	}
	try {
		taskProgress?.setActivePhase?.(copy.encoding, {
			start: progressRange.start + progressSpan * 0.7,
			end: progressRange.end,
			value: 0,
		});
		return await encodeRenderedAudio(encodingRuntime, {
			assertCurrent: directDestination || directCompressedDestination ? assertDirectCurrent : undefined,
			directCompressedDestination,
			directDestination,
			plan,
			rendered,
			settings,
			signal,
		});
	} catch (error) {
		if (signal.aborted
			|| (error as Readonly<{ name?: string }>)?.name === 'AbortError'
			|| isProjectAudioFallbackIntegrityError(error)
			|| directDestination
			|| directCompressedDestination
			|| !allowsRealtimeFallback(plan, settings)) throw error;
		setStatus(copy.realtimeExportFallback);
		return renderRealtimeEncoded(
			snapshot, plan, settings, signal, renderSources,
			directDestination, directCompressedDestination, assertDirectCurrent,
		);
	}
}

function allowsRealtimeFallback(
	plan: ExportRenderPlan,
	settings: ExportRenderSettings,
): boolean {
	return settings.measureLoudness !== true || (plan.format !== 'bwf' && plan.format !== 'bw64');
}

function directRenderFallbackAvailable(
	directDestination: DirectPcmDestination | null,
	directCompressedDestination: DirectCompressedDestination | null,
): boolean {
	try {
		return (!directDestination || directDestination.bytesWritten() === 0)
			&& (!directCompressedDestination || directCompressedDestination.bytesWritten() === 0);
	} catch {
		return false;
	}
}
