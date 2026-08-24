/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type EdlEvent,
	type EdlExportResult,
	type EdlOmission,
	createEdlExport,
} from './edl-export.ts';
import { resolveSequenceTimingView } from './sequence-timing-model.ts';
import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import {
	interchangeAnnotationOmission,
	interchangeCaptionTrackOmission,
} from './interchange-omission-inventory.ts';
import { createVisibleVideoTrackPredicate } from './video-track-visibility.js';

/**
 * Project → EDL events.
 *
 * `edl-export.ts` knows the CMX3600 grammar and nothing about documents; this
 * module is the half that reads a project. Keeping them apart matters because
 * every judgement call about what a document *means* lives here, where it can
 * be stated and tested, rather than being buried in a formatter.
 *
 * Three conversions carry the risk, and each is deliberate:
 *
 * 1. **Sample frames become sequence frames.** Clip timing is stored in the
 *    project's sample domain; an EDL counts sequence frames. The conversion
 *    goes through the shared `sequenceFrameAtSample`, so a boundary here is the
 *    boundary the ruler, the playhead, and the exporter already agree on.
 * 2. **Record timecode carries the sequence's start timecode.** A list whose
 *    record side starts at 00:00:00:00 when the sequence starts at 01:00:00:00
 *    is wrong in a way that only shows up downstream, so the sequence's own
 *    offset is added rather than assumed away.
 * 3. **Source duration is taken from the record duration, not measured
 *    separately.** A cut event must satisfy `sourceOut - sourceIn ==
 *    recordOut - recordIn`; rounding the two ends independently can break that
 *    by a frame. The record duration is authoritative and the source out point
 *    is derived from it, which is also the honest rendering of a speed-changed
 *    clip emitted at unity — and the exporter reports that omission.
 *
 * Visibility is read through the shared video-track predicate, including solo,
 * so a track that does not compose does not appear in the list either. An EDL
 * that describes a different programme than the one that would render is the
 * exact asymmetry the project forbids.
 */

interface ProjectClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: unknown;
	readonly sourceId?: unknown;
	readonly title?: unknown;
	readonly timelineStartFrame?: unknown;
	readonly durationFrames?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly speedRatio?: unknown;
	readonly transition?: unknown;
}

interface ProjectTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type?: unknown;
	readonly name?: unknown;
	readonly clipIds?: unknown;
}

export interface EdlProjectExportRequest {
	readonly project: Readonly<Record<string, unknown>>;
	/** Defaults to the project's primary sequence. */
	readonly sequenceId?: string;
	/** The single video track the list describes. Defaults to the first visible one. */
	readonly trackId?: string;
	/**
	 * Explicit source-id → reel mapping. A source with no entry falls back to
	 * its name, and the exporter reports any truncation the format forces.
	 */
	readonly reelNames?: Readonly<Record<string, string>>;
	readonly title?: string;
}

