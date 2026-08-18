/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The cues a video delivery carries, taken from a label track.
 *
 * Milestone 4 owns a styled caption schema and has not delivered one, so what
 * exists to caption a delivery with is label tracks: a start, an end, and a
 * line of text. This module is the single place that turns one of those tracks
 * into cues scoped to an export range, so the muxed track and the sidecar file
 * are the same cues rather than two readings of the same labels.
 *
 * When milestone 4 does own a caption schema, the change lands here: the cue
 * shape grows, and both deliveries grow with it together.
 */

export const VIDEO_CAPTION_SIDECAR_FORMATS = Object.freeze(['srt', 'vtt'] as const);

export type VideoCaptionSidecarFormat = typeof VIDEO_CAPTION_SIDECAR_FORMATS[number];

export function isVideoCaptionSidecarFormat(value: unknown): value is VideoCaptionSidecarFormat {
	return typeof value === 'string' && (VIDEO_CAPTION_SIDECAR_FORMATS as readonly string[]).includes(value);
}

export interface VideoCaptionCue {
	/** Sample frames from the start of the delivered range, never from the project. */
	readonly startFrame: number;
	readonly endFrame: number;
	readonly title: string;
}

interface CaptionRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * The cues a label track contributes to one delivered range.
 *
 * Cues are clipped to the range and rebased onto it, because the delivery
 * starts at zero however far into the project its range began. A label that
 * only overlaps the range partially is kept and clipped rather than dropped:
 * a caption half inside the cut is still spoken inside it.
 *
 * A zero-length label becomes a zero-length cue rather than an error. The
 * label model allows one, so refusing it here would make a legal project
 * undeliverable.
 */
export function resolveVideoCaptionCues(
	project: unknown,
	options: Readonly<{ trackId: unknown } & CaptionRange>,
): readonly VideoCaptionCue[] {
	const track = captionTrack(project, options.trackId);
	const { startFrame, endFrame } = options;
	if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame < startFrame) {
		throw new RangeError('A caption range must be an ordered pair of sample frames.');
	}
	const cues: VideoCaptionCue[] = [];
	for (const label of (track.labels as readonly Record<string, unknown>[] | undefined) ?? []) {
		const labelStart = frame(label.startFrame, 'label.startFrame');
		const labelEnd = frame(label.endFrame ?? label.startFrame, 'label.endFrame');
		if (labelEnd < labelStart) throw new RangeError('A caption label cannot end before it starts.');
		if (labelEnd < startFrame || labelStart > endFrame) continue;
		cues.push(Object.freeze({
			startFrame: Math.max(labelStart, startFrame) - startFrame,
			endFrame: Math.min(labelEnd, endFrame) - startFrame,
			title: String(label.title ?? ''),
		}));
	}
	cues.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	return Object.freeze(cues);
}

/** The label track a delivery names, refusing anything that is not one. */
export function captionTrack(project: unknown, trackId: unknown): Readonly<Record<string, unknown>> {
	if (typeof trackId !== 'string' || !trackId) {
		throw new TypeError('captions.trackId must name a label track.');
	}
	const tracks = isRecord(project) && Array.isArray(project.tracks) ? project.tracks : [];
	const track = tracks.find((candidate) => isRecord(candidate) && candidate.id === trackId);
	if (!isRecord(track)) throw new ReferenceError(`No track ${trackId} to take captions from.`);
	if (track.type !== 'label') throw new TypeError(`Track ${trackId} is not a label track.`);
	return track;
}

function frame(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
