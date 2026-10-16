/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateClipTransitionGainAt } from './audio-clip-transition-gain.ts';
import type { SesxClip } from './sesx-import.ts';

export interface SesxImportedClip extends Record<string, unknown> {
	readonly id: string;
	sourceId: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
}

export interface SesxOverlapEntry {
	readonly clip: SesxImportedClip;
	readonly authored: SesxClip;
	readonly position: number;
}

/** Audition plays only the front clip in an overlap without a linked crossfade. */
export function convertSesxOverlapOrder(
	entries: readonly SesxOverlapEntry[], createStableId: (prefix: string) => string,
): Readonly<{ clips: readonly SesxImportedClip[]; convertedClipIds: readonly string[] }> {
	const clips: SesxImportedClip[] = [];
	const convertedClipIds: string[] = [];
	const fronts = overlappingFronts(entries);
	for (const entry of entries) {
		const original = entry.clip;
		let spans: readonly (readonly [number, number])[] = [[original.timelineStartFrame, original.timelineStartFrame + original.durationFrames]];
		for (const front of fronts.get(entry) ?? []) {
			const start = front.clip.timelineStartFrame;
			const end = start + front.clip.durationFrames;
			spans = spans.flatMap(([left, right]) => {
				if (start >= right || end <= left) return [[left, right] as const];
				return [...(left < start ? [[left, start] as const] : []), ...(end < right ? [[end, right] as const] : [])];
			});
		}
		if (spans.length === 1 && spans[0]![0] === original.timelineStartFrame && spans[0]![1] === original.timelineStartFrame + original.durationFrames) {
			clips.push(original);
			continue;
		}
		convertedClipIds.push(original.id);
		for (const [index, [start, end]] of spans.entries()) {
			const offset = start - original.timelineStartFrame;
			const duration = end - start;
			clips.push({
				...original, id: index === 0 ? original.id : createStableId('clip'),
				timelineStartFrame: start, sourceStartFrame: original.sourceStartFrame + offset,
				sourceDurationFrames: duration, durationFrames: duration,
				fadeInFrames: 0, fadeOutFrames: 0,
				...(original.fadeInFrames > 0 || original.fadeOutFrames > 0
					? { envelope: fragmentEnvelope(original, offset, duration) } : {}),
			});
		}
	}
	return { clips, convertedClipIds };
}

function overlappingFronts(entries: readonly SesxOverlapEntry[]) {
	const fronts = new Map<SesxOverlapEntry, SesxOverlapEntry[]>();
	const active = new Set<SesxOverlapEntry>();
	for (const entry of [...entries].sort((left, right) => left.clip.timelineStartFrame - right.clip.timelineStartFrame)) {
		for (const previous of active) {
			if (previous.clip.timelineStartFrame + previous.clip.durationFrames <= entry.clip.timelineStartFrame) {
				active.delete(previous);
				continue;
			}
			if (entry.authored.linkedCrossfade || previous.authored.linkedCrossfade) continue;
			const entryIsFront = entry.authored.zOrder > previous.authored.zOrder
				|| (entry.authored.zOrder === previous.authored.zOrder && entry.position > previous.position);
			const behind = entryIsFront ? previous : entry;
			const front = entryIsFront ? entry : previous;
			const blockers = fronts.get(behind) ?? [];
			blockers.push(front); fronts.set(behind, blockers);
		}
		active.add(entry);
	}
	return fronts;
}

function fragmentEnvelope(clip: SesxImportedClip, offset: number, duration: number) {
	const valueAt = (frame: number): number => evaluateClipTransitionGainAt(offset + frame, clip.durationFrames, {
		fadeInFrames: clip.fadeInFrames, fadeOutFrames: clip.fadeOutFrames,
		crossfadeInRanges: [], crossfadeOutRanges: [],
	});
	const frames = new Set([0, duration]);
	for (const boundary of [clip.fadeInFrames, clip.durationFrames - clip.fadeOutFrames]) {
		const frame = boundary - offset;
		if (frame > 0 && frame < duration) frames.add(frame);
	}
	const boundaries = [...frames].sort((left, right) => left - right);
	for (let index = 1; index < boundaries.length; index += 1) subdivide(boundaries[index - 1]!, boundaries[index]!);
	return [...frames].sort((left, right) => left - right).map((frame) => ({ frame, value: valueAt(frame) }));
	function subdivide(left: number, right: number): void {
		const middle = Math.floor((left + right) / 2);
		if (middle <= left || middle >= right || frames.size >= 4096) return;
		const linear = valueAt(left) + (valueAt(right) - valueAt(left)) * (middle - left) / (right - left);
		if (Math.abs(valueAt(middle) - linear) <= 0.00001) return;
		frames.add(middle); subdivide(left, middle); subdivide(middle, right);
	}
}
