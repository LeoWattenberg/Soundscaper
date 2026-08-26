/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer-side review shape for deterministic highlight timings and crop edits. */

import {
	validateAssistanceWorkflowFenceV1,
	type AssistanceWorkflowFenceV1,
} from '../common/editor/assistance/workflow.ts';

export interface FramescaperAssistanceHighlightCropKeyframeV1 {
	readonly sourceFrame: number;
	readonly authority: 'subject' | 'saliency' | 'center';
	readonly trackIds: readonly string[];
	readonly crop: Readonly<{ readonly left: number; readonly top: number;
		readonly right: number; readonly bottom: number }>;
}

export interface FramescaperAssistanceHighlightProposalV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly score: number;
	readonly evidenceMode: 'transcript' | 'speechless';
	readonly selected: false;
	readonly videoOccurrenceId: string;
	readonly audioOccurrenceId: string;
	readonly title: string;
	readonly cropKeyframes: readonly FramescaperAssistanceHighlightCropKeyframeV1[];
}

export interface FramescaperAssistanceHighlightReviewV1 {
	readonly kind: 'highlight-proposals';
	readonly schemaVersion: 1;
	readonly workflowId: 'make-highlights';
	readonly fence: AssistanceWorkflowFenceV1;
	readonly proposals: readonly FramescaperAssistanceHighlightProposalV1[];
}

const REVIEW_FIELDS = Object.freeze(['kind', 'schemaVersion', 'workflowId', 'fence', 'proposals']);
const PROPOSAL_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'score', 'evidenceMode', 'selected',
	'videoOccurrenceId', 'audioOccurrenceId', 'title', 'cropKeyframes',
]);
const KEYFRAME_FIELDS = Object.freeze(['sourceFrame', 'authority', 'trackIds', 'crop']);
const CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom']);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const INVALID_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MAXIMUM_PROPOSALS = 20;
const MAXIMUM_CROP_KEYFRAMES = 4_096;

/** Re-review the deterministic timings and edited crops; every selection starts false. */
export function reviewFramescaperAssistanceHighlightsV1(
	value: unknown,
): FramescaperAssistanceHighlightReviewV1 {
	const record = exactRecord(value, REVIEW_FIELDS, 'highlight publication review');
	if (record.kind !== 'highlight-proposals' || record.schemaVersion !== 1
		|| record.workflowId !== 'make-highlights') {
		throw new TypeError('The highlight publication review uses an unsupported schema or workflow.');
	}
	const fence = validateAssistanceWorkflowFenceV1(record.fence);
	const values = boundedArray(record.proposals, 0, MAXIMUM_PROPOSALS, 'highlight proposals');
	const seen = new Set<string>();
	const proposals = values.map((candidate, index) => reviewProposal(candidate, index, seen));
	return Object.freeze({
		kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
		fence, proposals: Object.freeze(proposals),
	});
}

function reviewProposal(
	value: unknown,
	index: number,
	seen: Set<string>,
): FramescaperAssistanceHighlightProposalV1 {
	const label = `highlight proposal ${String(index)}`;
	const record = exactRecord(value, PROPOSAL_FIELDS, label);
	const id = stableId(record.id, `${label} ID`);
	if (seen.has(id)) throw new TypeError('Reviewed highlight proposal IDs must be unique.');
	seen.add(id);
	const startFrame = frame(record.startFrame, `${label} start`);
	const endFrame = frame(record.endFrame, `${label} end`);
	if (endFrame <= startFrame) throw new RangeError(`${label} must have positive timing.`);
	if (record.selected !== false) {
		throw new TypeError('Reviewed highlight proposals must remain unselected until explicit acceptance.');
	}
	if (record.evidenceMode !== 'transcript' && record.evidenceMode !== 'speechless') {
		throw new TypeError(`${label} has an unsupported evidence mode.`);
	}
	const cropValues = boundedArray(
		record.cropKeyframes, 2, MAXIMUM_CROP_KEYFRAMES, `${label} crop keyframes`,
	);
	let priorFrame = -1;
	const cropKeyframes = cropValues.map((candidate, keyframeIndex) => {
		const keyframe = reviewCropKeyframe(candidate, label, keyframeIndex);
		if (keyframe.sourceFrame <= priorFrame) {
			throw new RangeError(`${label} crop keyframes must be strictly ordered.`);
		}
		priorFrame = keyframe.sourceFrame;
		return keyframe;
	});
	return Object.freeze({
		id, startFrame, endFrame,
		score: unit(record.score, `${label} score`),
		evidenceMode: record.evidenceMode,
		selected: false,
		videoOccurrenceId: stableId(record.videoOccurrenceId, `${label} video occurrence`),
		audioOccurrenceId: stableId(record.audioOccurrenceId, `${label} audio occurrence`),
		title: title(record.title, label),
		cropKeyframes: Object.freeze(cropKeyframes),
	});
}

function reviewCropKeyframe(
	value: unknown,
	proposalLabel: string,
	index: number,
): FramescaperAssistanceHighlightCropKeyframeV1 {
	const label = `${proposalLabel} crop keyframe ${String(index)}`;
	const record = exactRecord(value, KEYFRAME_FIELDS, label);
	if (record.authority !== 'subject' && record.authority !== 'saliency'
		&& record.authority !== 'center') throw new TypeError(`${label} has invalid authority.`);
	const trackIds = boundedArray(record.trackIds, 0, 256, `${label} track IDs`)
		.map((candidate) => stableId(candidate, `${label} track ID`));
	if (trackIds.some((candidate, trackIndex) => trackIndex > 0
		&& candidate <= trackIds[trackIndex - 1]!)) {
		throw new TypeError(`${label} track IDs must be sorted and unique.`);
	}
	if ((record.authority === 'subject') !== (trackIds.length > 0)) {
		throw new TypeError(`${label} subject authority must name its exact tracks.`);
	}
	const cropRecord = exactRecord(record.crop, CROP_FIELDS, `${label} crop`);
	const crop = Object.freeze({
		left: unit(cropRecord.left, `${label} crop left`),
		top: unit(cropRecord.top, `${label} crop top`),
		right: unit(cropRecord.right, `${label} crop right`),
		bottom: unit(cropRecord.bottom, `${label} crop bottom`),
	});
	if (crop.left + crop.right >= 1 || crop.top + crop.bottom >= 1) {
		throw new RangeError(`${label} must retain a positive aperture.`);
	}
	return Object.freeze({
		sourceFrame: frame(record.sourceFrame, `${label} source frame`),
		authority: record.authority,
		trackIds: Object.freeze(trackIds),
		crop,
	});
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`The ${name} must be a plain record.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${name} fields are invalid.`);
	}
	return value as Record<string, unknown>;
}

function boundedArray(value: unknown, minimum: number, maximum: number, name: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new RangeError(`The ${name} exceed their bounded inventory.`);
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${name} is invalid.`);
	return value;
}

function title(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160
		|| value !== value.trim() || INVALID_TEXT.test(value)) throw new TypeError(`The ${name} title is invalid.`);
	return value;
}

function frame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The ${name} is invalid.`);
	return Number(value);
}

function unit(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1
		|| Object.is(value, -0)) throw new RangeError(`The ${name} must be in the unit interval.`);
	return value;
}
