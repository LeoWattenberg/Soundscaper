/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from '../audio-clip-loop.ts';
import { planExactAudioWarpWindow } from './audio-warp-fallback.ts';
import { audioBufferChannels, clampFrame } from './buffer-math.ts';
import { projectEffectRacks } from './project-effects.ts';
import { resolveRenderTailSeconds } from './rendering-range.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
import type { EngineProject } from './types.ts';
import type { EngineRealtimeRenderOptions, EngineRenderResult } from './public-api.ts';

/** Range-independent schedules can restart offline windows without processor history. */
export function canStreamStatelessOffline(project: EngineProject | null): boolean {
	if (!project || nonempty(project.automationLanes) || project.metadata?.adm
		|| project.clips?.length !== 1 || project.tracks?.length !== 1 || project.tracks[0]?.type !== 'audio'
		|| project.clips[0]?.timelineStartFrame !== 0 || project.masterChannels !== 2) return false;
	const source = project.sources?.find(item => item.id === project.clips?.[0]?.sourceId);
	if (source?.channelCount !== 2 || project.tracks[0].clipIds?.length !== 1
		|| project.tracks[0].clipIds[0] !== project.clips[0].id
		|| nonempty(project.mixer?.groups) || nonempty(project.mixer?.sends) || nonempty(project.mixer?.cues)
		|| Object.keys(project.mixer?.routes ?? {}).length > 0) return false;
	if (project.sources?.some(source => 'sampleRate' in source && source.sampleRate !== project.sampleRate)) return false;
	for (const rack of projectEffectRacks(project)) {
		if (rack.effectsActive && rack.effects.some(effect => effect.enabled !== false && effect.bypassed !== true)) return false;
	}
	for (const owner of [...project.tracks ?? [], project.master,
		...project.mixer?.groups ?? [], ...project.mixer?.sends ?? [], ...project.mixer?.cues ?? []]) {
		if (nonempty(owner?.envelope) || (owner?.gain ?? 1) !== 1 || (owner?.pan ?? 0) !== 0
			|| owner && 'audioFreeze' in owner && owner.audioFreeze != null) return false;
	}
	for (const clip of project.clips ?? []) {
		if (!Number.isSafeInteger(clip.timelineStartFrame) || !Number.isSafeInteger(clip.durationFrames)
			|| (clip.sourceDurationFrames ?? clip.durationFrames) !== clip.durationFrames
			|| clip.anchor === 'musical' || clip.warpMap != null || clip.reversed || readClipLoop(clip)
			|| (clip.speedRatio ?? 1) !== 1 || (clip.pitchCents ?? 0) !== 0 || clip.linkPitchAndTempo
			|| clip.stretchToTempo || (clip.fadeInFrames ?? 0) !== 0 || (clip.fadeOutFrames ?? 0) !== 0
			|| (clip.gain ?? 1) !== 1 || clip.inverted || nonempty(clip.envelope)) return false;
	}
	return true;
}

/** Drain bounded authoritative offline renders; no realtime clock or enlarged output budget. */
export async function renderStatelessOfflineToSink(
	engine: EngineRuntimeHost,
	options: EngineRealtimeRenderOptions,
): Promise<Readonly<EngineRenderResult>> {
	const project = engine.project;
	if (!canStreamStatelessOffline(project) || !project) throw new TypeError('The graph requires continuous processor state.');
	const onChunk = options.onChunk;
	if (!onChunk) throw new TypeError('An offline PCM sink is required.');
	if ((options.sampleRate ?? engine.sampleRate) !== engine.sampleRate) throw new RangeError('Offline windows require the project sample rate.');
	const chunkFrames = options.chunkFrames ?? 4_096;
	if (!Number.isSafeInteger(chunkFrames) || chunkFrames < 256 || chunkFrames > 65_536) throw new RangeError('Offline packet size is out of bounds.');
	const startFrame = clampFrame(options.startFrame ?? 0, 0, engine.durationFrames);
	const endFrame = clampFrame(options.endFrame ?? engine.durationFrames, startFrame, engine.durationFrames);
	if (endFrame <= startFrame) throw new RangeError('Offline streaming requires a non-empty range.');
	const tailFrames = Math.round(resolveRenderTailSeconds(project, options.includeTail ?? false, options) * engine.sampleRate);
	if (tailFrames !== 0) throw new TypeError('Bounded stateless streaming requires a tail-free graph.');
	const totalFrames = endFrame - startFrame + tailFrames;
	if (options.outputFrames != null && options.outputFrames !== totalFrames) throw new RangeError('Offline stream output geometry changed.');
	const authority = JSON.stringify(project);
	const assertCurrent = (): void => {
		options.signal?.throwIfAborted();
		if (engine.project !== project || JSON.stringify(project) !== authority) throw new Error('The project changed during offline streaming.');
	};
	let cursor = startFrame; let frameOffset = 0; let chunkCount = 0; let channelCount = 0;
	while (cursor < endFrame) {
		assertCurrent();
		const range = planExactAudioWarpWindow({ startFrame: cursor, endFrame, sampleRate: engine.sampleRate,
			channelCount: 32, tailFrames });
		const final = range.endFrame === endFrame;
		const rendered = await engine.renderMix({ ...options, startFrame: cursor, endFrame: range.endFrame,
			preRollFrames: 0, outputFrames: range.frameCount + (final ? tailFrames : 0),
			includeTail: final ? options.includeTail : false });
		assertCurrent();
		const channels = audioBufferChannels(rendered);
		const frames = range.frameCount + (final ? tailFrames : 0);
		channelCount ||= channels.length;
		if (channelCount > 32 || channels.length !== channelCount || channels.some(channel => channel.length !== frames)) throw new RangeError('Offline window geometry changed.');
		for (let offset = 0; offset < frames; offset += chunkFrames) {
			assertCurrent();
			const packet = channels.map(channel => channel.slice(offset, Math.min(offset + chunkFrames, frames)));
			await onChunk(packet, { frameOffset, sampleRate: engine.sampleRate });
			assertCurrent();
			frameOffset += packet[0]!.length; chunkCount++;
			options.onProgress?.({ frames: frameOffset, totalFrames, progress: frameOffset / totalFrames });
		}
		cursor = range.endFrame;
	}
	assertCurrent();
	if (frameOffset !== totalFrames) throw new RangeError('Offline stream frame count changed.');
	return Object.freeze({ sampleRate: engine.sampleRate, channelCount, frameCount: frameOffset, chunkCount });
}

function nonempty(value: unknown): boolean { return value != null && (!Array.isArray(value) || value.length > 0); }
