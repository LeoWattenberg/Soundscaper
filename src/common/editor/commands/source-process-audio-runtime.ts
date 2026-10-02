/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeClipForProject, normalizeSourceForProject, assertClipSourceBounds } from './shared-runtime.js';
import type { AudioEditorCommand } from './protocol.ts';
import { normalizeAudioWarpMap } from '../audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame, isMusicalAudioWarpClip, type AudioWarpAuthorityRuntimeClip, type AudioWarpAuthorityRuntimeProject } from '../audio-warp-runtime-authority.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION, type ClipSourceStretchMemory } from '../clip-source-stretch-memory.ts';
import { addRationals, beatToSampleFrame, compareRationals, multiplyRationals, subtractRationals, type Rational } from '../timeline-time.ts';

type RecordValue = Record<string, unknown>;
interface Source extends RecordValue {
	id: string;
	kind?: string;
	frameCount: number;
	sampleRate: number;
	channelCount: number;
}
interface Clip extends RecordValue, AudioWarpAuthorityRuntimeClip {
	id: string;
	sourceId: string;
	sourceStartFrame: number;
	sourceDurationFrames: number;
	durationFrames: number;
	renderCacheRevision?: number;
	fadeInFrames?: number;
	fadeOutFrames?: number;
	envelope?: readonly Readonly<{ frame: number; value: number }>[];
}
interface Project extends RecordValue, AudioWarpAuthorityRuntimeProject {
	sources: Source[];
	clips: Clip[];
	projectBin?: { clips: Clip[] };
}

/** Replace source samples once, retaining each instance's authored processing. */
export function processSourceAudio(projectValue: object, command: Extract<AudioEditorCommand, { type: 'source/process-audio' }>): void {
	const project = projectValue as Project;
	const previous = project.sources.find((source) => source.id === command.sourceId);
	if (!previous || (previous.kind ?? 'audio') !== 'audio') throw new RangeError('Source processing requires an audio source.');
	const next = normalizeSourceForProject(project, command.source) as Source;
	if (next.kind !== 'audio' || next.channelCount !== previous.channelCount || next.sampleRate !== previous.sampleRate) {
		throw new RangeError('Source processing must preserve the channel layout and sample rate.');
	}
	if (project.sources.some((source) => source.id === next.id)) throw new RangeError('Processed audio requires a new source identity.');
	const { startFrame, endFrame } = command;
	if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
		|| startFrame < 0 || endFrame <= startFrame || endFrame > previous.frameCount) {
		throw new RangeError('Source processing range must lie inside the original source.');
	}
	const outputFrames = next.frameCount - previous.frameCount + endFrame - startFrame;
	if (!Number.isSafeInteger(outputFrames) || outputFrames < 1) throw new RangeError('Processed source range must retain audio.');
	const delta = next.frameCount - previous.frameCount;
	const mapFrame = (frame: number): number => frame <= startFrame ? frame : frame >= endFrame
		? frame + delta : startFrame + Math.round((frame - startFrame) * outputFrames / (endFrame - startFrame));
	const mapRational = (frame: Rational): Rational => compareRationals(frame, startFrame) <= 0 ? frame
		: compareRationals(frame, endFrame) >= 0 ? addRationals(frame, delta)
		: addRationals(startFrame, multiplyRationals(subtractRationals(frame, startFrame), { num: outputFrames, den: endFrame - startFrame }));
	project.sources.push(next);
	const replace = (clip: Clip): Clip => {
		if (clip.sourceId !== previous.id) return clip;
		const sourceStartFrame = Math.min(next.frameCount - 1, mapFrame(clip.sourceStartFrame));
		const sourceDurationFrames = Math.max(1, mapFrame(clip.sourceStartFrame + clip.sourceDurationFrames) - sourceStartFrame);
		const ratio = sourceDurationFrames / clip.sourceDurationFrames;
		const durationFrames = Math.max(1, Math.round(clip.durationFrames * ratio));
		const warpMap = clip.warpMap ? normalizeAudioWarpMap(clip.warpMap) : null;
		const changes: RecordValue = {
			sourceId: next.id, sourceStartFrame, sourceDurationFrames, durationFrames,
			renderCacheRevision: (clip.renderCacheRevision ?? 0) + 1,
			...(delta ? {
				fadeInFrames: Math.min(clip.fadeInFrames ?? 0, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames ?? 0, durationFrames),
				trimStartFrames: 0, trimEndFrames: 0,
				...(clip.envelope ? { envelope: remapEnvelope(clip.envelope, durationFrames) } : {}),
			} : {}),
			...(warpMap ? { warpMap: { ...warpMap, points: warpMap.points.map((point) => ({
				...point, source: mapRational(point.source),
				outer: remapWarpOuter(project, clip, point.outer, durationFrames),
			})) } } : {}),
			...remapStretchMemory(clip, previous, next, mapRational),
		};
		const updated = normalizeClipForProject(project, { ...clip, ...changes }) as Clip;
		assertClipSourceBounds(project, updated);
		return updated;
	};
	project.clips = project.clips.map(replace);
	if (project.projectBin) project.projectBin.clips = project.projectBin.clips.map(replace);
}

function remapWarpOuter(project: Project, clip: Clip, outer: Rational, durationFrames: number): Rational {
	if (durationFrames === clip.durationFrames || compareRationals(outer, 0) === 0) return outer;
	if (!isMusicalAudioWarpClip(clip)) return multiplyRationals(outer, { num: durationFrames, den: clip.durationFrames });
	// Beat spacing can change across tempo events: scale elapsed samples before
	// recovering the beat position, as the command projection does for the extent.
	const frame = beatToSampleFrame(addRationals(clip.musicalStartBeat!, outer), project.tempoMap, project.sampleRate);
	const offset = Math.round((frame - clip.timelineStartFrame) * durationFrames / clip.durationFrames);
	return audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + offset);
}

function remapStretchMemory(clip: Clip, previous: Source, next: Source, mapFrame: (frame: Rational) => Rational): RecordValue {
	const extensions = clip.opaqueExtensions && typeof clip.opaqueExtensions === 'object'
		? clip.opaqueExtensions as RecordValue : null;
	const memory = extensions?.[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	if (!memory || memory.sourceId !== previous.id || memory.sourceFrameCount !== previous.frameCount) return {};
	const map = normalizeAudioWarpMap(memory.map);
	return { opaqueExtensions: { ...extensions, [CLIP_SOURCE_STRETCH_EXTENSION]: {
		sourceId: next.id, sourceFrameCount: next.frameCount,
		map: { ...map, points: map.points.map((point) => ({ ...point, source: mapFrame(point.source), outer: mapFrame(point.outer) })) },
	} } };
}

function remapEnvelope(points: NonNullable<Clip['envelope']>, durationFrames: number) {
	const retained = new Map<number, Readonly<{ frame: number; value: number }>>();
	for (const point of points) {
		const frame = Math.min(durationFrames, point.frame);
		retained.set(frame, { ...point, frame });
	}
	return [...retained.values()];
}
