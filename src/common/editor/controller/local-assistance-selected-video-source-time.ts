/* SPDX-License-Identifier: AGPL-3.0-only */

/** Frozen selected-video source/timeline authority for deterministic materializers. */

import { sequenceFrameBoundarySample } from '../sequence-frame-navigation.ts';
import {
	createAssistanceSourceTimeRowChunksV1,
	reviewAssistanceSourceTimeRowsV1,
	type AssistanceSourceTimeRowsInventoryV1,
	type AssistanceSourceTimeRowV1,
	type ReviewedAssistanceSourceTimeRowsV1,
} from '../assistance/source-time-rows-v1.ts';
import {
	mapLocalAssistanceSelectedVideoSourceBoundary,
	readLocalAssistanceSelectedVideoSourceBoundaryTick,
	type LocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';
export type LocalAssistanceSelectedVideoSourceTimeFrameV1 = AssistanceSourceTimeRowV1;

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
	readonly frames: AssistanceSourceTimeRowsInventoryV1;
}

const LEGACY_ROW_MAXIMUM = 100_000;
const REVIEWED_ROWS = new WeakMap<object, ReviewedAssistanceSourceTimeRowsV1>();

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
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('Selected-video source-time authority has empty geometry.');
	}
	const sourceWidth = integer(authority.source.width, 1, 'source width');
	const sourceHeight = integer(authority.source.height, 1, 'source height');
	const sampleRate = integer(authority.project.sampleRate, 1, 'project sample rate');
	const rate = rational(authority.sequence.rate, 'sequence frame rate');
	const rows = canonicalRows(authority, sourceStartFrame, sourceEndFrame, rate, sampleRate);
	const rowInventory = sourceEndFrame - sourceStartFrame + 1 <= LEGACY_ROW_MAXIMUM
		? Object.freeze([...rows])
		: createAssistanceSourceTimeRowChunksV1(rows);
	const reviewed = reviewAssistanceSourceTimeRowsV1(rowInventory);
	const first = reviewed.first;
	const last = reviewed.last;
	if (first.sourceFrame !== sourceStartFrame || last.sourceFrame !== sourceEndFrame) {
		throw new RangeError('Selected-video source-time authority cannot bind both endpoints.');
	}
	const descriptor = Object.freeze({ schemaVersion: 1 as const,
		kind: 'selected-video-source-time-authority' as const,
		projectId: identifier(authority.project.id, 'project ID'),
		projectRevision: integer(authority.project.revision, 0, 'project revision'),
		sequenceId: identifier(authority.sequence.id, 'sequence ID'),
		videoOccurrenceId: identifier(authority.clip.id, 'video occurrence ID'),
		sourceId: identifier(authority.source.id, 'source ID'),
		sourceSha256: digest(authority.fence.sourceSha256, 'source digest'),
		timingAuthoritySha256: digest(authority.fence.timingAuthoritySha256,
			'timing-authority digest'), sourceWidth, sourceHeight, sourceStartFrame, sourceEndFrame,
		sampleRate, timescale: sourceTimescale(authority, sourceStartFrame),
		selectionStartFrame: first.timelineFrame,
		selectionEndFrame: last.timelineFrame, frames: rowInventory });
	REVIEWED_ROWS.set(descriptor, reviewed);
	return descriptor;
}

function* canonicalRows(
	authority: LocalAssistanceSelectedVideoAuthority,
	sourceStartFrame: number,
	sourceEndFrame: number,
	rate: Readonly<{ num: number; den: number }>,
	sampleRate: number,
): Generator<LocalAssistanceSelectedVideoSourceTimeFrameV1> {
	let timescale: number | null = null;
	let priorTimeline = -1;
	let pending: LocalAssistanceSelectedVideoSourceTimeFrameV1 | null = null;
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
			if (pending !== null && pending.sourceFrame !== sourceStartFrame) pending = row;
			continue;
		}
		if (pending !== null) yield pending;
		pending = row;
		priorTimeline = timelineFrame;
	}
	if (pending !== null) yield pending;
	if (timescale === null) {
		throw new RangeError('Selected-video source-time authority cannot bind both endpoints.');
	}
}

