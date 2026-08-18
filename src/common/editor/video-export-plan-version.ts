/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one place a video export plan version is written down.
 *
 * The version had been pinned independently in the planner, the FFmpeg runner's
 * accepted range, the direct-path contract, a budget fixture, that fixture's
 * security test, and the budgets narrative. Three of those drifted apart before
 * anyone noticed, so every site now derives from these constants and a bump
 * moves exactly one number.
 */

/**
 * What `createVideoExportPlan` stamps on every graph plan it builds.
 *
 * Version 8 states the delivery canvas's `fit`. Seven belongs to the keyframe
 * plan, and six is the same graph with no fit to state, so a build that only
 * reads six refuses an eight rather than rendering its cover delivery as the
 * contain it would have assumed.
 */
export const CANONICAL_VIDEO_EXPORT_PLAN_VERSION = 8;

/**
 * The detached keyframe plan. It shares the version numbering space with the
 * graph plans but is a different shape entirely — RGBA frames rather than an
 * FFmpeg input graph — so the graph runner must never accept it.
 */
export const VIDEO_KEYFRAME_EXPORT_PLAN_VERSION = 7;

/**
 * Every version the FFmpeg graph runner still reads: the canonical version and
 * its history, minus any number another plan kind has claimed.
 */
export const SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS: readonly number[] = Object.freeze(
	Array.from({ length: CANONICAL_VIDEO_EXPORT_PLAN_VERSION }, (_, index) => index + 1)
		.filter((version) => version !== VIDEO_KEYFRAME_EXPORT_PLAN_VERSION),
);

/** What the direct-to-destination path admits: the canonical graph plan or one exact keyframe plan. */
export const DIRECT_VIDEO_ADMITTED_PLAN_VERSIONS: readonly number[] = Object.freeze([
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
]);
