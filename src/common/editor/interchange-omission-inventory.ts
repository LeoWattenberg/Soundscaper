/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addDeliveryReportItem,
	type createDeliveryReport,
} from './delivery-report.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type DeliveryReportDraft = ReturnType<typeof createDeliveryReport>;

export interface InterchangeTimeEffectOmission {
	/** Which authority states the time effect, for the report's data field. */
	readonly kind: 'speed' | 'audio-warp' | 'video-retime';
	readonly data: DataRecord;
}

/**
 * The time effect a clip carries, in whichever authority states it.
 *
 * The interchange profiles commit to no time-effect vocabulary, so a retimed
 * clip is written at its rendered duration and the change is named in the
 * report. That naming only ever asked about `speedRatio`, the pre-foundation
 * scalar: a clip warped by an audio warp map or retimed by a video retime curve
 * has `speedRatio === 1`, so its file claimed it consumes exactly as much source
 * as it occupies on the timeline, and the report said nothing had been left
 * behind. A silent wrong number is worse than a stated omission.
 */
export function interchangeClipTimeEffect(clip: DataRecord): InterchangeTimeEffectOmission | null {
	const speed = clip.speedRatio == null ? 1 : Number(clip.speedRatio);
	if (speed !== 1) return { kind: 'speed', data: Object.freeze({ speedRatio: speed }) };
	if (breakpointCount(clip.warpMap) > 0) {
		return { kind: 'audio-warp', data: Object.freeze({ warpPoints: breakpointCount(clip.warpMap) }) };
	}
	if (breakpointCount(clip.retimeMap) > 0) {
		return { kind: 'video-retime', data: Object.freeze({ retimePoints: breakpointCount(clip.retimeMap) }) };
	}
	return null;
}

export interface InterchangeAnnotationOmission {
	readonly annotations: number;
	readonly labelTracks: readonly string[];
	readonly labels: number;
}

export interface InterchangeCaptionTrackOmission {
	readonly captionTracks: readonly string[];
	readonly captions: number;
}

/**
 * The timeline annotations and label tracks a profile is about to drop.
 *
 * None of the three profiles carries a marker, a region, or a label track, and
 * the report they publish is the one surface that tells an operator what the
 * delivery could not carry. It listed neither: a project full of markers
 * exported with a report of preserved and converted items only, which reads as
 * "nothing was lost". A label track was missed twice over, because the
 * track-kind guard asks about `clipIds` and a label track keeps its content in
 * `labels`.
 */
export function interchangeAnnotationOmission(project: DataRecord): InterchangeAnnotationOmission | null {
	const annotations = Array.isArray(project.timelineAnnotations)
		? project.timelineAnnotations.length
		: 0;
	const labelTracks = (Array.isArray(project.tracks) ? project.tracks as readonly DataRecord[] : [])
		.filter((track) => track?.type === 'label' && labelCount(track) > 0);
	const labels = labelTracks.reduce((total, track) => total + labelCount(track), 0);
	if (annotations === 0 && labelTracks.length === 0) return null;
	return Object.freeze({
		annotations,
		labelTracks: Object.freeze(labelTracks.map((track) => String(track.id))),
		labels,
	});
}

function labelCount(track: DataRecord): number {
	return Array.isArray(track.labels) ? track.labels.length : 0;
}

function captionCount(track: DataRecord): number {
	return Array.isArray(track.cues) ? track.cues.length : 0;
}

/** The explicit styled-caption tracks every current interchange profile omits. */
export function interchangeCaptionTrackOmission(
	project: DataRecord,
	sequenceId?: string | null,
): InterchangeCaptionTrackOmission | null {
	const selectedSequenceId = sequenceId
		?? (typeof project.primarySequenceId === 'string' ? project.primarySequenceId : null);
	const captionTracks = (Array.isArray(project.videoCaptionTracks)
		? project.videoCaptionTracks as readonly DataRecord[] : [])
		.filter((track) => selectedSequenceId === null || track.sequenceId === selectedSequenceId);
	if (captionTracks.length === 0) return null;
	return Object.freeze({
		captionTracks: Object.freeze(captionTracks.map((track) => String(track.id))),
		captions: captionTracks.reduce((total, track) => total + captionCount(track), 0),
	});
}

function breakpointCount(value: unknown): number {
	if (!value || typeof value !== 'object') return 0;
	const points = (value as DataRecord).points;
	return Array.isArray(points) ? points.length : 0;
}

/**
 * Name the markers, regions, and label tracks the profile is leaving behind.
 *
 * The report is the one surface that tells an operator what a delivery could not
 * carry, and none of the three profiles carries any of these. Saying nothing
 * about them reads as "nothing was lost".
 */
export function reportInterchangeAnnotationOmission(
	draft: DeliveryReportDraft,
	project: Readonly<Record<string, unknown>>,
	profile: 'otio' | 'fcpxml' | 'edl' | 'dawproject',
): void {
	const omission = interchangeAnnotationOmission(project);
	if (!omission) return;
	addDeliveryReportItem(draft, {
		code: `${profile}.annotations-omitted`,
		disposition: 'omitted',
		severity: 'warning',
		scope: { kind: 'project', id: String(project.id ?? '') },
		data: {
			annotations: omission.annotations,
			labelTracks: omission.labelTracks.length,
			labels: omission.labels,
		},
		message: 'The profile carries no markers, regions, or label tracks; they stay in the project.',
	});
}

/** Name explicit caption tracks separately from labels: they are a distinct timed-text model. */
export function reportInterchangeCaptionTrackOmission(
	draft: DeliveryReportDraft,
	project: Readonly<Record<string, unknown>>,
	profile: 'otio' | 'fcpxml' | 'edl' | 'dawproject',
	sequenceId?: string | null,
): void {
	const omission = interchangeCaptionTrackOmission(project, sequenceId);
	if (!omission) return;
	addDeliveryReportItem(draft, {
		code: `${profile}.caption-tracks-omitted`,
		disposition: 'omitted',
		severity: 'warning',
		scope: { kind: 'project', id: String(project.id ?? '') },
		data: {
			captionTracks: omission.captionTracks.length,
			captions: omission.captions,
		},
		message: 'The profile carries no explicit styled-caption tracks; they stay in the project.',
	});
}
