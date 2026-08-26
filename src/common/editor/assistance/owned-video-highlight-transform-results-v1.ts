/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independent strict result review for every owned Framescaper/highlight transform. */

import {
	ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
	ownedArray,
	ownedExactRecord,
	ownedInteger,
	ownedText,
} from './owned-transform-validation-v1.ts';
import {
	ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1,
	type AssistanceOwnedVideoHighlightTransformIdV1,
	type AssistanceOwnedVideoHighlightTransformResultV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	canonicalTick,
	ownedSha256,
	reviewOwnedFramePackPlanV1,
	reviewOwnedHighlightCandidatesV1,
	reviewOwnedHighlightProposalsV1,
	reviewOwnedHighlightSignalsV1,
	reviewOwnedTrackedSubjectsV1,
	stableId,
} from './owned-video-highlight-validation-v1.ts';
import { reviewAssistanceReframePathResultV1 } from './visual-semantic-results-v1.ts';
import {
	createAssistanceVisualSearchRowsV1,
	reviewAssistanceVisualSearchRecordsV1,
} from './visual-search-records-v1.ts';

const RESULT_FIELDS = Object.freeze(['schemaVersion', 'transformId', 'outputs'] as const);
const VIDEO_INDEX_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'sourceId', 'timescale', 'sampleAuthority', 'embedding',
	'records', 'rows',
] as const);
const EMBEDDING_FIELDS = Object.freeze([
	'schemaVersion', 'byteLength', 'sha256', 'rowCount', 'dimensions',
] as const);
const ROWS_FIELDS = Object.freeze(['visual', 'ocr'] as const);
const ROW_FIELDS = Object.freeze(['resultId', 'timelineFrame', 'label'] as const);
const REFRAME_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'authority', 'fallbackChain', 'path',
] as const);
const AUTHORITY_FIELDS = Object.freeze(['width', 'height', 'timescale', 'frames'] as const);
const AUTHORITY_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick'] as const);
const ID_SET = new Set<unknown>(ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1);

export function reviewAssistanceOwnedVideoHighlightTransformResultV1(
	value: unknown,
): AssistanceOwnedVideoHighlightTransformResultV1 {
	const row = ownedExactRecord(value, RESULT_FIELDS, 'owned video/highlight transform result');
	if (row.schemaVersion !== 1 || !ID_SET.has(row.transformId)) {
		throw new TypeError('The owned video/highlight result identity is unsupported.');
	}
	const transformId = row.transformId as AssistanceOwnedVideoHighlightTransformIdV1;
	const expectedOutput = outputName(transformId);
	const outputs = ownedExactRecord(row.outputs, [expectedOutput], `${transformId} outputs`);
	let reviewed: unknown;
	switch (transformId) {
		case 'sample-shot-frames': reviewed = reviewOwnedFramePackPlanV1(outputs[expectedOutput]); break;
		case 'publish-video-index': reviewed = reviewVideoIndex(outputs[expectedOutput]); break;
		case 'track-subjects': reviewed = reviewOwnedTrackedSubjectsV1(outputs[expectedOutput]); break;
		case 'plan-crops': reviewed = reviewReframePath(outputs[expectedOutput]); break;
		case 'gather-signals': reviewed = reviewOwnedHighlightSignalsV1(outputs[expectedOutput]); break;
		case 'rank-highlights': reviewed = reviewOwnedHighlightCandidatesV1(outputs[expectedOutput]); break;
		case 'assemble-highlights': reviewed = reviewOwnedHighlightProposalsV1(outputs[expectedOutput]); break;
	}
	return Object.freeze({ schemaVersion: 1, transformId,
		outputs: Object.freeze({ [expectedOutput]: reviewed }) }) as
		AssistanceOwnedVideoHighlightTransformResultV1;
}

function reviewVideoIndex(value: unknown) {
	const row = ownedExactRecord(value, VIDEO_INDEX_FIELDS, 'owned video index');
	if (row.schemaVersion !== 1 || row.kind !== 'video-index') {
		throw new TypeError('The owned video-index identity is unsupported.');
	}
	const records = reviewAssistanceVisualSearchRecordsV1(row.records,
		row.sampleAuthority as never);
	const sampleAuthority = Object.freeze(records.visual.map(({ resultId, shotId, anchor,
		sourceFrame, timelineFrame }) => Object.freeze({ resultId, shotId, anchor,
		sourceFrame, timelineFrame })));
	const embeddingRow = ownedExactRecord(row.embedding, EMBEDDING_FIELDS,
		'owned video-index embedding');
	if (embeddingRow.schemaVersion !== 1) {
		throw new TypeError('The owned video-index embedding schema is unsupported.');
	}
	const embedding = Object.freeze({ schemaVersion: 1 as const,
		byteLength: ownedInteger(embeddingRow.byteLength, 1, 512 * 1024 * 1024,
			'video-index embedding byte length'),
		sha256: ownedSha256(embeddingRow.sha256, 'video-index embedding digest'),
		rowCount: ownedInteger(embeddingRow.rowCount, 0, 1_000_000,
			'video-index embedding row count'),
		dimensions: ownedInteger(embeddingRow.dimensions, 1, 8_192,
			'video-index embedding dimensions') });
	if (embedding.rowCount !== sampleAuthority.length) {
		throw new RangeError('Video-index embedding rows disagree with sample authority.');
	}
	const expectedRows = createAssistanceVisualSearchRowsV1(records, sampleAuthority);
	const suppliedRows = reviewRows(row.rows);
	assertRows(suppliedRows.visual, expectedRows.visual, 'visual');
	assertRows(suppliedRows.ocr, expectedRows.ocr, 'OCR');
	return Object.freeze({ schemaVersion: 1, kind: 'video-index',
		sourceId: stableId(row.sourceId, 'video-index source ID'),
		timescale: ownedInteger(row.timescale, 1, 0x7fff_ffff, 'video-index timescale'),
		sampleAuthority, embedding, records, rows: expectedRows });
}

