/* SPDX-License-Identifier: AGPL-3.0-only */

import { keyframeAtOrBefore } from './ffmpeg-video-keyframe-index.ts';
import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';

/**
 * Planning for trim-media: which parts of each source the project still needs.
 *
 * This module decides what may be discarded, so its bias is entirely toward
 * keeping things. The slice's stop condition is explicit — stop if trim-media
 * cannot prove which bytes are unreferenced — and the plan is that proof.
 *
 * **Visibility is deliberately ignored here, which is the opposite of the rule
 * the interchange profiles follow.** An exported edit list describes the render,
 * so it honours hidden, mute, and solo. Trim-media does not describe the render;
 * it decides which bytes survive. A hidden track's clips still reference their
 * media, and hiding a track must never be a way to destroy the material behind
 * it. Every clip counts, whatever its track is doing.
 *
 * Handles are added on both sides so a trimmed source can still be re-edited a
 * little. They are declared per plan rather than assumed, and they never shrink
 * a range: a handle only ever widens what is kept.
 */

export interface TrimMediaRange {
	/** Inclusive start, in the source's own frame domain. */
	readonly startFrame: number;
	/** Exclusive end. */
	readonly endFrame: number;
}

export interface TrimMediaSourcePlan {
	readonly sourceId: string;
	readonly frameCount: number;
	/** Disjoint, ascending, merged. Everything outside these may be discarded. */
	readonly retained: readonly TrimMediaRange[];
	readonly retainedFrames: number;
	readonly discardedFrames: number;
	/** True when nothing may be discarded, so rewriting the source is pointless. */
	readonly wholeSourceRetained: boolean;
	readonly referenceCount: number;
}

export interface TrimMediaPlan {
	readonly handleFrames: number;
	readonly sources: readonly TrimMediaSourcePlan[];
	readonly discardedFrames: number;
	readonly report: DeliveryReport;
}

export interface TrimMediaPlanRequest {
	readonly project: Readonly<Record<string, unknown>>;
	/** Extra frames kept either side of every reference. Never negative. */
	readonly handleFrames?: number;
}

export function createTrimMediaPlan(request: TrimMediaPlanRequest): TrimMediaPlan {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('A trim-media plan requires a project.');
	const handleFrames = nonNegativeInteger(request?.handleFrames ?? 0, 'handleFrames');

	const draft = createDeliveryReport({
		format: 'trim-media', container: null, codec: null,
		sampleRate: null, channelCount: null, lossless: null,
	});

	const sources = new Map<string, { frameCount: number; ranges: TrimMediaRange[] }>();
	for (const source of asRecords(project.sources)) {
		const id = String(source.id ?? '');
		if (!id) continue;
		sources.set(id, { frameCount: nonNegativeInteger(source.frameCount ?? 0, 'source.frameCount'), ranges: [] });
	}

	// Every clip, from every track, visible or not. A hidden track's media is
	// still the project's media.
	for (const clip of asRecords(project.clips)) {
		const sourceId = String(clip.sourceId ?? '');
		const entry = sources.get(sourceId);
		if (!entry) {
			addDeliveryReportItem(draft, {
				code: 'trim.clip-source-missing',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'clip', id: String(clip.id ?? '') },
				data: { sourceId },
				message: 'The clip references a source the project does not contain, so nothing can be proven about it.',
			});
			continue;
		}
		const start = nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
		const duration = referencedDuration(clip);
		if (duration <= 0) continue;
		entry.ranges.push(Object.freeze({
			startFrame: Math.max(0, start - handleFrames),
			endFrame: Math.min(entry.frameCount, start + duration + handleFrames),
		}));
	}

	const plans: TrimMediaSourcePlan[] = [];
	let discardedTotal = 0;
	for (const [sourceId, entry] of sources) {
		const referenceCount = entry.ranges.length;
		const retained = mergeRanges(entry.ranges);
		const retainedFrames = retained.reduce((sum, range) => sum + (range.endFrame - range.startFrame), 0);
		const discardedFrames = Math.max(0, entry.frameCount - retainedFrames);
		discardedTotal += discardedFrames;

		if (referenceCount === 0) {
			// Unreferenced entirely. Reported rather than acted on: this module
			// plans, and deleting a whole source is a decision for a caller that
			// knows whether the user meant to keep it.
			addDeliveryReportItem(draft, {
				code: 'trim.source-unreferenced',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'source', id: sourceId },
				data: { frameCount: entry.frameCount },
				message: 'No clip references this source; the plan retains nothing from it.',
			});
		} else if (discardedFrames > 0) {
			addDeliveryReportItem(draft, {
				code: 'trim.source-trimmed',
				disposition: 'converted',
				severity: 'info',
				scope: { kind: 'source', id: sourceId },
				data: { retainedFrames, discardedFrames, ranges: retained.length, handleFrames },
				message: 'Only the referenced ranges, plus handles, are retained.',
			});
		} else {
			addDeliveryReportItem(draft, {
				code: 'trim.source-whole',
				disposition: 'preserved',
				severity: 'info',
				scope: { kind: 'source', id: sourceId },
				data: { frameCount: entry.frameCount },
				message: 'Every frame is referenced, so there is nothing to trim.',
			});
		}

		plans.push(Object.freeze({
			sourceId,
			frameCount: entry.frameCount,
			retained,
			retainedFrames,
			discardedFrames,
			wholeSourceRetained: discardedFrames === 0,
			referenceCount,
		}));
	}

	plans.sort((left, right) => (left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0));
	return Object.freeze({
		handleFrames,
		sources: Object.freeze(plans),
		discardedFrames: discardedTotal,
		report: sealDeliveryReport(draft),
	});
}

