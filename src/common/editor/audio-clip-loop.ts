/* SPDX-License-Identifier: AGPL-3.0-only */

const LOOP_EXTENSION = 'org.soundscaper.clip-loop/v1';

export interface ClipLoopCarrier {
	readonly opaqueExtensions?: unknown;
}

export interface ClipLoop {
	readonly periodFrames: number;
	readonly offsetFrames: number;
}

export interface LoopAudioClip extends ClipLoopCarrier {
	readonly kind?: string;
	readonly anchor?: unknown;
	readonly warpMap?: unknown;
	readonly avLinkId?: unknown;
	readonly sourceId?: unknown;
	readonly timelineStartFrame?: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly reversed?: boolean;
}

export interface ClipLoopChange {
	readonly periodFrames: number;
	readonly offsetFrames?: number;
	readonly durationFrames?: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function withoutClipLoop(opaqueExtensions: unknown): Record<string, unknown> {
	const output = { ...record(opaqueExtensions) };
	delete output[LOOP_EXTENSION];
	return output;
}

/** The extension travels through native projects and clipboard copies without changing their schema. */
export function readClipLoop(clip: object): ClipLoop | null {
	const value = record(record(record(clip).opaqueExtensions)[LOOP_EXTENSION]);
	const period = value.periodFrames;
	const offset = value.offsetFrames ?? 0;
	return typeof period === 'number' && Number.isSafeInteger(period) && period > 0
		&& typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset < period
		? { periodFrames: period, offsetFrames: offset } : null;
}

export function clipCanLoop(clip: Pick<LoopAudioClip, 'kind' | 'anchor' | 'warpMap' | 'avLinkId'>): boolean {
	return clip.kind === 'audio' && clip.anchor !== 'musical' && clip.warpMap == null && !clip.avLinkId;
}

function frame(value: unknown, minimum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid loop ${name}.`);
	return value;
}

export function clipLoopUpdateFields(clip: LoopAudioClip, change: unknown): {
	durationFrames: number; sourceStartFrame: number; sourceDurationFrames: number;
	opaqueExtensions: Record<string, unknown>; fadeInFrames?: number; fadeOutFrames?: number;
} {
	if (!clipCanLoop(clip)) throw new RangeError('Looping requires an unwarped sample-anchored audio clip without a video link.');
	const opaqueExtensions = { ...record(clip.opaqueExtensions) };
	const previous = readClipLoop(clip);
	let durationFrames = clip.durationFrames;
	let sourceStartFrame = clip.sourceStartFrame;
	let sourceDurationFrames = clip.sourceDurationFrames;
	if (change === false) {
		delete opaqueExtensions[LOOP_EXTENSION];
		if (previous) {
			durationFrames = Math.min(durationFrames, previous.periodFrames - previous.offsetFrames);
			const ratio = clip.sourceDurationFrames / previous.periodFrames;
			const offset = Math.round(previous.offsetFrames * ratio);
			sourceDurationFrames = Math.max(1, Math.min(clip.sourceDurationFrames - offset, Math.round(durationFrames * ratio)));
			sourceStartFrame += clip.reversed ? clip.sourceDurationFrames - offset - sourceDurationFrames : offset;
		}
	} else {
		if (change !== true && (change === null || typeof change !== 'object' || Array.isArray(change))) throw new TypeError('Invalid loop edit.');
		const values = change === true ? { periodFrames: previous?.periodFrames ?? durationFrames } : record(change);
		const periodFrames = frame(values.periodFrames ?? previous?.periodFrames, 1, 'period');
		const offsetFrames = frame(values.offsetFrames ?? previous?.offsetFrames ?? 0, 0, 'offset');
		if (offsetFrames >= periodFrames) throw new RangeError('Loop offset must be within its period.');
		durationFrames = frame(values.durationFrames ?? durationFrames, 1, 'duration');
		if (!Number.isSafeInteger((clip.timelineStartFrame ?? 0) + durationFrames)) throw new RangeError('Loop end exceeds the safe frame range.');
		sourceStartFrame = frame(values.sourceStartFrame ?? sourceStartFrame, 0, 'source start');
		sourceDurationFrames = frame(values.sourceDurationFrames ?? sourceDurationFrames, 1, 'source duration');
		opaqueExtensions[LOOP_EXTENSION] = { periodFrames, offsetFrames };
	}
	const fades = record(clip);
	return { durationFrames, sourceStartFrame, sourceDurationFrames, opaqueExtensions,
		...(typeof fades.fadeInFrames === 'number' ? { fadeInFrames: Math.min(fades.fadeInFrames, durationFrames) } : {}),
		...(typeof fades.fadeOutFrames === 'number' ? { fadeOutFrames: Math.min(fades.fadeOutFrames, durationFrames) } : {}),
	};
}

/** Trimming edits one repeat's media; the clip's anchor and total extent stay fixed. */
export function trimClipLoopPeriod(clip: LoopAudioClip, sourceFrameCount: number, edge: 'left' | 'right', deltaFrames: number): ClipLoopChange {
	const loop = readClipLoop(clip);
	if (!loop) throw new RangeError('The clip is not looping.');
	const ratio = clip.sourceDurationFrames / loop.periodFrames;
	const trimsSourceStart = (edge === 'left') !== Boolean(clip.reversed);
	const extension = trimsSourceStart ? clip.sourceStartFrame : sourceFrameCount - clip.sourceStartFrame - clip.sourceDurationFrames;
	const requested = edge === 'left' ? -deltaFrames : deltaFrames;
	const change = Math.max(1 - loop.periodFrames, Math.min(Math.floor(extension / ratio), Math.round(requested)));
	const periodFrames = loop.periodFrames + change;
	const sourceDurationFrames = Math.max(1, Math.min(clip.sourceDurationFrames + extension, Math.round(periodFrames * ratio)));
	return { periodFrames, offsetFrames: 0, sourceDurationFrames,
		sourceStartFrame: clip.sourceStartFrame + (trimsSourceStart ? clip.sourceDurationFrames - sourceDurationFrames : 0) };
}

/** Visible boundaries only; zoomed-out displays may coalesce subpixel repetitions. */
export function clipLoopBoundaries(clip: ClipLoopCarrier & { readonly timelineStartFrame: number; readonly durationFrames: number }, fromFrame: number, toFrame: number, minimumSpacing = 0): number[] {
	const loop = readClipLoop(clip);
	if (!loop) return [];
	const origin = clip.timelineStartFrame - loop.offsetFrames;
	const end = Math.min(toFrame, clip.timelineStartFrame + clip.durationFrames);
	const step = loop.periodFrames * Math.max(1, Math.ceil(minimumSpacing / loop.periodFrames));
	const first = origin + Math.max(1, Math.ceil((Math.max(fromFrame, clip.timelineStartFrame + 1) - origin) / step)) * step;
	const boundaries: number[] = [];
	for (let boundary = first; boundary < end; boundary += step) boundaries.push(boundary);
	return boundaries;
}

export function clipLoopSegmentFields(clip: LoopAudioClip, localStartFrame: number): Pick<ReturnType<typeof clipLoopUpdateFields>, 'sourceStartFrame' | 'sourceDurationFrames' | 'opaqueExtensions'> | null {
	const loop = readClipLoop(clip);
	return loop ? { sourceStartFrame: clip.sourceStartFrame, sourceDurationFrames: clip.sourceDurationFrames,
		opaqueExtensions: { ...record(clip.opaqueExtensions), [LOOP_EXTENSION]: { ...loop, offsetFrames: (loop.offsetFrames + localStartFrame) % loop.periodFrames } } } : null;
}

/** Stretch repeats with the clip; rendered replacements already contain the repetitions. */
export function clipLoopTransformFields(clip: LoopAudioClip, changes: Readonly<Record<string, unknown>>): { opaqueExtensions: Record<string, unknown> } | null {
	const loop = readClipLoop(clip);
	if (!loop) return null;
	const opaqueExtensions = { ...record(clip.opaqueExtensions) };
	if (changes.sourceId !== undefined && changes.sourceId !== record(clip).sourceId) delete opaqueExtensions[LOOP_EXTENSION];
	else if (typeof changes.durationFrames === 'number' && changes.durationFrames !== clip.durationFrames) {
		const factor = changes.durationFrames / clip.durationFrames;
		const periodFrames = Math.max(1, Math.round(loop.periodFrames * factor));
		opaqueExtensions[LOOP_EXTENSION] = { periodFrames, offsetFrames: Math.min(periodFrames - 1, Math.round(loop.offsetFrames * factor)) };
	} else return null;
	return { opaqueExtensions };
}
