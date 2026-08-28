/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFrame,
	normalizeFrameRange,
} from '../project.js';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
} from '../timeline-time.ts';
import { hasSequenceGeometryProjectAuthority } from '../project-schema-version.ts';
import { CONFORMED_SEQUENCE_PLACEMENT } from './command-projection-transients.ts';
import { requireTrack } from './shared-runtime.js';

export function conformedPasteAnchors(project, clipboard, command, atFrame, pastedDurationFrames) {
	const anchors = new Map();
	if (!hasSequenceGeometryProjectAuthority(project)) return anchors;
	for (const clipboardTrack of clipboard.tracks || []) {
		if ((clipboardTrack.sourceTrackType || clipboardTrack.clips?.[0]?.kind || 'audio') !== 'video') continue;
		const targetTrackId = command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId;
		const sequence = sequenceForTrack(project, targetTrackId);
		if (anchors.has(sequence.id)) continue;
		anchors.set(sequence.id, pasteSpanForSequence(project, sequence, atFrame, pastedDurationFrames));
	}
	return anchors;
}

export function pasteSpanForTrack(project, trackId, atFrame, durationFrames, conformToVideoGrid) {
	const sequence = conformToVideoGrid ? sequenceForTrack(project, trackId) : null;
	return pasteSpanForSequence(project, sequence, atFrame, durationFrames);
}

export function pasteSpanForSequence(project, sequence, atFrame, durationFrames) {
	if (!sequence) return normalizeFrameRange(atFrame, atFrame + durationFrames, 'paste range');
	const sequenceFrame = sampleFrameToVideoFrame(atFrame, sequence.rate, project.sampleRate, 'point');
	const sequenceFrameCount = Math.max(1, sampleFrameToVideoFrame(
		durationFrames,
		sequence.rate,
		project.sampleRate,
		'point',
	));
	const sampleFrame = videoFrameToSampleFrame(sequenceFrame, sequence.rate, project.sampleRate, 'point');
	const endFrame = videoFrameToSampleFrame(
		sequenceFrame + sequenceFrameCount,
		sequence.rate,
		project.sampleRate,
		'point',
	);
	return {
		...normalizeFrameRange(sampleFrame, endFrame, 'conformed paste range'),
		sequenceFrame,
		sequenceFrameCount,
		sampleFrame,
		sampleDelta: sampleFrame - atFrame,
	};
}

export function pasteTrackGroups(project, trackIds, conformToVideoGrid) {
	if (!conformToVideoGrid) return [{ sequence: null, trackIds }];
	const groups = new Map();
	for (const trackId of trackIds) {
		const sequence = sequenceForTrack(project, trackId);
		const group = groups.get(sequence.id) || { sequence, trackIds: [] };
		group.trackIds.push(trackId);
		groups.set(sequence.id, group);
	}
	return [...groups.values()];
}

export function conformClipboardVideoPlacement(descriptor, scale, sequence, anchor) {
	const offsetStart = Math.round(assertFrame(descriptor.offsetFrame, 'clipboard clip offset') * scale);
	const offsetEnd = Math.round((
		assertFrame(descriptor.offsetFrame, 'clipboard clip offset')
		+ assertFrame(descriptor.durationFrames, 'clipboard clip duration')
	) * scale);
	const relativeStart = sampleFrameToVideoFrame(offsetStart, sequence.rate, sequence.sampleRate, 'point');
	const relativeEnd = sampleFrameToVideoFrame(offsetEnd, sequence.rate, sequence.sampleRate, 'point');
	const sequenceStartFrame = anchor.sequenceFrame + relativeStart;
	const sequenceFrameCount = Math.max(1, relativeEnd - relativeStart);
	const timelineStartFrame = videoFrameToSampleFrame(
		sequenceStartFrame,
		sequence.rate,
		sequence.sampleRate,
		'point',
	);
	const timelineEndFrame = videoFrameToSampleFrame(
		sequenceStartFrame + sequenceFrameCount,
		sequence.rate,
		sequence.sampleRate,
		'point',
	);
	return {
		sequenceId: sequence.id,
		sequenceStartFrame,
		sequenceFrameCount,
		timelineStartFrame,
		durationFrames: timelineEndFrame - timelineStartFrame,
		[CONFORMED_SEQUENCE_PLACEMENT]: true,
	};
}

export function sequenceForTrack(project, trackId) {
	requireTrack(project, trackId);
	const sequence = project.sequences?.find((candidate) => candidate.trackIds?.includes(trackId))
		|| project.sequences?.find((candidate) => candidate.id === project.primarySequenceId);
	if (!sequence) throw new ReferenceError(`Track ${trackId} does not belong to a sequence.`);
	return { ...sequence, sampleRate: project.sampleRate };
}

export function clipboardContainsVideo(clipboard) {
	return (clipboard.tracks || []).some((track) => (
		(track.sourceTrackType || track.clips?.[0]?.kind || 'audio') === 'video'
	));
}
