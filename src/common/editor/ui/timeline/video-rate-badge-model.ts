/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	frameTrimRecord,
	nonEmptyString,
	nonNegativeSafeInteger,
	positiveSafeInteger,
} from '../../frame-canonical-edge-trim-domain.ts';
import {
	sourceTimeDifference,
	videoBoundaryTime,
	videoSourceTimingView,
} from '../../video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../../video-source-timing-views.ts';

export interface VideoRateBadgeInput {
	readonly clip: unknown;
	readonly source: unknown;
	readonly projectSampleRate: unknown;
}

export interface VideoRateBadgeModel {
	readonly playbackRate: number;
	readonly label: string;
}

/** Derive badge text only from persisted source/program geometry and verified timing. */
export function createVideoRateBadgeModel(
	input: VideoRateBadgeInput,
): Readonly<VideoRateBadgeModel> | null {
	try {
		const clip = frameTrimRecord(input.clip, 'video rate badge clip');
		const source = frameTrimRecord(input.source, 'video rate badge source');
		if (clip.kind !== 'video' || source.kind !== 'video') return null;
		const sourceId = nonEmptyString(source.id, 'video rate badge source.id');
		if (nonEmptyString(clip.sourceId, 'video rate badge clip.sourceId') !== sourceId) return null;
		const sampleRate = positiveSafeInteger(input.projectSampleRate, 'project sampleRate');
		const programDuration = positiveSafeInteger(clip.durationFrames, 'video program duration');
		const sourceStart = nonNegativeSafeInteger(clip.sourceStartFrame, 'video source start');
		const sourceDuration = positiveSafeInteger(clip.sourceDurationFrames, 'video source duration');
		const sourceEnd = sourceStart + sourceDuration;
		if (!Number.isSafeInteger(sourceEnd)) return null;

		const timingViews = resolveVideoSourceTimingViews(Object.freeze({
			sources: Object.freeze([source]),
		}));
		const view = videoSourceTimingView(timingViews, source);
		const sourceSpan = sourceTimeDifference(
			videoBoundaryTime(view, sourceEnd),
			videoBoundaryTime(view, sourceStart),
		);
		const numerator = sourceSpan.numerator * BigInt(sampleRate);
		const denominator = sourceSpan.denominator * BigInt(programDuration);
		if (numerator <= 0n || denominator <= 0n || numerator === denominator) return null;
		const playbackRate = Number(numerator) / Number(denominator);
		if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null;
		return Object.freeze({
			playbackRate,
			label: `${playbackRate.toFixed(2)}×`,
		});
	} catch {
		return null;
	}
}
