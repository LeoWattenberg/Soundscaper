/* SPDX-License-Identifier: AGPL-3.0-only */

import { registeredVideoTimingIndex } from '../common/editor/video-source-time.ts';
import type { VideoRetimeCurveRational, VideoRetimeCurveSegment } from '../common/editor/video-retime-curve.ts';
import type { FramescaperVideoRetimeSnapshotRetime } from './editor-project-retime-retime-state.ts';

type DataRecord = Record<string, unknown>;
interface Fraction { readonly num: bigint; readonly den: bigint }
interface Anchor { readonly index: number; readonly outerFrame: number; readonly sourceFrame: VideoRetimeCurveRational }

/** Replacing media preserves surviving authored curves on the replacement's source and occurrence grids. */
export function conformFramescaperVideoRetimeReplacementSnapshots(
	before: DataRecord, commanded: DataRecord, command: DataRecord,
	snapshots: readonly FramescaperVideoRetimeSnapshotRetime[],
): readonly FramescaperVideoRetimeSnapshotRetime[] {
	const replacedSources = replacementSources(command);
	if (!replacedSources.size || !snapshots.length) return snapshots;
	const oldClips = clipMap(before);
	const newClips = clipMap(commanded);
	const oldSources = sourceMap(before);
	const newSources = sourceMap(commanded);
	return snapshots.map(snapshot => {
		const oldClip = oldClips.get(snapshot.id);
		const newClip = newClips.get(snapshot.id);
		if (!oldClip || !newClip || !replacedSources.has(String(oldClip.sourceId))) return snapshot;
		const oldSource = oldSources.get(String(oldClip.sourceId));
		const newSource = newSources.get(String(newClip.sourceId));
		if (!oldSource || !newSource) throw new ReferenceError('Retimed replacement is missing its source frame grid.');
		const oldExtent = integer(oldClip.sequenceFrameCount);
		const newExtent = integer(newClip.sequenceFrameCount);
		const start = integer(newClip.sourceInFrame);
		const end = start + integer(newClip.sourceFrameCount);
		const anchors: Anchor[] = [];
		for (const [index, point] of snapshot.retimeMap.points.entries()) {
			const outerFrame = nearest(BigInt(point.outerFrame) * BigInt(newExtent), BigInt(oldExtent));
			const sourceFrame = publicFraction(clamp(sourceFrameAtTime(newSource, sourceTime(oldSource, fraction(point.sourceFrame))), start, end));
			const previous = anchors.at(-1);
			// The new grid can merge sub-frame authored boundaries. Preserve the
			// opening picture and the final endpoint, with one anchor per cell.
			if (previous?.outerFrame === outerFrame) {
				if (outerFrame > 0) anchors[anchors.length - 1] = { index, outerFrame, sourceFrame };
			} else anchors.push({ index, outerFrame, sourceFrame });
		}
		const segments = anchors.slice(0, -1).map((left, index): VideoRetimeCurveSegment => {
			const right = anchors[index + 1]!;
			const delta = subtract(fraction(right.sourceFrame), fraction(left.sourceFrame));
			if (delta.num === 0n) return { mode: 'freeze' };
			const original = snapshot.retimeMap.segments[left.index]!;
			if (right.index === left.index + 1 && (original.mode === 'ramp-forward' || original.mode === 'ramp-reverse')) {
				const oldDelta = subtract(fraction(snapshot.retimeMap.points[right.index]!.sourceFrame), fraction(snapshot.retimeMap.points[left.index]!.sourceFrame));
				const oldSpan = snapshot.retimeMap.points[right.index]!.outerFrame - snapshot.retimeMap.points[left.index]!.outerFrame;
				const scale = divide(multiply(delta, { num: BigInt(oldSpan), den: BigInt(right.outerFrame - left.outerFrame) }), oldDelta);
				return { mode: original.mode,
					startVelocity: publicFraction(multiply(fraction(original.startVelocity), scale)),
					endVelocity: publicFraction(multiply(fraction(original.endVelocity), scale)) };
			}
			return { mode: delta.num > 0n ? 'constant-forward' : 'constant-reverse' };
		});
		return { id: snapshot.id, retimeMap: { ...snapshot.retimeMap,
			points: anchors.map(({ outerFrame, sourceFrame }) => ({ outerFrame, sourceFrame })), segments } };
	});
}

