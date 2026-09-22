/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';
import { clipEndFrame } from '../project.js';
import { hasCoreEditingProjectAuthority } from '../project-schema-version.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import {
	assertClipSourceBounds,
	normalizeClipForProject,
	replaceClip,
	requireClip,
	requireClipTrack,
} from './shared-runtime.js';

/** Replace a generated voice line in place while preserving compatible clip edits. */
export function regenerateTtsClip(project, clipId, sourceId) {
	if (!hasCoreEditingProjectAuthority(project)) {
		throw new RangeError('TTS regeneration requires an active editing project.');
	}
	const clip = requireClip(project, clipId);
	if (clip.kind !== 'audio') throw new RangeError('TTS regeneration requires an audio clip.');
	if (clip.avLinkId != null || clip.anchor === 'musical' && clip.musicalExtent === 'beat') {
		throw new RangeError('Linked or beat-extent clips cannot be regenerated in place.');
	}
	const track = requireClipTrack(project, clipId);
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	if (source.kind !== 'audio' || !Number.isSafeInteger(source.sampleRate)
		|| source.sampleRate < 1 || !Number.isSafeInteger(source.frameCount)
		|| source.frameCount < 1) {
		throw new RangeError('TTS regeneration requires a positive audio source.');
	}
	const durationFrames = scaleSampleFrame(source.frameCount, source.sampleRate,
		project.sampleRate, 'point');
	const newEnd = clip.timelineStartFrame + durationFrames;
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 1 || !Number.isSafeInteger(newEnd)) {
		throw new RangeError('Regenerated TTS clip exceeds safe timeline frames.');
	}
	for (const peerId of track.clipIds) {
		if (peerId === clip.id) continue;
		const peer = requireClip(project, peerId);
		if (clip.timelineStartFrame < clipEndFrame(peer) && peer.timelineStartFrame < newEnd) {
			throw new RangeError(`Regenerated TTS clip would overlap ${peer.id} on track ${track.id}.`);
		}
	}
	const updated = normalizeClipForProject(project, {
		...clip,
		sourceId,
		sourceStartFrame: 0,
		sourceDurationFrames: source.frameCount,
		durationFrames,
		trimStartFrames: 0,
		trimEndFrames: 0,
		warpMap: null,
		fadeInFrames: Math.min(clip.fadeInFrames ?? 0, durationFrames),
		fadeOutFrames: Math.min(clip.fadeOutFrames ?? 0, durationFrames),
		envelope: retainedEnvelope(clip.envelope, clip.durationFrames, durationFrames),
		renderCacheRevision: (clip.renderCacheRevision ?? 0) + 1,
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	replaceClip(project, updated);
}

function retainedEnvelope(envelope, previousDuration, durationFrames) {
	if (!Array.isArray(envelope) || envelope.length === 0) return [];
	const kept = envelope.filter((point) => point.frame <= durationFrames);
	if (kept.length === envelope.length || kept.some((point) => point.frame === durationFrames)) return kept;
	const valueAt = createEnvelopeValueEvaluator(envelope, Math.max(1, previousDuration));
	return [...kept, { frame: durationFrames, value: valueAt(durationFrames) }];
}