/** Strictly review either legacy rows or long compact row chunks. */
export function reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
	value: unknown,
): LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	if (value !== null && typeof value === 'object' && REVIEWED_ROWS.has(value)) {
		return value as LocalAssistanceSelectedVideoSourceTimeDescriptorV1;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The selected-video source-time descriptor must be one plain record.');
	}
	const row = value as Record<string, unknown>;
	const fields = ['schemaVersion', 'kind', 'projectId', 'projectRevision', 'sequenceId',
		'videoOccurrenceId', 'sourceId', 'sourceSha256', 'timingAuthoritySha256', 'sourceWidth',
		'sourceHeight', 'sourceStartFrame', 'sourceEndFrame', 'sampleRate', 'timescale',
		'selectionStartFrame', 'selectionEndFrame', 'frames'];
	if (Object.keys(row).length !== fields.length
		|| Object.keys(row).some((key) => !fields.includes(key))
		|| row.schemaVersion !== 1 || row.kind !== 'selected-video-source-time-authority') {
		throw new TypeError('The selected-video source-time descriptor fields are invalid.');
	}
	const sourceStartFrame = integer(row.sourceStartFrame, 0, 'source start frame');
	const sourceEndFrame = integer(row.sourceEndFrame, sourceStartFrame + 1, 'source end frame');
	const selectionStartFrame = integer(row.selectionStartFrame, 0, 'selection start frame');
	const selectionEndFrame = integer(row.selectionEndFrame, selectionStartFrame + 1,
		'selection end frame');
	const frames = reviewAssistanceSourceTimeRowsV1(row.frames);
	if (frames.first.sourceFrame !== sourceStartFrame || frames.last.sourceFrame !== sourceEndFrame
		|| frames.first.timelineFrame !== selectionStartFrame
		|| frames.last.timelineFrame !== selectionEndFrame) {
		throw new RangeError('The selected-video source-time rows do not bind exact endpoints.');
	}
	const descriptor = Object.freeze({ schemaVersion: 1 as const,
		kind: 'selected-video-source-time-authority' as const,
		projectId: identifier(row.projectId, 'project ID'),
		projectRevision: integer(row.projectRevision, 0, 'project revision'),
		sequenceId: identifier(row.sequenceId, 'sequence ID'),
		videoOccurrenceId: identifier(row.videoOccurrenceId, 'video occurrence ID'),
		sourceId: identifier(row.sourceId, 'source ID'),
		sourceSha256: digest(row.sourceSha256, 'source digest'),
		timingAuthoritySha256: digest(row.timingAuthoritySha256, 'timing-authority digest'),
		sourceWidth: integer(row.sourceWidth, 1, 'source width'),
		sourceHeight: integer(row.sourceHeight, 1, 'source height'), sourceStartFrame, sourceEndFrame,
		sampleRate: integer(row.sampleRate, 1, 'sample rate'),
		timescale: integer(row.timescale, 1, 'timescale'),
		selectionStartFrame, selectionEndFrame,
		frames: snapshotRows(row.frames, frames) });
	REVIEWED_ROWS.set(descriptor, frames);
	return descriptor;
}

function snapshotRows(
	value: unknown,
	rows: ReviewedAssistanceSourceTimeRowsV1,
): AssistanceSourceTimeRowsInventoryV1 {
	const candidates = value as readonly unknown[];
	if ((candidates[0] as Readonly<Record<string, unknown>> | undefined)?.kind
		=== 'source-time-rows') {
		return Object.freeze(candidates.map((candidate) => {
			const chunk = candidate as Readonly<Record<string, unknown>>;
			return Object.freeze({ schemaVersion: 1 as const, kind: 'source-time-rows' as const,
				rowCount: Number(chunk.rowCount), firstSourceFrame: Number(chunk.firstSourceFrame),
				lastSourceFrame: Number(chunk.lastSourceFrame), bodyBase64: String(chunk.bodyBase64) });
		}));
	}
	return Object.freeze(Array.from({ length: rows.rowCount }, (_, index) => rows.row(index)));
}

/** Resolve only an exactly admitted timeline boundary; never interpolate hidden timing. */
export function findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
	descriptorValue: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	timelineFrame: number,
): LocalAssistanceSelectedVideoSourceTimeFrameV1 | null {
	const descriptor = reviewedDescriptor(descriptorValue);
	const rows = REVIEWED_ROWS.get(descriptor)!;
	const ordinal = rows.firstAtOrAfterTimeline(timelineFrame);
	if (ordinal >= rows.rowCount) return null;
	const row = rows.row(ordinal);
	return row.timelineFrame === timelineFrame ? row : null;
}

/** Resolve only an exactly admitted source boundary, including the exclusive end. */
export function findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
	descriptorValue: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	sourceFrame: number,
): LocalAssistanceSelectedVideoSourceTimeFrameV1 | null {
	const descriptor = reviewedDescriptor(descriptorValue);
	const rows = REVIEWED_ROWS.get(descriptor)!;
	const ordinal = rows.firstAtOrAfterSource(sourceFrame);
	if (ordinal >= rows.rowCount) return null;
	const row = rows.row(ordinal);
	return row.sourceFrame === sourceFrame ? row : null;
}

/** Internal bounded random access for deterministic preparation and review. */
export function localAssistanceSelectedVideoSourceTimeRowsV1(
	descriptorValue: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
): ReviewedAssistanceSourceTimeRowsV1 {
	const descriptor = reviewedDescriptor(descriptorValue);
	return REVIEWED_ROWS.get(descriptor)!;
}

function reviewedDescriptor(
	value: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
): LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	return REVIEWED_ROWS.has(value) ? value
		: reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(value);
}

function sourceTimescale(
	authority: LocalAssistanceSelectedVideoAuthority,
	sourceStartFrame: number,
): number {
	const tick = readLocalAssistanceSelectedVideoSourceBoundaryTick(authority, sourceStartFrame);
	if (tick === null) throw new RangeError('Selected-video source-time authority lost its start tick.');
	return tick.timescale;
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
