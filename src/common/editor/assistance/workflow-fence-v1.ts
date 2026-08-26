/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact source, timing, and project authority for one aggregate assistance workflow. */

export const ASSISTANCE_WORKFLOW_FENCE_VERSION = 1;

export interface AssistanceWorkflowSourceRangeV1 {
	readonly slotId: string;
	readonly mediaKind: 'audio' | 'video';
	readonly sourceId: string;
	readonly sourceSha256: string;
	readonly occurrenceIds: readonly string[];
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly linkMembershipSha256: string;
	readonly timingAuthoritySha256: string;
	readonly retimeKind: 'identity' | 'monotonic-forward';
}

export interface AssistanceWorkflowFenceV1 {
	readonly fenceVersion: typeof ASSISTANCE_WORKFLOW_FENCE_VERSION;
	readonly projectId: string;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly sequenceId: string;
	readonly sourceRanges: readonly AssistanceWorkflowSourceRangeV1[];
	readonly transcriptBodySha256: string | null;
	readonly recipeSha256: string;
	readonly settingsSha256: string;
	readonly modelBindingsSha256: string;
}

const FENCE_KEYS = Object.freeze([
	'fenceVersion', 'projectId', 'schemaVersion', 'revision', 'sequenceId', 'sourceRanges',
	'transcriptBodySha256', 'recipeSha256', 'settingsSha256', 'modelBindingsSha256',
]);
const RANGE_KEYS = Object.freeze([
	'slotId', 'mediaKind', 'sourceId', 'sourceSha256', 'occurrenceIds', 'sourceStartFrame',
	'sourceEndFrame', 'linkMembershipSha256', 'timingAuthoritySha256', 'retimeKind',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const DOMAIN_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SLOT_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MAXIMUM_SOURCE_RANGES = 64;
const MAXIMUM_OCCURRENCES = 1024;

/** Normalize the exact aggregate authority revalidated before publication. */
export function validateAssistanceWorkflowFenceV1(value: unknown): AssistanceWorkflowFenceV1 {
	const record = exactRecord(value, FENCE_KEYS, 'assistance workflow fence');
	if (record.fenceVersion !== ASSISTANCE_WORKFLOW_FENCE_VERSION) {
		throw new TypeError('The assistance workflow fence uses an unsupported version.');
	}
	const candidates = boundedArray(record.sourceRanges, 1, MAXIMUM_SOURCE_RANGES, 'source ranges');
	const occurrenceIds = new Set<string>();
	const sourceRanges = candidates.map((candidate) => validateSourceRange(candidate, occurrenceIds));
	for (let index = 1; index < sourceRanges.length; index += 1) {
		if (compareSourceRanges(sourceRanges[index - 1]!, sourceRanges[index]!) >= 0) {
			throw new TypeError('Assistance workflow source ranges must use unique canonical order.');
		}
	}
	if (occurrenceIds.size > MAXIMUM_OCCURRENCES) {
		throw new RangeError('The assistance workflow fence carries too many occurrences.');
	}
	return Object.freeze({
		fenceVersion: ASSISTANCE_WORKFLOW_FENCE_VERSION,
		projectId: domainId(record.projectId, 'project ID'),
		schemaVersion: positiveInteger(record.schemaVersion, 'project schema version'),
		revision: nonNegativeInteger(record.revision, 'project revision'),
		sequenceId: domainId(record.sequenceId, 'sequence ID'),
		sourceRanges: Object.freeze(sourceRanges),
		transcriptBodySha256: record.transcriptBodySha256 === null
			? null
			: digest(record.transcriptBodySha256, 'transcript body'),
		recipeSha256: digest(record.recipeSha256, 'recipe'),
		settingsSha256: digest(record.settingsSha256, 'settings'),
		modelBindingsSha256: digest(record.modelBindingsSha256, 'model bindings'),
	});
}

function validateSourceRange(
	value: unknown,
	allOccurrences: Set<string>,
): AssistanceWorkflowSourceRangeV1 {
	const record = exactRecord(value, RANGE_KEYS, 'assistance workflow source range');
	const sourceStartFrame = nonNegativeInteger(record.sourceStartFrame, 'source start frame');
	const sourceEndFrame = nonNegativeInteger(record.sourceEndFrame, 'source end frame');
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('The assistance workflow source range must have a positive exclusive extent.');
	}
	const occurrences = boundedArray(record.occurrenceIds, 1, 256, 'source occurrence IDs')
		.map((candidate) => domainId(candidate, 'occurrence ID'));
	for (const occurrenceId of occurrences) {
		if (allOccurrences.has(occurrenceId)) {
			throw new TypeError('Assistance workflow occurrence IDs must be globally unique.');
		}
		allOccurrences.add(occurrenceId);
	}
	return Object.freeze({
		slotId: slotId(record.slotId, 'source-range slot ID'),
		mediaKind: enumValue(record.mediaKind, ['audio', 'video'] as const, 'source media kind'),
		sourceId: domainId(record.sourceId, 'source ID'),
		sourceSha256: digest(record.sourceSha256, 'source'),
		occurrenceIds: Object.freeze(occurrences),
		sourceStartFrame,
		sourceEndFrame,
		linkMembershipSha256: digest(record.linkMembershipSha256, 'link membership'),
		timingAuthoritySha256: digest(record.timingAuthoritySha256, 'timing authority'),
		retimeKind: enumValue(
			record.retimeKind,
			['identity', 'monotonic-forward'] as const,
			'source retime kind',
		),
	});
}

function compareSourceRanges(left: AssistanceWorkflowSourceRangeV1, right: AssistanceWorkflowSourceRangeV1): number {
	const leftKey = `${left.slotId}\0${left.sourceId}\0${String(left.sourceStartFrame).padStart(16, '0')}\0${
		String(left.sourceEndFrame).padStart(16, '0')}`;
	const rightKey = `${right.slotId}\0${right.sourceId}\0${String(right.sourceStartFrame).padStart(16, '0')}\0${
		String(right.sourceEndFrame).padStart(16, '0')}`;
	return leftKey.localeCompare(rightKey);
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} schema keys are invalid.`);
	}
	return record;
}

function boundedArray(value: unknown, minimum: number, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new TypeError(`Assistance workflow ${label} must be a bounded array.`);
	}
	return value;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) {
		throw new TypeError(`The assistance workflow ${label} is invalid.`);
	}
	return value as Values[number];
}

function domainId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DOMAIN_ID.test(value)) {
		throw new TypeError(`The assistance workflow ${label} is invalid.`);
	}
	return value;
}

function slotId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SLOT_ID.test(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The assistance workflow ${label} needs a lowercase SHA-256 digest.`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`The assistance ${label} is out of range.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The assistance ${label} is out of range.`);
	}
	return Number(value);
}
