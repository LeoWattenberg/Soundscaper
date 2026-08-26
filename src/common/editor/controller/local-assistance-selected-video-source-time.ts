/* SPDX-License-Identifier: AGPL-3.0-only */

/** Frozen selected-video source/timeline authority for deterministic materializers. */

import { sequenceFrameBoundarySample } from '../sequence-frame-navigation.ts';
import {
	mapLocalAssistanceSelectedVideoSourceBoundary,
	readLocalAssistanceSelectedVideoSourceBoundaryTick,
	type LocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';
import { LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES } from
	'./local-assistance-selected-video-timing.ts';

export interface LocalAssistanceSelectedVideoSourceTimeFrameV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	/** Absolute project timeline sample frame. */
	readonly timelineFrame: number;
}

export interface LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	readonly schemaVersion: 1;
	readonly kind: 'selected-video-source-time-authority';
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sequenceId: string;
	readonly videoOccurrenceId: string;
	readonly sourceId: string;
	readonly sourceSha256: string;
	readonly timingAuthoritySha256: string;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly sourceStartFrame: number;
	/** Exclusive selected source boundary. */
	readonly sourceEndFrame: number;
	readonly sampleRate: number;
	readonly timescale: number;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly frames: readonly LocalAssistanceSelectedVideoSourceTimeFrameV1[];
}

/**
 * Derive an immutable, pathless timing descriptor from authenticated selected-video custody.
 * Multiple source boundaries resolving to one retimed timeline sample are canonicalized to one
 * row; both selected endpoints are always retained.
 */
export function createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
	authority: LocalAssistanceSelectedVideoAuthority,
): LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	const sourceStartFrame = integer(authority?.sourceStartFrame, 0, 'source start frame');
	const sourceEndFrame = integer(authority?.sourceEndFrame, 1, 'source end frame');
	if (sourceEndFrame <= sourceStartFrame
		|| sourceEndFrame - sourceStartFrame + 1
			> LOCAL_ASSISTANCE_REFRAME_MAXIMUM_SAMPLED_FRAMES) {
		throw new RangeError('Selected-video source-time authority exceeds its exact row bound.');
	}
	const sourceWidth = integer(authority.source.width, 1, 'source width');
	const sourceHeight = integer(authority.source.height, 1, 'source height');
	const sampleRate = integer(authority.project.sampleRate, 1, 'project sample rate');
	const rate = rational(authority.sequence.rate, 'sequence frame rate');
	const frames: LocalAssistanceSelectedVideoSourceTimeFrameV1[] = [];
	let timescale: number | null = null;
	let priorTimeline = -1;
	for (let sourceFrame = sourceStartFrame; sourceFrame <= sourceEndFrame; sourceFrame += 1) {
		const tick = readLocalAssistanceSelectedVideoSourceBoundaryTick(authority, sourceFrame);
		const sequenceFrame = mapLocalAssistanceSelectedVideoSourceBoundary(authority, sourceFrame);
		if (tick === null || sequenceFrame === null) {
			throw new RangeError('Selected-video source-time authority has an unmapped boundary.');
		}
		timescale ??= tick.timescale;
		if (tick.timescale !== timescale) {
			throw new RangeError('Selected-video source-time authority changed timescale.');
		}
		const timelineFrame = sequenceFrameBoundarySample(sequenceFrame, rate, sampleRate);
		if (timelineFrame < priorTimeline) {
			throw new RangeError('Selected-video source-time authority is not monotonic.');
		}
		const row = Object.freeze({ sourceFrame, presentationTick: tick.presentationTick,
			timelineFrame });
		if (timelineFrame === priorTimeline) {
			// Preserve the selected start endpoint; otherwise the later boundary is the canonical
			// representative of a collapsed forward-retime sample.
			if (frames.length > 1) frames[frames.length - 1] = row;
			continue;
		}
		frames.push(row);
		priorTimeline = timelineFrame;
	}
	if (timescale === null || frames.length < 2
		|| frames[0]!.sourceFrame !== sourceStartFrame
		|| frames.at(-1)!.sourceFrame !== sourceEndFrame) {
		throw new RangeError('Selected-video source-time authority cannot bind both endpoints.');
	}
	return Object.freeze({ schemaVersion: 1, kind: 'selected-video-source-time-authority',
		projectId: identifier(authority.project.id, 'project ID'),
		projectRevision: integer(authority.project.revision, 0, 'project revision'),
		sequenceId: identifier(authority.sequence.id, 'sequence ID'),
		videoOccurrenceId: identifier(authority.clip.id, 'video occurrence ID'),
		sourceId: identifier(authority.source.id, 'source ID'),
		sourceSha256: digest(authority.fence.sourceSha256, 'source digest'),
		timingAuthoritySha256: digest(authority.fence.timingAuthoritySha256,
			'timing-authority digest'), sourceWidth, sourceHeight, sourceStartFrame, sourceEndFrame,
		sampleRate, timescale, selectionStartFrame: frames[0]!.timelineFrame,
		selectionEndFrame: frames.at(-1)!.timelineFrame, frames: Object.freeze(frames) });
}

function rational(value: unknown, label: string): Readonly<{ num: number; den: number }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The selected-video ${label} is invalid.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
	return Object.freeze({ num: integer(row.num, 1, `${label} numerator`),
		den: integer(row.den, 1, `${label} denominator`) });
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The selected-video ${label} is invalid.`);
	}
	return Number(value);
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The selected-video ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) {
		throw new TypeError(`The selected-video ${label} is invalid.`);
	}
	return value;
}