function replacementSources(command: DataRecord): ReadonlySet<string> {
	const result = new Set<string>();
	const visit = (candidate: DataRecord): void => {
		if (candidate.type === 'project-bin/replace-media') {
			for (const replacement of candidate.replacements as DataRecord[]) result.add(String(replacement.oldSourceId));
		} else if (candidate.type === 'batch') for (const child of candidate.commands as DataRecord[]) visit(child);
	};
	visit(command);
	return result;
}

function clipMap(project: DataRecord): ReadonlyMap<string, DataRecord> {
	const bin = project.projectBin as DataRecord;
	return new Map([...(project.clips as DataRecord[]), ...(bin.clips as DataRecord[])].map(clip => [String(clip.id), clip]));
}

function sourceMap(project: DataRecord): ReadonlyMap<string, DataRecord> {
	return new Map((project.sources as DataRecord[]).map(source => [String(source.id), source]));
}

function sourceTime(source: DataRecord, ordinal: Fraction): Fraction {
	const index = registeredVideoTimingIndex(source);
	if (!index) {
		const rate = source.frameRate as VideoRetimeCurveRational;
		return multiply(ordinal, { num: BigInt(rate.den), den: BigInt(rate.num) });
	}
	const whole = Number(ordinal.num / ordinal.den);
	if (whole >= index.frameCount) return { num: index.endTicks, den: BigInt(index.timescale) };
	const from = index.presentationTicks[whole]!;
	const to = whole + 1 === index.frameCount ? index.endTicks : index.presentationTicks[whole + 1]!;
	return { num: from * ordinal.den + (ordinal.num - BigInt(whole) * ordinal.den) * (to - from),
		den: ordinal.den * BigInt(index.timescale) };
}

function sourceFrameAtTime(source: DataRecord, time: Fraction): Fraction {
	const index = registeredVideoTimingIndex(source);
	if (!index) {
		const rate = source.frameRate as VideoRetimeCurveRational;
		return multiply(time, { num: BigInt(rate.num), den: BigInt(rate.den) });
	}
	const ticks = time.num * BigInt(index.timescale);
	if (ticks >= index.endTicks * time.den) return { num: BigInt(index.frameCount), den: 1n };
	let low = 0;
	let high = index.frameCount;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if (index.presentationTicks[middle]! * time.den <= ticks) low = middle;
		else high = middle;
	}
	const from = index.presentationTicks[low]!;
	const to = high === index.frameCount ? index.endTicks : index.presentationTicks[high]!;
	const den = time.den * (to - from);
	return { num: BigInt(low) * den + ticks - from * time.den, den };
}

function fraction(value: VideoRetimeCurveRational): Fraction { return { num: BigInt(value.num), den: BigInt(value.den) }; }
function multiply(left: Fraction, right: Fraction): Fraction { return { num: left.num * right.num, den: left.den * right.den }; }
function divide(left: Fraction, right: Fraction): Fraction { return { num: left.num * right.den, den: left.den * right.num }; }
function subtract(left: Fraction, right: Fraction): Fraction { return { num: left.num * right.den - right.num * left.den, den: left.den * right.den }; }
function clamp(value: Fraction, start: number, end: number): Fraction {
	return value.num < BigInt(start) * value.den ? { num: BigInt(start), den: 1n }
		: value.num > BigInt(end) * value.den ? { num: BigInt(end), den: 1n } : value;
}
function nearest(num: bigint, den: bigint): number { return Number((2n * num + den) / (2n * den)); }
function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('Replacement curve binding requires non-negative whole frames.');
	return value;
}
function publicFraction(value: Fraction): VideoRetimeCurveRational {
	let num = value.num;
	let den = value.den;
	if (den < 0n) { num = -num; den = -den; }
	let a = num < 0n ? -num : num;
	let b = den;
	while (b !== 0n) [a, b] = [b, a % b];
	num /= a; den /= a;
	if (num < 0n || num > BigInt(Number.MAX_SAFE_INTEGER) || den > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Conformed replacement curve exceeds its exact rational domain.');
	return { num: Number(num), den: Number(den) };
}
