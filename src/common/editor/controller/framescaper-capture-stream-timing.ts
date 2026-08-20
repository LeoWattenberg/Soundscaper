/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureStreamMetrics } from '../framescaper-capture-domain.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import { roundRational } from '../timeline-time.ts';
import { createFramescaperCaptureExactPresentationRange } from './framescaper-capture-exact-presentation-range.ts';
import type { FramescaperCaptureAssetStream } from './framescaper-capture-publication-service.ts';

/** Resolve durable packet ranges into project-sample publication offsets. */
export function createFramescaperCaptureAssetStreams(
	manifestValue: FramescaperCaptureSessionManifestV1,
	metrics: readonly Readonly<CaptureStreamMetrics>[],
	projectSampleRateValue: number,
): readonly FramescaperCaptureAssetStream[] {
	const manifest = normalizeFramescaperCaptureSessionManifest(manifestValue);
	const projectSampleRate = positiveInteger(projectSampleRateValue, 'Capture project sample rate');
	const byId = new Map(metrics.map((value) => [value.streamId, value]));
	return Object.freeze(manifest.streams.map((stream) => {
		const first = stream.timing.firstPresentationMicroseconds;
		const end = stream.timing.lastPresentationEndMicroseconds;
		if (first === null || end === null) {
			throw new Error(`Capture stream ${stream.streamId} has no retained presentation range.`);
		}
		const startOffsetFrames = microsecondsToFrame(first, projectSampleRate);
		const presentationEndOffsetFrames = Math.max(
			startOffsetFrames + 1,
			microsecondsToFrame(end, projectSampleRate),
		);
		return Object.freeze({
			streamId: stream.streamId,
			role: stream.role,
			startOffsetFrames,
			presentationEndOffsetFrames,
			exactPresentationRange: createFramescaperCaptureExactPresentationRange(first, end),
			metrics: publicationMetrics(byId.get(stream.streamId)),
			terminationReason: null,
		});
	}));
}

function publicationMetrics(
	metric: Readonly<CaptureStreamMetrics> | undefined,
): FramescaperCaptureAssetStream['metrics'] {
	const observations = metric
		? [metric.droppedUnits, metric.maximumAbsoluteDriftUs, metric.currentDriftUs]
		: [];
	const confidence = observations.length === 0
		|| observations.some((value) => value.confidence === 'unavailable')
		? 'unavailable' as const
		: observations.some((value) => value.confidence === 'estimated')
			? 'estimated' as const
			: 'exact' as const;
	if (confidence === 'unavailable') {
		return Object.freeze({
			confidence,
			droppedUnits: null,
			maximumAbsoluteDriftMicroseconds: null,
			finalDriftMicroseconds: null,
		});
	}
	return Object.freeze({
		confidence,
		droppedUnits: metric?.droppedUnits.value ?? null,
		maximumAbsoluteDriftMicroseconds: metric?.maximumAbsoluteDriftUs.value ?? null,
		finalDriftMicroseconds: metric?.currentDriftUs.value ?? null,
	});
}

function microsecondsToFrame(microseconds: number, sampleRate: number): number {
	return roundRational(BigInt(microseconds) * BigInt(sampleRate), 1_000_000n, 'point');
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}
