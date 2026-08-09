/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityXmlAttribute } from './audacity-binary-xml.js';
import { secondsToSampleFrame } from './timeline-time.ts';

type AudacityXmlNode = Parameters<typeof audacityXmlAttribute>[0];
const readAttribute = audacityXmlAttribute as unknown as (
	node: AudacityXmlNode, name: string, fallback?: unknown
) => unknown;

export interface Aup4ClipTiming {
	readonly stretchRatio: number;
	readonly trimLeftSeconds: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly sourceDurationFrames: number;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

/** Translate Audacity clip offsets, trims, and tempo stretch into exact project frames. */
export function readAup4ClipTiming(
	clipNode: AudacityXmlNode,
	frameCount: number,
	trackRate: number,
	projectRate: number,
): Aup4ClipTiming {
	const storedStretchRatio = positive(readAttribute(clipNode, 'clipStretchRatio', 1), 1);
	const clipTempo = optionalPositive(readAttribute(clipNode, 'clipTempo', null));
	const rawAudioTempo = optionalPositive(readAttribute(clipNode, 'rawAudioTempo', null));
	const stretchRatio = storedStretchRatio * (
		clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1
	);
	const trimLeftSeconds = nonNegative(readAttribute(clipNode, 'trimLeft', 0));
	const trimRightSeconds = nonNegative(readAttribute(clipNode, 'trimRight', 0));
	const trimStartFrames = secondsToSampleFrame(trimLeftSeconds / stretchRatio, trackRate);
	const trimEndFrames = secondsToSampleFrame(trimRightSeconds / stretchRatio, trackRate);
	const sourceDurationFrames = Math.max(1, frameCount - trimStartFrames - trimEndFrames);
	const offsetSeconds = finite(readAttribute(clipNode, 'offset', 0), 0);
	return Object.freeze({
		stretchRatio,
		trimLeftSeconds,
		trimStartFrames,
		trimEndFrames,
		sourceDurationFrames,
		timelineStartFrame: Math.max(0, secondsToSampleFrame(offsetSeconds + trimLeftSeconds, projectRate)),
		durationFrames: Math.max(1, secondsToSampleFrame(
			(sourceDurationFrames / trackRate) * stretchRatio,
			projectRate,
		)),
	});
}

function finite(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function positive(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function optionalPositive(value: unknown): number | null {
	const number = Number(value);
	return value != null && value !== '' && Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegative(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : 0;
}