function reviewRows(value: unknown) {
	const row = ownedExactRecord(value, ROWS_FIELDS, 'owned video-index rows');
	return Object.freeze({ visual: reviewRowArray(row.visual, 'visual'),
		ocr: reviewRowArray(row.ocr, 'OCR') });
}

function reviewRowArray(value: unknown, label: string) {
	return Object.freeze(ownedArray(value, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		`${label} video-index rows`).map((candidate, index) => {
		const row = ownedExactRecord(candidate, ROW_FIELDS, `${label} video-index row ${String(index)}`);
		return Object.freeze({ resultId: stableId(row.resultId, `${label} row result ID`),
			timelineFrame: ownedInteger(row.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
				`${label} row timeline frame`),
			label: ownedText(row.label, 4_096, `${label} row label`) });
	}));
}

function assertRows(
	actual: readonly Readonly<{ resultId: string; timelineFrame: number; label: string }>[],
	expected: readonly Readonly<{ resultId: string; timelineFrame: number; label: string }>[],
	label: string,
): void {
	if (actual.length !== expected.length || actual.some((row, index) => {
		const item = expected[index];
		return !item || row.resultId !== item.resultId || row.timelineFrame !== item.timelineFrame
			|| row.label !== item.label;
	})) throw new RangeError(`Owned ${label} index rows disagree with reviewed records.`);
}

function reviewReframePath(value: unknown) {
	const row = ownedExactRecord(value, REFRAME_FIELDS, 'owned reframe path');
	if (row.schemaVersion !== 1 || row.kind !== 'reframe-path') {
		throw new TypeError('The owned reframe-path identity is unsupported.');
	}
	const authorityRow = ownedExactRecord(row.authority, AUTHORITY_FIELDS,
		'owned reframe authority');
	const width = ownedInteger(authorityRow.width, 1, 4_096, 'reframe authority width');
	const height = ownedInteger(authorityRow.height, 1, 4_096, 'reframe authority height');
	const timescale = ownedInteger(authorityRow.timescale, 1, 0x7fff_ffff,
		'reframe authority timescale');
	let priorSource = -1;
	let priorTick = -1n;
	const frames = ownedArray(authorityRow.frames, ASSISTANCE_OWNED_TRANSFORM_MAXIMUM_ITEMS,
		'reframe authority frames', 1).map((candidate, index) => {
		const frame = ownedExactRecord(candidate, AUTHORITY_FRAME_FIELDS,
			`reframe authority frame ${String(index)}`);
		const sourceFrame = ownedInteger(frame.sourceFrame, 0, 0xffff_ffff,
			'reframe authority source frame');
		const presentationTick = canonicalTick(frame.presentationTick,
			'reframe authority presentation tick');
		if (sourceFrame <= priorSource || BigInt(presentationTick) <= priorTick) {
			throw new RangeError('Reframe authority must remain strictly ordered.');
		}
		priorSource = sourceFrame;
		priorTick = BigInt(presentationTick);
		return Object.freeze({ sourceFrame, presentationTick });
	});
	const authority = Object.freeze({ width, height, timescale, frames: Object.freeze(frames) });
	const fallback = ownedArray(row.fallbackChain, 3, 'reframe fallback chain', 3);
	if (fallback[0] !== 'subject' || fallback[1] !== 'saliency' || fallback[2] !== 'center') {
		throw new TypeError('The reframe fallback chain is unsupported.');
	}
	return Object.freeze({ schemaVersion: 1, kind: 'reframe-path', authority,
		fallbackChain: Object.freeze(['subject', 'saliency', 'center'] as const),
		path: reviewAssistanceReframePathResultV1(row.path, authority) });
}

function outputName(transformId: AssistanceOwnedVideoHighlightTransformIdV1) {
	switch (transformId) {
		case 'sample-shot-frames': return 'frame-pack' as const;
		case 'publish-video-index': return 'video-index' as const;
		case 'track-subjects': return 'tracked-subjects' as const;
		case 'plan-crops': return 'reframe-path' as const;
		case 'gather-signals': return 'highlight-signals' as const;
		case 'rank-highlights': return 'highlight-candidates' as const;
		case 'assemble-highlights': return 'highlight-proposals' as const;
	}
}
