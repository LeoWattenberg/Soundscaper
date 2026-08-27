/* SPDX-License-Identifier: AGPL-3.0-only */

/** Re-admit a renderer-derived selected-video timing sidecar against aggregate custody. */

import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from
	'../src/common/editor/video-timing-asset-reference.ts';
import {
	reviewAssistanceSourceTimeRowsV1,
	type AssistanceSourceTimeRowsInventoryV1,
} from
	'../src/common/editor/assistance/source-time-rows-v1.ts';
import type { AssistanceVideoSourceTimeAuthorityV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';

const DESCRIPTOR_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'projectId', 'projectRevision', 'sequenceId',
	'videoOccurrenceId', 'sourceId', 'sourceSha256', 'timingAuthoritySha256',
	'sourceWidth', 'sourceHeight', 'sourceStartFrame', 'sourceEndFrame', 'sampleRate',
	'timescale', 'selectionStartFrame', 'selectionEndFrame', 'frames',
] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;

export function materializeAssistanceSelectedVideoAuthorityV1(options: Readonly<{
	readonly value: unknown;
	readonly request: AssistanceWorkflowV1;
	readonly videoClaim: Readonly<{ readonly role: string; readonly sha256: string }>;
}>): AssistanceVideoSourceTimeAuthorityV1 {
	const row = exactRecord(options.value, DESCRIPTOR_FIELDS, 'selected-video timing sidecar');
	if (row.schemaVersion !== 1 || row.kind !== 'selected-video-source-time-authority') {
		throw new TypeError('The selected-video timing sidecar identity is unsupported.');
	}
	const sourceId = identifier(row.sourceId, 'sidecar source ID');
	const ranges = options.request.fence.sourceRanges.filter((range) => range.mediaKind === 'video'
		&& range.sourceId === sourceId);
	if (ranges.length !== 1) throw new TypeError('The sidecar source is outside the aggregate fence.');
	const range = ranges[0]!;
	const occurrenceId = identifier(row.videoOccurrenceId, 'sidecar occurrence ID');
	const sourceStartFrame = integer(row.sourceStartFrame, 0, 0xffff_ffff,
		'sidecar source start');
	const sourceEndFrame = integer(row.sourceEndFrame, sourceStartFrame + 1, 0xffff_ffff,
		'sidecar source end');
	if (row.projectId !== options.request.fence.projectId
		|| row.projectRevision !== options.request.fence.revision
		|| row.sequenceId !== options.request.fence.sequenceId
		|| row.sourceSha256 !== range.sourceSha256
		|| row.timingAuthoritySha256 !== range.timingAuthoritySha256
		|| sourceStartFrame !== range.sourceStartFrame || sourceEndFrame !== range.sourceEndFrame
		|| !range.occurrenceIds.includes(occurrenceId)
		|| options.videoClaim.role !== 'video'
		|| options.videoClaim.sha256 !== range.sourceSha256) {
		throw new TypeError('The selected-video timing sidecar disagrees with aggregate source authority.');
	}
	const width = integer(row.sourceWidth, 1, 4_096, 'sidecar source width');
	const height = integer(row.sourceHeight, 1, 4_096, 'sidecar source height');
	integer(row.sampleRate, 8_000, 768_000, 'sidecar project sample rate');
	const timescale = integer(row.timescale, 1, 0x7fff_ffff, 'sidecar timescale');
	const selectionStartFrame = integer(row.selectionStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'sidecar selection start');
	const selectionEndFrame = integer(row.selectionEndFrame, selectionStartFrame + 1,
		Number.MAX_SAFE_INTEGER, 'sidecar selection end');
	const reviewedRows = reviewAssistanceSourceTimeRowsV1(row.frames);
	if (reviewedRows.rowCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES + 1) {
		throw new RangeError('The selected-video timing sidecar frame inventory is outside its bound.');
	}
	if (reviewedRows.first.sourceFrame !== sourceStartFrame
		|| reviewedRows.first.timelineFrame !== selectionStartFrame
		|| reviewedRows.last.sourceFrame !== sourceEndFrame
		|| reviewedRows.last.timelineFrame !== selectionEndFrame) {
		throw new RangeError('The selected-video timing sidecar does not bind both selected endpoints.');
	}
	const frames = retainedFrames(row.frames, reviewedRows);
	return Object.freeze({ schemaVersion: 1, kind: 'video-source-time-authority', sourceId,
		width, height, sourceStartFrame, sourceEndFrame, timescale,
		presentationEndTick: reviewedRows.last.presentationTick, frames });
}

function retainedFrames(
	value: unknown,
	rows: ReturnType<typeof reviewAssistanceSourceTimeRowsV1>,
): AssistanceSourceTimeRowsInventoryV1 {
	const activeCount = rows.rowCount - 1;
	const compact = Array.isArray(value) && value[0] && typeof value[0] === 'object'
		&& (value[0] as Record<string, unknown>).kind === 'source-time-rows';
	if (!compact || activeCount === 1) {
		return Object.freeze(Array.from({ length: activeCount }, (_, index) => rows.row(index)));
	}
	return rows.prefix(activeCount);
}

function exactRecord<const Key extends string>(
	value: unknown, fields: readonly Key[], label: string,
): Record<Key, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Key, unknown>;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
