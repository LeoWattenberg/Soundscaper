/* SPDX-License-Identifier: AGPL-3.0-only */

import { buildClipSchedulePlans } from './engine/clip-schedule-plan.ts';
import { getProjectClips, getProjectDurationFrames } from './engine/buffer-math.ts';
import type { EngineChunkSource, EngineProject } from './engine/types.ts';
import { OFFLINE_CHUNK_RESAMPLE_INPUT_FEED_FRAMES, OFFLINE_CHUNK_RESAMPLE_RADIUS } from './engine/offline-chunk-resample.ts';
import { STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES, STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES } from './clip-time-pitch-render-admission.ts';
import { SOURCE_CHUNK_FRAMES, SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES } from './source-pcm-contract.ts';
import { scaleSampleFrame } from './timeline-time.ts';

interface ExportSourceGeometry {
	readonly id: unknown;
	readonly kind?: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames?: number;
}

export interface ExportSourceRenderRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * Charge resident short sources plus the PCM buffers retained by one offline
 * render. Reuse the scheduler's clip/warp geometry: chunk buffers are per clip,
 * even for muted tracks or repeated source ranges. Chapters/sequence entries
 * render sequentially, so only the largest source working set coexists.
 * Unproven storage and scalar pitch/speed caches retain conservative full-source
 * accounting. The central output admission independently bounds render/crop PCM.
 */
