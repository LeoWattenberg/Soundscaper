/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transient acknowledgement for already-reviewed Guided editorial proposals. */

import {
	reviewAssistanceEditorialProposalV1,
} from '../assistance/m7-semantic-results.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowOutputClaimV1,
} from '../assistance/workflow.ts';

const EDITORIAL_STAGE_ID = 'generate-editorial-text';
const EDITORIAL_SLOT_ID = 'editorial-proposal';
const EDITORIAL_MEDIA_TYPE = 'application/vnd.soundscaper.editorial-proposal+json';
const MAXIMUM_REVIEWED_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;

export interface LocalAssistanceGuidedEditorialAcceptanceRequest {
	readonly workflow: unknown;
	readonly reviewedResult: unknown;
	readonly selectedChoiceIds: readonly string[];
}

export type LocalAssistanceGuidedEditorialAcceptanceOutcome = Readonly<{
	readonly outcome: 'accepted';
	readonly selectedIds: readonly string[];
}>;

interface ReviewedChoice {
	readonly id: string;
	readonly enabled: true;
}

/**
 * Acknowledge exact selected editorial text after semantic review. This boundary
 * deliberately owns no repository or command port: Qwen text remains transient.
 */
export function acknowledgeLocalAssistanceGuidedEditorialSelection(
	requestValue: LocalAssistanceGuidedEditorialAcceptanceRequest,
): LocalAssistanceGuidedEditorialAcceptanceOutcome {
	const request = exactRecord(requestValue,
		['workflow', 'reviewedResult', 'selectedChoiceIds'], 'Guided editorial acceptance request');
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId !== 'generate-editorial-text') {
		throw new RangeError('Only Guided editorial generation uses transient acknowledgement.');
	}
	if (workflow.settings.workflowId !== workflow.workflowId || !workflow.settings.enabled) {
		throw new RangeError('Guided editorial acknowledgement requires an enabled exact recipe.');
	}
	const terminalClaims = workflow.outputs.filter(({ stageId, slotId }) =>
		stageId === EDITORIAL_STAGE_ID && slotId === EDITORIAL_SLOT_ID);
	if (terminalClaims.length !== 1) {
		throw new TypeError('The Guided editorial workflow has no exact terminal claim authority.');
	}
	const review = exactRecord(request.reviewedResult,
		['reviewVersion', 'jobId', 'workflowId', 'outputs', 'choices'], 'Guided editorial review');
	if (review.reviewVersion !== 1 || review.jobId !== workflow.jobId
		|| review.workflowId !== workflow.workflowId) {
		throw new TypeError('The Guided editorial review does not correlate to its exact workflow.');
	}
	const output = reviewedTerminal(review.outputs, terminalClaims[0]!);
	const choices = reviewedChoices(review.choices);
	const candidateAuthority = Object.freeze(choices.map(({ id }) => id));
	const semantic = reviewAssistanceEditorialProposalV1(output.semantic, candidateAuthority);
	if (semantic.candidates.some(({ candidateId }, index) => candidateId !== choices[index]!.id)) {
		throw new TypeError('The Guided editorial choice order changed reviewed candidate authority.');
	}
	const selectedIds = selectedChoices(request.selectedChoiceIds, choices);
	return Object.freeze({ outcome: 'accepted' as const, selectedIds });
}

function reviewedTerminal(
	value: unknown,
	expectedClaim: AssistanceWorkflowOutputClaimV1,
): Readonly<Record<string, unknown>> {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new TypeError('The Guided editorial review must contain one terminal output.');
	}
	const output = exactRecord(value[0], ['stageId', 'slotId', 'claim', 'mediaType',
		'byteLength', 'sha256', 'body', 'semantic'], 'Guided editorial reviewed output');
	if (output.stageId !== EDITORIAL_STAGE_ID || output.slotId !== EDITORIAL_SLOT_ID
		|| !sameClaim(output.claim, expectedClaim)) {
		throw new TypeError('The Guided editorial review changed its terminal claim authority.');
	}
	if (output.mediaType !== EDITORIAL_MEDIA_TYPE || !(output.body instanceof Blob)
		|| output.body.type !== EDITORIAL_MEDIA_TYPE || output.body.size !== output.byteLength
		|| !Number.isSafeInteger(output.byteLength) || Number(output.byteLength) < 1
		|| Number(output.byteLength) > MAXIMUM_REVIEWED_BYTES || typeof output.sha256 !== 'string'
		|| !SHA256.test(output.sha256)) {
		throw new TypeError('The Guided editorial review lost its bounded reviewed body identity.');
	}
	return output;
}

function reviewedChoices(value: unknown): readonly ReviewedChoice[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
		throw new RangeError('The Guided editorial choice inventory exceeds candidate authority.');
	}
	const choices = value.map((candidate): ReviewedChoice => {
		const row = exactRecord(candidate, ['id', 'kind', 'label', 'selected', 'enabled'],
			'Guided editorial reviewed choice');
		if (typeof row.id !== 'string' || row.kind !== 'editorial' || row.selected !== false
			|| row.enabled !== true || typeof row.label !== 'string' || row.label.length < 1
			|| row.label.length > 256) {
			throw new TypeError('A Guided editorial choice changed reviewed candidate authority.');
		}
		return Object.freeze({ id: row.id, enabled: true as const });
	});
	if (new Set(choices.map(({ id }) => id)).size !== choices.length) {
		throw new TypeError('Guided editorial candidate authority repeats an identity.');
	}
	return Object.freeze(choices);
}

function selectedChoices(
	value: unknown,
	choices: readonly ReviewedChoice[],
): readonly string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > choices.length) {
		throw new RangeError('Guided editorial acceptance requires a bounded selected proposal set.');
	}
	const admitted = new Set(choices.map(({ id }) => id));
	const selected = value.map((candidate) => {
		if (typeof candidate !== 'string' || !admitted.has(candidate)) {
			throw new TypeError('A Guided editorial selection is outside reviewed candidate authority.');
		}
		return candidate;
	});
	if (new Set(selected).size !== selected.length) {
		throw new TypeError('Guided editorial selected proposal IDs must be unique.');
	}
	return Object.freeze(selected);
}

function sameClaim(value: unknown, expected: AssistanceWorkflowOutputClaimV1): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const claim = value as Readonly<Record<string, unknown>>;
	return Reflect.ownKeys(claim).length === 6 && claim.claimVersion === expected.claimVersion
		&& claim.direction === expected.direction && claim.claimId === expected.claimId
		&& claim.jobId === expected.jobId && claim.stageId === expected.stageId
		&& claim.slotId === expected.slotId;
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return row;
}
