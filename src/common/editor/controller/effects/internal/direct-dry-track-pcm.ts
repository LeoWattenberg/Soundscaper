/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from '../../../audio-clip-loop.ts';
import type { EngineSourceBufferInput } from '../../../engine/public-api.ts';
import type { EffectAudioProject } from './effect-audio-service-types.ts';

const EXACT_RANGE_PCM = new WeakSet<readonly Float32Array[]>();

/** Only this renderer's owned neutral PCM supports arbitrary exact frame slicing. */
export function canSliceSimpleDryTrackPcm(channels: readonly Float32Array[]): boolean {
	return EXACT_RANGE_PCM.has(channels);
}

/** Admit only a neutral, same-rate stereo clip; every richer graph uses the engine. */
export async function renderSimpleDryTrackPcm(project: EffectAudioProject, sourceBuffers: EngineSourceBufferInput,
	trackId: string, startFrame: number, endFrame: number, channelCount: number,
	requestedClipIds: readonly string[] | null = null, signal: AbortSignal | null = null): Promise<Float32Array[] | null> {
	signal?.throwIfAborted();
	if (channelCount !== 2 || project.masterChannels !== 2 || !Number.isSafeInteger(startFrame)
		|| startFrame < 0 || !Number.isSafeInteger(endFrame) || endFrame <= startFrame
		|| nonempty(project.trackFolders) || nonempty(project.automationLanes)
		|| (project.metadata as { adm?: unknown } | undefined)?.adm) return null;
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track || track.type !== 'audio' || (track.gain ?? 1) !== 1 || (track.pan ?? 0) !== 0
		|| track.mute || track.solo || nonempty(track.effects) || nonempty(track.envelope)
		|| track.audioFreeze != null || new Set(track.clipIds).size !== track.clipIds?.length) return null;
	const scope = requestedClipIds?.length ? new Set(requestedClipIds) : null;
	const trackIds = new Set(track.clipIds?.filter((id) => !scope || scope.has(id)));
	const clips = project.clips.filter((clip) => trackIds.has(clip.id)
		&& typeof clip.timelineStartFrame === 'number' && typeof clip.durationFrames === 'number'
		&& clip.timelineStartFrame < endFrame && clip.timelineStartFrame + clip.durationFrames > startFrame);
	if (clips.length !== 1) return null;
	const clip = clips[0]!;
	const duration = clip.durationFrames!;
	const clipStart = clip.timelineStartFrame!;
	const sourceStart = clip.sourceStartFrame ?? 0;
	if (!Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(clipStart) || clipStart < 0
		|| !Number.isSafeInteger(sourceStart) || sourceStart < 0 || clip.kind && clip.kind !== 'audio'
		|| (clip.sourceDurationFrames ?? duration) !== duration || clip.reversed || clip.inverted
		|| (clip.gain ?? 1) !== 1 || (clip.fadeInFrames ?? 0) !== 0 || (clip.fadeOutFrames ?? 0) !== 0
		|| nonempty(clip.envelope) || clip.warpMap != null || clip.anchor === 'musical'
		|| (clip.pitchCents ?? 0) !== 0 || (clip.speedRatio ?? 1) !== 1 || clip.linkPitchAndTempo
		|| clip.stretchToTempo || readClipLoop(clip)) return null;
	// A wider track route can downmix even when the selected source is stereo.
	for (const clipId of track.clipIds ?? []) {
		const authored = project.clips.find((candidate) => candidate.id === clipId);
		const source = authored && project.sources.find((candidate) => candidate.id === authored.sourceId);
		if (!source || source.channelCount !== 1 && source.channelCount !== 2) return null;
	}
	const buffers = sourceBuffers as ReadonlyMap<unknown, AudioBuffer>;
	const buffer = typeof buffers.get === 'function' ? buffers.get(clip.sourceId)
		: (sourceBuffers as Readonly<Record<string, AudioBuffer>>)[clip.sourceId];
	if (!buffer || buffer.sampleRate !== project.sampleRate || buffer.numberOfChannels !== 2
		|| buffer.length < sourceStart + duration || typeof buffer.getChannelData !== 'function') return null;
	const from = Math.max(startFrame, clipStart);
	const to = Math.min(endFrame, clipStart + duration);
	const offset = sourceStart + from - clipStart;
	const destination = from - startFrame;
	const count = to - from;
	const output = Array.from({ length: 2 }, () => new Float32Array(endFrame - startFrame));
	let lastYield = performance.now();
	for (let channel = 0; channel < 2; channel += 1) {
		const input = buffer.getChannelData(channel);
		for (let frame = 0; frame < count; frame += 65_536) {
			const frames = Math.min(65_536, count - frame);
			const target = output[channel]!;
			for (let index = 0; index < frames; index += 1) {
				const sample = input[offset + frame + index]!;
				if (!Number.isFinite(sample)) return null;
				// A unity WebAudio graph sums into zero and flushes Float32 subnormals.
				target[destination + frame + index] = sample < 2 ** -126 && sample > -(2 ** -126) ? 0 : sample;
			}
			if (performance.now() - lastYield >= 4) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				signal?.throwIfAborted();
				lastYield = performance.now();
			}
		}
	}
	signal?.throwIfAborted();
	EXACT_RANGE_PCM.add(output);
	return output;
}

function nonempty(value: unknown): boolean {
	return value != null && (!Array.isArray(value) || value.length > 0);
}