export function estimateExportSourceWorkingSetBytes(
	project: EngineProject,
	ranges: readonly ExportSourceRenderRange[],
): number {
	const sampleRate = positiveInteger(project.sampleRate, 'Project sample rate');
	const duration = getProjectDurationFrames(project);
	const sources = new Map<unknown, AudioBuffer>();
	const chunkSources = new Map<unknown, EngineChunkSource>();
	let residentBytes = 0;
	for (const source of (project.sources ?? []) as readonly ExportSourceGeometry[]) {
		if (source.kind === 'video') continue;
		const frames = nonNegativeInteger(source.frameCount, 'Source frame count');
		const channels = positiveInteger(source.channelCount, 'Source channel count');
		const rate = positiveInteger(source.sampleRate ?? sampleRate, 'Source sample rate');
		const bytes = pcmBytes(frames, channels);
		const chunkFrames = source.chunkFrames;
		if (bytes > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES && Number.isSafeInteger(chunkFrames)
			&& Number(chunkFrames) > 0 && Number(chunkFrames) <= SOURCE_CHUNK_FRAMES) {
			chunkSources.set(source.id, {
				frameCount: frames, channelCount: channels, sampleRate: rate, chunkFrames: Number(chunkFrames),
				readStorageChunk: unavailablePcm,
			});
		} else {
			residentBytes = addBytes(residentBytes, bytes);
			// Geometry only; the scheduler never reads samples while deriving plans.
			sources.set(source.id, {
				length: frames, sampleRate: rate, numberOfChannels: channels, getChannelData: unavailablePcm,
			} as unknown as AudioBuffer);
		}
	}
	// Cache preparation currently visits every scalar clip, including clips
	// outside the selected render. Preserve that full-source exposure.
	let cacheScratchBytes = 0;
	for (const clip of getProjectClips(project)) {
		if (clip.kind === 'video' || clip.linkPitchAndTempo === true || (Number(clip.pitchCents ?? 0) === 0 && Number(clip.speedRatio ?? 1) === 1)) continue;
		const geometry = chunkSources.get(clip.sourceId) ?? sources.get(clip.sourceId);
		if (!geometry) continue;
		const frames = 'frameCount' in geometry ? geometry.frameCount : geometry.length;
		const channels = 'channelCount' in geometry ? geometry.channelCount : geometry.numberOfChannels;
		const speedRatio = Number(clip.speedRatio ?? 1);
		if (!Number.isFinite(speedRatio) || speedRatio <= 0) throw new RangeError('Clip speed ratio must be positive and finite.');
		const cacheFrames = Math.max(frames,
			Math.ceil(Number(clip.sourceDurationFrames ?? clip.durationFrames ?? 0) / speedRatio),
			scaleSampleFrame(Number(clip.durationFrames ?? 0), sampleRate, geometry.sampleRate, 'enclosingEnd'));
		// Two input copies and two output copies bound borrowed/reversed input
		// and sequential StaffPad stages. Its worker/scratch is shared.
		residentBytes = addBytes(residentBytes, pcmBytes(cacheFrames * 4, channels));
		cacheScratchBytes = Math.max(cacheScratchBytes, addBytes(STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES,
			pcmBytes(SOURCE_CHUNK_FRAMES + STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES, channels)));
	}
	residentBytes = addBytes(residentBytes, cacheScratchBytes);
	// The graph creates every input, including sidechain and muted inputs during
	// stem rendering. Filtering by mute/solo/target would undercount scheduling.
	const tracks = (project.tracks ?? []).filter((track) => track.type !== 'label' && track.type !== 'video');
	const trackInputs = new Map(tracks.map((track, index) => [String(track.id ?? index), {} as AudioNode]));
	let largestBytes = 0;
	for (const range of ranges) {
		const from = Math.min(nonNegativeInteger(range.startFrame, 'Render start frame'), duration);
		const to = Math.min(nonNegativeInteger(range.endFrame, 'Render end frame'), duration);
		const plans = buildClipSchedulePlans({
			project, sources, chunkSources, trackInputs, sampleRate,
			fromFrame: Math.max(0, from - sampleRate * 10), toFrame: to,
		});
		let renderBytes = residentBytes;
		const reversed = new Set<AudioBuffer>();
		for (const plan of plans) {
			if (plan.originalBuffer) {
				if (plan.reversed && !reversed.has(plan.originalBuffer)) {
					reversed.add(plan.originalBuffer);
					renderBytes = addBytes(renderBytes, pcmBytes(plan.originalBuffer.length, plan.originalBuffer.numberOfChannels));
				}
				continue;
			}
			const source = plan.chunkSource;
			if (!source) continue;
			const inputFrames = plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate;
			const outputFrames = Math.round(plan.segmentDuration * sampleRate);
			const direct = Math.abs(Math.round(plan.offsetFrame) - plan.offsetFrame) <= 1e-9
				&& Math.abs(Math.round(inputFrames) - inputFrames) <= 1e-9
				&& Math.round(inputFrames) === outputFrames;
			let retainedFrames = outputFrames;
			if (direct) {
				const first = Math.floor(plan.offsetFrame / source.chunkFrames) * source.chunkFrames;
				const end = Math.min(source.frameCount, plan.offsetFrame + inputFrames);
				const last = Math.min(source.frameCount, Math.ceil(end / source.chunkFrames) * source.chunkFrames);
				retainedFrames = Math.max(0, last - first);
			}
			// One decoded storage chunk for direct reads; resampling/reversal also
			// retains input copies and filter scratch while building the AudioBuffer.
			const temporaryOutputFrames = direct ? 0 : Math.max(outputFrames,
				Math.ceil((OFFLINE_CHUNK_RESAMPLE_INPUT_FEED_FRAMES + OFFLINE_CHUNK_RESAMPLE_RADIUS * 2) * outputFrames / inputFrames));
			const scratchFrames = (direct && !plan.reversed ? source.chunkFrames : source.chunkFrames * 3 + 8_192)
				+ temporaryOutputFrames;
			renderBytes = addBytes(renderBytes, pcmBytes(retainedFrames + scratchFrames, source.channelCount));
		}
		largestBytes = Math.max(largestBytes, renderBytes);
	}
	return Math.max(residentBytes, largestBytes);
}

function unavailablePcm(): never {
	throw new Error('Export memory estimation must not read PCM.');
}

function pcmBytes(frames: number, channels: number): number {
	const bytes = frames * channels * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Export source PCM byte size exceeds the safe integer range.');
	return bytes;
}

function addBytes(left: number, right: number): number {
	const bytes = left + right;
	if (!Number.isSafeInteger(bytes)) throw new RangeError('Export source working set exceeds the safe integer range.');
	return bytes;
}

function nonNegativeInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer.`);
	return value;
}

function positiveInteger(value: unknown, field: string): number {
	const number = nonNegativeInteger(value, field);
	if (!number) throw new RangeError(`${field} must be positive.`);
	return number;
}
