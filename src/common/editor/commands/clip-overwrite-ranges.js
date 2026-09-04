/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	clipEndFrame,
	clipsOverlap,
} from '../project.js';
import {
	hasSequenceGeometryProjectAuthority,
} from '../project-schema-version.ts';
import {
	requireClip,
} from './shared-runtime.js';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
} from '../timeline-time.ts';

// foundation-edit-matrix: move
// foundation-edit-matrix: roll
// foundation-edit-matrix: slip
// foundation-edit-matrix: slide
// foundation-edit-matrix: rate-stretch

/**
 * What an overwrite removes, and what survives it.
 *
 * An overwrite is defined by the span it lands on rather than by the clips already there,
 * so a clip it lands across can survive as two segments, one on each side, and a clip it
 * covers entirely does not survive at all. Working the surviving ranges out before any
 * clip is written is what lets the command refuse an overlap it cannot resolve instead of
 * leaving the timeline half-edited.
 */

export function assertNonOverlappingClips(trackId, clips) {
	const ordered = [...clips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || compareCodeUnits(left.id, right.id));
	for (let index = 1; index < ordered.length; index += 1) {
		if (clipsOverlap(ordered[index - 1], ordered[index])) {
			throw new RangeError(`Clip overlaps existing material on track ${trackId}.`);
		}
	}
}

export function remainingClipRanges(clip, activeClips) {
	let ranges = [[clip.timelineStartFrame, clipEndFrame(clip)]];
	for (const activeClip of [...activeClips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)) {
		const activeStart = activeClip.timelineStartFrame;
		const activeEnd = clipEndFrame(activeClip);
		ranges = ranges.flatMap(([startFrame, endFrame]) => {
			if (activeEnd <= startFrame || activeStart >= endFrame) return [[startFrame, endFrame]];
			const result = [];
			if (startFrame < activeStart) result.push([startFrame, activeStart]);
			if (endFrame > activeEnd) result.push([activeEnd, endFrame]);
			return result;
		});
		if (!ranges.length) break;
	}
	return ranges;
}

export function overwriteClipRanges(project, state) {
	const tracks = project.tracks.filter((track) => Array.isArray(track.clipIds));
	const movingIds = new Set(state.map((item) => item.clip.id));
	const trackIdByClipId = new Map();
	for (const track of tracks) {
		for (const clipId of track.clipIds) trackIdByClipId.set(clipId, track.id);
	}
	const clipsByAvLinkId = new Map();
	for (const clip of project.clips) {
		if (!clip.avLinkId) continue;
		const linked = clipsByAvLinkId.get(clip.avLinkId) || [];
		linked.push(clip);
		clipsByAvLinkId.set(clip.avLinkId, linked);
	}
	const cutsByTrackId = new Map();
	const conformedCutByAvLinkId = new Map();
	const conformedCutByClipId = new Map();
	for (const item of state) {
		if (item.updated.kind !== 'video') continue;
		const cut = conformedOverwriteCut(project, item);
		conformedCutByClipId.set(item.clip.id, cut);
		if (item.updated.avLinkId) conformedCutByAvLinkId.set(item.updated.avLinkId, cut);
	}
	for (const item of state) {
		const cut = conformedCutByClipId.get(item.clip.id)
			?? (item.updated.avLinkId ? conformedCutByAvLinkId.get(item.updated.avLinkId) : null)
			?? item.updated;
		appendOverwriteCut(cutsByTrackId, item.track.id, cut);
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const track of tracks) {
			const cuts = cutsByTrackId.get(track.id);
			if (!cuts?.length) continue;
			for (const clipId of track.clipIds) {
				if (movingIds.has(clipId)) continue;
				const clip = requireClip(project, clipId);
				if (!clip.avLinkId) continue;
				const overlappingCuts = cuts.filter((cut) => clipsOverlap(clip, cut));
				if (!overlappingCuts.length) continue;
				for (const linkedClip of clipsByAvLinkId.get(clip.avLinkId) || []) {
					if (linkedClip.id === clip.id || movingIds.has(linkedClip.id)) continue;
					const linkedTrackId = trackIdByClipId.get(linkedClip.id);
					if (!linkedTrackId) continue;
					for (const cut of overlappingCuts) {
						if (appendOverwriteCut(cutsByTrackId, linkedTrackId, cut)) changed = true;
					}
				}
			}
		}
	}

	const rangesByClipId = new Map();
	for (const track of tracks) {
		const cuts = cutsByTrackId.get(track.id);
		if (!cuts?.length) continue;
		for (const clipId of track.clipIds) {
			if (movingIds.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			const ranges = remainingClipRanges(clip, cuts);
			if (
				ranges.length === 1
				&& ranges[0][0] === clip.timelineStartFrame
				&& ranges[0][1] === clipEndFrame(clip)
			) continue;
			rangesByClipId.set(clip.id, ranges);
		}
	}
	return rangesByClipId;
}

