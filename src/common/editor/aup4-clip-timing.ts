/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityXmlAttribute } from './audacity-binary-xml.js';
import { booleanValue } from './aup4-conversion-values.js';
import { secondsToSampleFrame } from './timeline-time.ts';

type AudacityXmlNode = Parameters<typeof audacityXmlAttribute>[0];
const readAttribute = audacityXmlAttribute as unknown as (
	node: AudacityXmlNode, name: string, fallback?: unknown
) => unknown;

export interface Aup4ClipStretch {
	readonly storedStretchRatio: number;
	readonly clipTempo: number | null;
	readonly rawAudioTempo: number | null;
	readonly stretchToTempo: boolean;
	readonly tempoStretchRatio: number;
	readonly stretchRatio: number;
}

export interface Aup4ClipTiming extends Aup4ClipStretch {
	readonly trimLeftSeconds: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly sourceDurationFrames: number;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

export interface Aup4ClipTempoStretchInput {
	readonly clipTempo?: unknown;
	readonly rawAudioTempo?: unknown;
	readonly projectTempo?: unknown;
	readonly stretchToTempo?: unknown;
}

/** Resolve the tempo-dependent part of Audacity's effective clip stretch. */
export function aup4ClipTempoStretchRatio(input: Aup4ClipTempoStretchInput): number {
	const clipTempo = optionalPositive(input.clipTempo);
	const rawAudioTempo = optionalPositive(input.rawAudioTempo);
	const projectTempo = optionalPositive(input.projectTempo);
	const stretchToTempo = booleanValue(input.stretchToTempo, true);
	const destinationTempo = clipTempo ?? (stretchToTempo ? projectTempo : null);
	return rawAudioTempo != null && destinationTempo != null
		? rawAudioTempo / destinationTempo
		: 1;
}

/** Read the serialized and effective Audacity stretch state shared by AUP3 and AUP4. */
export function readAup4ClipStretch(
	clipNode: AudacityXmlNode,
	projectTempo: number,
): Aup4ClipStretch {
	const storedStretchRatio = positive(readAttribute(clipNode, 'clipStretchRatio', 1), 1);
	const clipTempo = optionalPositive(readAttribute(clipNode, 'clipTempo', null));
	const rawAudioTempo = optionalPositive(readAttribute(clipNode, 'rawAudioTempo', null));
	const stretchToTempo = booleanValue(readAttribute(clipNode, 'clipStretchToMatchTempo', true), true);
	const tempoStretchRatio = aup4ClipTempoStretchRatio({
		clipTempo,
		rawAudioTempo,
		projectTempo,
		stretchToTempo,
	});
	return Object.freeze({
		storedStretchRatio,
		clipTempo,
		rawAudioTempo,
		stretchToTempo,
		tempoStretchRatio,
		stretchRatio: storedStretchRatio * tempoStretchRatio,
	});
}

/** Translate Audacity clip offsets, trims, and tempo stretch into exact project frames. */
export function readAup4ClipTiming(
	clipNode: AudacityXmlNode,
	frameCount: number,
	trackRate: number,
	projectRate: number,
	projectTempo: number,
): Aup4ClipTiming {
	const stretch = readAup4ClipStretch(clipNode, projectTempo);
	const trimLeftSeconds = nonNegative(readAttribute(clipNode, 'trimLeft', 0));
	const trimRightSeconds = nonNegative(readAttribute(clipNode, 'trimRight', 0));
	const trimStartFrames = secondsToSampleFrame(trimLeftSeconds / stretch.stretchRatio, trackRate);
	const trimEndFrames = secondsToSampleFrame(trimRightSeconds / stretch.stretchRatio, trackRate);
	const sourceDurationFrames = Math.max(1, frameCount - trimStartFrames - trimEndFrames);
	const offsetSeconds = finite(readAttribute(clipNode, 'offset', 0), 0);
	return Object.freeze({
		...stretch,
		trimLeftSeconds,
		trimStartFrames,
		trimEndFrames,
		sourceDurationFrames,
		timelineStartFrame: Math.max(0, secondsToSampleFrame(offsetSeconds + trimLeftSeconds, projectRate)),
		durationFrames: Math.max(1, secondsToSampleFrame(
			(sourceDurationFrames / trackRate) * stretch.stretchRatio,
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