export function createProjectEdlExport(request: EdlProjectExportRequest): EdlExportResult {
	const project = request?.project;
	if (!project || typeof project !== 'object') {
		throw new TypeError('An EDL export requires a project.');
	}
	const sampleRate = Number(project.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
		throw new RangeError('An EDL export requires a positive project sample rate.');
	}
	const sequence = resolveSequenceTimingView(project, request?.sequenceId);
	const clipById = new Map(
		(Array.isArray(project.clips) ? project.clips : [])
			.filter((clip): clip is ProjectClip => Boolean(clip) && typeof clip === 'object')
			.map((clip) => [String(clip.id), clip]),
	);
	const sourceById = new Map(
		(Array.isArray(project.sources) ? project.sources : [])
			.filter((source): source is Readonly<Record<string, unknown>> => Boolean(source) && typeof source === 'object')
			.map((source) => [String(source.id), source]),
	);

	const tracks = (Array.isArray(project.tracks) ? project.tracks : [])
		.filter((track): track is ProjectTrack => Boolean(track) && typeof track === 'object');
	const isVisible = createVisibleVideoTrackPredicate(tracks);
	const videoTracks = tracks.filter((track) => track.type === 'video' && isVisible(track));
	const selected = request?.trackId
		? videoTracks.find((track) => String(track.id) === request.trackId)
		: videoTracks[0];
	if (!selected) {
		throw new ReferenceError(request?.trackId
			? `Video track ${request.trackId} is missing or does not compose.`
			: 'The project has no visible video track to describe.');
	}

	const reelNames = request?.reelNames ?? {};
	const events: EdlEvent[] = [];
	const subFrame: EdlOmission[] = [];
	const clips = clipIdsOf(selected)
		.map((clipId) => {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Video track ${selected.id} references missing clip ${clipId}.`);
			return clip;
		})
		.filter((clip) => clip.kind === 'video')
		.sort((left, right) => (
			nonNegativeInteger(left.timelineStartFrame, 'clip.timelineStartFrame')
			- nonNegativeInteger(right.timelineStartFrame, 'clip.timelineStartFrame')
			|| String(left.id).localeCompare(String(right.id))
		));

	for (const clip of clips) {
		const timelineStart = nonNegativeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const duration = positiveInteger(clip.durationFrames, 'clip.durationFrames');
		const sourceStart = nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame');

		// Both ends resolve from the origin, never by accumulating a duration.
		const recordIn = sequenceFrameAtSample(timelineStart, sequence.rate, sampleRate);
		const recordOut = sequenceFrameAtSample(timelineStart + duration, sequence.rate, sampleRate);
		const recordFrames = recordOut - recordIn;
		if (recordFrames <= 0) {
			// Shorter than one sequence frame, so there is no cut to write. The
			// list must say the clip is missing rather than quietly having one
			// fewer event than the sequence has clips.
			subFrame.push({
				code: 'edl.sub-frame-clip-omitted',
				scope: Object.freeze({ kind: 'clip', id: String(clip.id) }),
				data: Object.freeze({ durationFrames: duration }),
				message: 'The clip is shorter than one sequence frame, so it has no cut to emit.',
			});
			continue;
		}
		const sourceIn = sequenceFrameAtSample(sourceStart, sequence.rate, sampleRate);

		const source = sourceById.get(String(clip.sourceId));
		events.push(Object.freeze({
			reel: String(reelNames[String(clip.sourceId)] ?? source?.name ?? clip.sourceId ?? ''),
			trackKind: 'V' as const,
			sourceInFrames: sourceIn,
			// Derived, so the cut's two sides can never disagree by a rounded frame.
			sourceOutFrames: sourceIn + recordFrames,
			recordInFrames: recordIn + sequence.startFrameCount,
			recordOutFrames: recordOut + sequence.startFrameCount,
			clipName: String(clip.title ?? source?.name ?? ''),
			speedRatio: clip.speedRatio == null ? 1 : Number(clip.speedRatio),
			transition: clip.transition == null ? null : String(clip.transition),
		}));
	}

	return createEdlExport({
		title: String(request?.title ?? project.title ?? sequence.name ?? 'UNTITLED'),
		rate: sequence.rate,
		dropFrame: sequence.dropFrame,
		events,
		// Everything the one-track profile left behind is named, not silently lost.
		omissions: [
			...subFrame,
			...describeOmissions(tracks, selected, isVisible),
			...describeAnnotationOmission(project),
			...describeCaptionTrackOmission(project, sequence.id),
		],
	});
}

/**
 * The markers, regions, and label tracks an edit list cannot carry.
 *
 * They stay in the project, and the report is where an operator is told so;
 * without an item, a project full of markers exported as though nothing had
 * been left behind.
 */
function describeAnnotationOmission(
	project: Readonly<Record<string, unknown>>,
): readonly EdlOmission[] {
	const omission = interchangeAnnotationOmission(project);
	if (!omission) return [];
	return [{
		code: 'edl.annotations-omitted',
		scope: { kind: 'project', id: String(project.id ?? '') },
		data: {
			annotations: omission.annotations,
			labelTracks: omission.labelTracks.length,
			labels: omission.labels,
		},
		message: 'The profile carries no markers, regions, or label tracks; they stay in the project.',
	}];
}

function describeCaptionTrackOmission(
	project: Readonly<Record<string, unknown>>,
	sequenceId: string,
): readonly EdlOmission[] {
	const omission = interchangeCaptionTrackOmission(project, sequenceId);
	if (!omission) return [];
	return [{
		code: 'edl.caption-tracks-omitted',
		scope: { kind: 'project', id: String(project.id ?? '') },
		data: {
			captionTracks: omission.captionTracks.length,
			captions: omission.captions,
		},
		message: 'The profile carries no explicit styled-caption tracks; they stay in the project.',
	}];
}

/**
 * The profile emits one video track. Every other track that would have
 * contributed to the programme becomes an itemized omission, because "this list
 * is not the whole sequence" is exactly what a downstream reader needs told.
 */
function describeOmissions(
	tracks: readonly ProjectTrack[],
	selected: ProjectTrack,
	isVisible: (track: ProjectTrack) => boolean,
): readonly EdlOmission[] {
	const items: EdlOmission[] = [];
	for (const track of tracks) {
		if (track.id === selected.id) continue;
		const isVideo = track.type === 'video';
		if (isVideo && !isVisible(track)) continue;
		if (!isVideo && track.type !== 'audio') continue;
		if (clipIdsOf(track).length === 0) continue;
		items.push(Object.freeze({
			code: isVideo ? 'edl.video-track-omitted' : 'edl.audio-track-omitted',
			scope: Object.freeze({ kind: 'track', id: String(track.id) }),
			data: Object.freeze({ name: String(track.name ?? ''), clips: clipIdsOf(track).length }),
			message: isVideo
				? 'The profile describes one video track; this one is not in the list.'
				: 'The profile emits no audio events, so this track is not in the list.',
		}));
	}
	return Object.freeze(items);
}

function clipIdsOf(track: ProjectTrack): readonly string[] {
	return (Array.isArray(track.clipIds) ? track.clipIds : []).map((id) => String(id));
}

function nonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function positiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}
