/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectAudioFallbackIntegrityError } from '../project-fallback-integrity-audio.ts';
import type { LoudnessNormalizationDecision } from '../loudness-normalization.ts';
import type { DirectCompressedDestination } from './direct-compressed-export.ts';
import type { DirectPcmDestination } from './direct-pcm-export.ts';
import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from './rendered-audio-encoding.ts';
import { renderMasteringSequenceExport } from './mastering-sequence-export-render.ts';
import type { MasteringSequenceDeliveryPlan } from '../mastering-sequence-delivery.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface ExportRenderSnapshot {
	readonly sampleRate: number;
}

interface ExportRenderPlan extends RenderedAudioEncodingPlan {
	/** Present when this delivery is a mastering sequence rather than one range. */
	readonly masteringSequence?: MasteringSequenceDeliveryPlan;
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

export interface ExportRenderTarget {
	readonly includeMaster?: boolean;
	readonly respectMuteSolo?: boolean;
	readonly trackId?: string | null;
}

interface OfflineRenderRange {
	readonly endFrame: number;
	readonly includeTail: number | false;
	readonly includeMaster?: boolean;
	readonly outputFrames: number;
	readonly preRollFrames: number;
	readonly respectMuteSolo?: boolean;
	readonly startFrame: number;
	readonly trackId?: string | null;
}

export interface ExportEncodedOutput {
	readonly blob?: Blob | null;
	readonly byteLength?: number;
	readonly bytes?: Uint8Array | null;
	readonly cleanup?: () => Awaitable<void>;
	readonly deliveredLoudness?: Readonly<Record<string, number | null>> | null;
	readonly directDestination?: DirectCompressedDestination | DirectPcmDestination;
	readonly loudnessNormalization?: LoudnessNormalizationDecision | null;
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
		renderTarget: ExportRenderTarget,
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
	readonly renderTarget?: ExportRenderTarget;
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
		renderTarget: requestedRenderTarget = {},
		directCompressedDestination = null,
		directDestination = null,
		assertDirectCurrent = () => undefined,
		progressRange = { start: 0, end: 1 },
	} = options;
	const renderTarget = {
		trackId: requestedRenderTarget.trackId,
		includeMaster: requestedRenderTarget.includeMaster,
		respectMuteSolo: requestedRenderTarget.respectMuteSolo,
	};
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
			renderTarget,
			directDestination, directCompressedDestination, assertDirectCurrent,
		);
	}
	let rendered: ExportRenderSnapshot;
	try {
		rendered = plan.masteringSequence
			// The same offline render, called once per entry: a sequence changes
			// which ranges are rendered and where they land, never how a frame is
			// produced.
			? await renderMasteringSequenceExport({
				audioBufferChannels: encodingRuntime.audioBufferChannels,
				copy: encodingRuntime.copy,
				renderSnapshot,
				resampleBuffer: encodingRuntime.resampleBuffer,
				taskProgress,
				throwIfAborted,
			}, {
				channelCount: plan.channelCount ?? 2,
				chunkSources: renderSources.chunkSources,
				deliveryPlan: plan.masteringSequence,
				outputSampleRate: plan.sampleRate,
				prepareTimePitchCaches: renderSources.prepareTimePitchCaches,
				progressRange: {
					start: progressRange.start,
					end: progressRange.start + progressSpan * 0.7,
				},
				renderSampleRate,
				signal,
				snapshot,
				sourceMap: renderSources.sourceMap,
			})
			: await renderSnapshot(snapshot, {
				...renderTarget,
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
			renderTarget,
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
			assertCurrent: assertDirectCurrent,
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
		assertDirectCurrent();
		setStatus(copy.realtimeExportFallback);
		return renderRealtimeEncoded(
			snapshot, plan, settings, signal, renderSources,
			renderTarget,
			directDestination, directCompressedDestination, assertDirectCurrent,
		);
	}
}

function allowsRealtimeFallback(
	plan: ExportRenderPlan,
	settings: ExportRenderSettings,
): boolean {
	// A normalized delivery can never fall back: the realtime stream encodes as
	// it renders, so it has no whole-delivery measurement to decide a gain from,
	// and falling back would write an un-normalized file that still claimed a
	// target. Failing the export is the honest outcome.
	if (plan.loudnessNormalization) return false;
	// Nor a sequence: a stream renders one contiguous range, so falling back would
	// write the project's own timeline under a name that promised the sequence's.
	if (plan.masteringSequence) return false;
	// Nor a binaural delivery. The plan refuses one at build time unless the
	// render is offline, and the realtime stream has no binaural stage at all: it
	// renders the programme and maps it to the plan's two channels by index, so a
	// fallback would deliver the bed's first two channels — the rest of the bed
	// and every object silently absent — under a report claiming a binaural render.
	if (plan.binaural) return false;
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