/**
 * Whether a source frame survives the plan.
 *
 * Exported so a caller — or a test — can ask the question directly rather than
 * re-deriving it from the ranges and getting the boundary wrong.
 */
export function trimMediaRetainsFrame(plan: TrimMediaSourcePlan, frame: number): boolean {
	return plan.retained.some((range) => frame >= range.startFrame && frame < range.endFrame);
}

export interface TrimMediaRetainedRun extends TrimMediaRange {
	/** Where this run begins in the trimmed source. */
	readonly trimmedStartFrame: number;
}

/**
 * Where each retained run lands once the discarded frames are gone.
 *
 * Proving which frames survive is only half of what a caller needs: every clip
 * that referenced them has to be told where they moved to, and a caller left to
 * work that out from the ranges would recompute this — differently — at each
 * call site. The runs are already disjoint and ascending, so a run's new start
 * is simply the total length of the runs before it.
 */
export function trimMediaRetainedRuns(plan: TrimMediaSourcePlan): readonly TrimMediaRetainedRun[] {
	let trimmedStartFrame = 0;
	return Object.freeze(plan.retained.map((range) => {
		const run = Object.freeze({ ...range, trimmedStartFrame });
		trimmedStartFrame += range.endFrame - range.startFrame;
		return run;
	}));
}

/**
 * The same runs, each beginning where a lossless cut can begin.
 *
 * A stream-copied run that starts on a predicted frame decodes to garbage until
 * the next keyframe, so the referenced frames would be present and unwatchable.
 * Widening each run back to the keyframe at or before its start fixes that, and
 * it can only ever retain more: this never moves a start forward, so every frame
 * the plan proved was referenced is still retained afterwards.
 *
 * Widening can make two runs meet or overlap, so they are merged again — leaving
 * them separate would write a cut between frames the file treats as one run.
 */
export function alignTrimMediaRunsToKeyframes(
	plan: TrimMediaSourcePlan,
	keyframes: readonly number[],
): readonly TrimMediaRange[] {
	if (!Array.isArray(keyframes) || keyframes.length === 0) {
		throw new TypeError('Aligning trim runs requires the source keyframe index.');
	}
	return mergeRanges(plan.retained.map((range) => Object.freeze({
		startFrame: keyframeAtOrBefore(keyframes, range.startFrame),
		endFrame: range.endFrame,
	})));
}

/**
 * One source frame's position in the trimmed source, or null when it is gone.
 *
 * A discarded frame answers null rather than a nearby frame: a caller that
 * silently slid a reference to the closest survivor would move an edit without
 * saying so, and the whole point of the plan is that nothing referenced is lost.
 */
export function trimMediaMapFrame(plan: TrimMediaSourcePlan, frame: number): number | null {
	for (const run of trimMediaRetainedRuns(plan)) {
		if (frame >= run.startFrame && frame < run.endFrame) {
			return run.trimmedStartFrame + (frame - run.startFrame);
		}
	}
	return null;
}

/**
 * Merge into disjoint ascending ranges.
 *
 * Ranges that touch are merged as well as ranges that overlap: two references
 * that abut exactly describe one continuous run, and leaving them separate
 * would invite a caller to write a boundary between frames the project treats
 * as contiguous.
 */
function mergeRanges(ranges: readonly TrimMediaRange[]): readonly TrimMediaRange[] {
	const sorted = [...ranges]
		.filter((range) => range.endFrame > range.startFrame)
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const merged: TrimMediaRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.startFrame <= last.endFrame) {
			if (range.endFrame > last.endFrame) {
				merged[merged.length - 1] = Object.freeze({ startFrame: last.startFrame, endFrame: range.endFrame });
			}
			continue;
		}
		merged.push(Object.freeze({ startFrame: range.startFrame, endFrame: range.endFrame }));
	}
	return Object.freeze(merged);
}

/**
 * How much of the source a clip reads.
 *
 * `sourceDurationFrames` is authoritative where present because a retimed clip
 * reads a different span of source than it occupies on the timeline. Falling
 * back to the timeline duration for a sped-up clip would under-retain, which is
 * the one error this module must not make.
 */
function referencedDuration(clip: Readonly<Record<string, unknown>>): number {
	const explicit = Number(clip.sourceDurationFrames);
	if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
	const duration = Number(clip.durationFrames);
	if (!Number.isSafeInteger(duration) || duration <= 0) return 0;
	const speed = Number(clip.speedRatio);
	if (Number.isFinite(speed) && speed > 0 && speed !== 1) return Math.ceil(duration * speed);
	return duration;
}

function asRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return (Array.isArray(value) ? value : [])
		.filter((entry): entry is Readonly<Record<string, unknown>> => Boolean(entry) && typeof entry === 'object');
}

function nonNegativeInteger(value: unknown, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return number;
}