export function conformedOverwriteCut(project, item) {
	if (!hasSequenceGeometryProjectAuthority(project) || item.updated.kind !== 'video') return item.updated;
	const owningSequence = project.sequences?.find((candidate) => (
		Array.isArray(candidate.trackIds) && candidate.trackIds.includes(item.track?.id)
	));
	const sequenceId = owningSequence?.id ?? item.updated.sequenceId ?? project.primarySequenceId;
	const sequence = project.sequences?.find((candidate) => candidate.id === sequenceId);
	if (!sequence) throw new ReferenceError(`Video clip ${item.clip.id} references a missing sequence.`);
	const baseSequenceStart = item.clip.sequenceStartFrame;
	const baseSequenceEnd = baseSequenceStart + item.clip.sequenceFrameCount;
	const requestedStartDelta = item.updated.timelineStartFrame - item.clip.timelineStartFrame;
	const requestedEndDelta = clipEndFrame(item.updated) - clipEndFrame(item.clip);
	const changesSequence = sequenceId !== item.clip.sequenceId;
	const sequenceStart = changesSequence
		? sampleFrameToVideoFrame(item.updated.timelineStartFrame, sequence.rate, project.sampleRate, 'point')
		: baseSequenceStart + sampleFrameToVideoFrame(
			requestedStartDelta,
			sequence.rate,
			project.sampleRate,
			'point',
		);
	const sequenceEnd = changesSequence && requestedStartDelta === requestedEndDelta
		? sequenceStart + item.clip.sequenceFrameCount
		: changesSequence
			? sampleFrameToVideoFrame(clipEndFrame(item.updated), sequence.rate, project.sampleRate, 'point')
			: baseSequenceEnd + sampleFrameToVideoFrame(
				requestedEndDelta,
				sequence.rate,
				project.sampleRate,
				'point',
			);
	if (sequenceStart < 0 || sequenceEnd <= sequenceStart) {
		throw new RangeError(`Video clip ${item.clip.id} does not retain a positive frame-grid range.`);
	}
	const timelineStartFrame = videoFrameToSampleFrame(
		sequenceStart,
		sequence.rate,
		project.sampleRate,
		'point',
	);
	const timelineEndFrame = videoFrameToSampleFrame(
		sequenceEnd,
		sequence.rate,
		project.sampleRate,
		'point',
	);
	return { timelineStartFrame, durationFrames: timelineEndFrame - timelineStartFrame };
}

export function appendOverwriteCut(cutsByTrackId, trackId, clip) {
	const startFrame = clip.timelineStartFrame;
	const endFrame = clipEndFrame(clip);
	const cuts = cutsByTrackId.get(trackId) || [];
	if (cuts.some((cut) => (
		cut.timelineStartFrame === startFrame
		&& clipEndFrame(cut) === endFrame
	))) return false;
	cuts.push({ timelineStartFrame: startFrame, durationFrames: endFrame - startFrame });
	cuts.sort((left, right) => (
		left.timelineStartFrame - right.timelineStartFrame
		|| clipEndFrame(left) - clipEndFrame(right)
	));
	cutsByTrackId.set(trackId, cuts);
	return true;
}
