/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Pathless controller-to-main contract for the complete Milestone-7 operation
 * vocabulary. Runtime-specific helper grants remain independently closed and
 * are admitted only once their adapter exists.
 */

import {
	ASSISTANCE_INPUT_ROLES,
	ASSISTANCE_OUTPUT_ROLES,
	validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim,
	type AssistanceInputRole,
	type AssistanceOutputClaim,
	type AssistanceOutputReservation,
	type AssistanceOutputRole,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import { assertHelperWireEnvelope } from './helper-wire-admission.ts';
import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../src/common/editor/assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../src/common/editor/assistance/proposal-session.ts';

export const ASSISTANCE_OPERATION_CONTRACT_VERSION = 1;
export const ASSISTANCE_PROGRESS_PHASES = Object.freeze([
	'queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing',
] as const);

export type AssistanceProgressPhase = (typeof ASSISTANCE_PROGRESS_PHASES)[number];

export type AssistanceOperationRequest = {
	readonly [Operation in AssistanceOperation]: Readonly<{
		contractVersion: typeof ASSISTANCE_OPERATION_CONTRACT_VERSION;
		jobId: string;
		operation: Operation;
		selectionFence: AssistanceSelectionFence;
		models: readonly AssistanceOperationModelBinding[];
		inputs: readonly AssistanceStagedInputClaim[];
		outputs: readonly AssistanceOutputReservation[];
	}>;
}[AssistanceOperation];

export interface AssistanceOperationModelBinding {
	readonly modelId: string;
	readonly version: string;
	readonly artifactSha256s: readonly string[];
}

export type AssistanceOperationResult = {
	readonly [Operation in AssistanceOperation]: Readonly<{
		contractVersion: typeof ASSISTANCE_OPERATION_CONTRACT_VERSION;
		jobId: string;
		operation: Operation;
		outputs: readonly AssistanceOutputClaim[];
	}>;
}[AssistanceOperation];

export type AssistanceOperationProgress = {
	readonly [Operation in AssistanceOperation]: Readonly<{
		contractVersion: typeof ASSISTANCE_OPERATION_CONTRACT_VERSION;
		jobId: string;
		operation: Operation;
		sequence: number;
		phase: AssistanceProgressPhase;
		completed: number | null;
		total: number | null;
	}>;
}[AssistanceOperation];

/** Stateful admission for one correlated, strictly forward progress stream. */
export class AssistanceOperationProgressTracker {
	readonly #request: AssistanceOperationRequest;
	#last: AssistanceOperationProgress | null = null;

	constructor(requestValue: unknown) {
		this.#request = validateAssistanceOperationRequest(requestValue);
	}

	accept(value: unknown): AssistanceOperationProgress {
		const progress = validateAssistanceOperationProgress(value, this.#request);
		const previous = this.#last;
		if (previous) {
			if (progress.sequence <= previous.sequence) {
				throw new TypeError('Assistance progress sequence must advance strictly.');
			}
			const previousPhase = ASSISTANCE_PROGRESS_PHASES.indexOf(previous.phase);
			const nextPhase = ASSISTANCE_PROGRESS_PHASES.indexOf(progress.phase);
			if (nextPhase < previousPhase) {
				throw new TypeError('Assistance progress phases cannot regress.');
			}
			if (nextPhase === previousPhase) assertProgressUnitsAdvance(previous, progress);
		}
		this.#last = progress;
		return progress;
	}
}

interface AssistanceOperationSpec {
	readonly admittedInputRoles: readonly AssistanceInputRole[];
	readonly requiredInputRoleGroups: readonly (readonly AssistanceInputRole[])[];
	readonly admittedOutputRoles: readonly AssistanceOutputRole[];
}

const OPERATION_SPECS = Object.freeze({
	'voice-activity-detection': spec(['audio'], [['audio']], ['voice-activity']),
	'speech-recognition': spec(['audio', 'voice-activity'], [['audio']], ['transcript']),
	'word-alignment': spec(['audio', 'transcript'], [['audio'], ['transcript']], ['word-alignment']),
	'speaker-diarization': spec(['audio'], [['audio']], ['speaker-turns']),
	'speech-enhancement': spec(['audio'], [['audio']], ['enhanced-audio']),
	'source-separation': spec(['audio'], [['audio']], ['separated-audio']),
	'audio-tagging': spec(['audio'], [['audio']], ['audio-tags']),
	'beat-tracking': spec(['audio'], [['audio']], ['beat-grid']),
	'text-embedding': spec(['transcript', 'text'], [['transcript', 'text']], ['embeddings']),
	'image-text-embedding': spec(['frame-pack', 'text'], [['frame-pack', 'text']], ['embeddings']),
	'optical-character-recognition': spec(['frame-pack'], [['frame-pack']], ['recognized-text']),
	'shot-detection': spec(['video', 'frame-pack'], [['video', 'frame-pack']], ['shot-boundaries']),
	'subject-detection': spec(['frame-pack'], [['frame-pack']], ['subject-tracks']),
	'saliency-detection': spec(['frame-pack'], [['frame-pack']], ['saliency-map']),
	'editorial-generation': spec(['editorial-context'], [['editorial-context']], ['editorial-proposal']),
} satisfies Readonly<Record<AssistanceOperation, AssistanceOperationSpec>>);

const REQUEST_KEYS = Object.freeze([
	'contractVersion', 'jobId', 'operation', 'selectionFence', 'models', 'inputs', 'outputs',
]);
const RESULT_KEYS = Object.freeze(['contractVersion', 'jobId', 'operation', 'outputs']);
const PROGRESS_KEYS = Object.freeze([
	'contractVersion', 'jobId', 'operation', 'sequence', 'phase', 'completed', 'total',
]);
const JOB_ID = /^[a-f\d]{40}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MODEL_BINDING_KEYS = Object.freeze(['modelId', 'version', 'artifactSha256s']);
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_MODELS = 8;
const MAXIMUM_MODEL_ARTIFACTS = 64;
const MAXIMUM_CLAIMS = 64;

export function validateAssistanceOperationRequest(value: unknown): AssistanceOperationRequest {
	const record = operationRecord(value, REQUEST_KEYS, 'An assistance operation request');
	const operation = normalizeAssistanceOperation(record.operation);
	const jobId = opaqueJobId(record.jobId);
	const selectionFence = validateAssistanceSelectionFence(record.selectionFence);
	const models = validateModels(record.models, operation);
	const inputs = validateArray(record.inputs, MAXIMUM_CLAIMS, 'input claims')
		.map((claim) => validateAssistanceStagedInputClaim(claim));
	const outputs = validateArray(record.outputs, MAXIMUM_CLAIMS, 'output reservations')
		.map((claim) => validateAssistanceOutputReservation(claim));
	if (inputs.length === 0 || outputs.length === 0) {
		throw new TypeError('An assistance operation requires staged input and reserved output claims.');
	}
	assertAggregateBytes(inputs, 'input');
	assertAggregateBytes(outputs, 'output');
	assertUniqueClaims([...inputs, ...outputs]);
	for (const claim of [...inputs, ...outputs]) {
		if (claim.jobId !== jobId) throw new TypeError('An assistance data claim must bind its exact job id.');
	}
	assertOperationRoles(operation, inputs, outputs);
	return Object.freeze({
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId,
		operation,
		selectionFence,
		models: Object.freeze(models),
		inputs: Object.freeze(inputs),
		outputs: Object.freeze(outputs),
	}) as AssistanceOperationRequest;
}

export function validateAssistanceOperationResult(
	value: unknown,
	requestValue: unknown,
): AssistanceOperationResult {
	const request = validateAssistanceOperationRequest(requestValue);
	const record = operationRecord(value, RESULT_KEYS, 'An assistance operation result');
	assertCorrelated(record, request);
	const candidates = validateArray(record.outputs, MAXIMUM_CLAIMS, 'output claims');
	if (candidates.length !== request.outputs.length) {
		throw new TypeError('An assistance result must satisfy every exact output reservation once.');
	}
	const reservations = new Map(request.outputs.map((reservation) => [reservation.claimId, reservation]));
	const outputs = candidates.map((candidate) => {
		const unbound = validateAssistanceOutputClaim(candidate);
		const reservation = reservations.get(unbound.claimId);
		if (!reservation) throw new TypeError('An assistance result names an unreserved output claim.');
		reservations.delete(unbound.claimId);
		return validateAssistanceOutputClaim(unbound, reservation);
	});
	if (reservations.size !== 0) {
		throw new TypeError('An assistance result omitted a reserved output claim.');
	}
	return Object.freeze({
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId: request.jobId,
		operation: request.operation,
		outputs: Object.freeze(outputs),
	}) as AssistanceOperationResult;
}

export function validateAssistanceOperationProgress(
	value: unknown,
	requestValue?: unknown,
): AssistanceOperationProgress {
	const record = operationRecord(value, PROGRESS_KEYS, 'An assistance operation progress update');
	const operation = normalizeAssistanceOperation(record.operation);
	const jobId = opaqueJobId(record.jobId);
	if (requestValue !== undefined) {
		assertCorrelated(record, validateAssistanceOperationRequest(requestValue));
	}
	if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0) {
		throw new TypeError('An assistance progress sequence must be a non-negative safe integer.');
	}
	const phase = enumValue(
		record.phase,
		ASSISTANCE_PROGRESS_PHASES,
		'An assistance progress phase is unrecognised.',
	);
	const [completed, total] = progressUnits(record.completed, record.total);
	return Object.freeze({
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId,
		operation,
		sequence: Number(record.sequence),
		phase,
		completed,
		total,
	}) as AssistanceOperationProgress;
}

function assertOperationRoles(
	operation: AssistanceOperation,
	inputs: readonly AssistanceStagedInputClaim[],
	outputs: readonly AssistanceOutputReservation[],
): void {
	const operationSpec = OPERATION_SPECS[operation];
	for (const input of inputs) {
		if (!operationSpec.admittedInputRoles.includes(input.role)) {
			throw new TypeError(`The ${operation} operation does not admit the ${input.role} input role.`);
		}
	}
	if (operation === 'speech-recognition'
		&& (inputs.filter(({ role }) => role === 'audio').length !== 1
			|| inputs.filter(({ role }) => role === 'voice-activity').length > 1)) {
		throw new TypeError('Speech recognition admits exactly one audio and at most one voice-activity input.');
	}
	for (const required of operationSpec.requiredInputRoleGroups) {
		if (!inputs.some(({ role }) => required.includes(role))) {
			throw new TypeError(`The ${operation} operation requires a ${required.join(' or ')} input role.`);
		}
	}
	for (const output of outputs) {
		if (!operationSpec.admittedOutputRoles.includes(output.role)) {
			throw new TypeError(`The ${operation} operation does not admit the ${output.role} output role.`);
		}
	}
}

function spec(
	admittedInputRoles: readonly AssistanceInputRole[],
	requiredInputRoleGroups: readonly (readonly AssistanceInputRole[])[],
	admittedOutputRoles: readonly AssistanceOutputRole[],
): AssistanceOperationSpec {
	for (const role of admittedInputRoles) {
		if (!ASSISTANCE_INPUT_ROLES.includes(role)) throw new Error(`Unknown assistance input role ${role}.`);
	}
	for (const role of admittedOutputRoles) {
		if (!ASSISTANCE_OUTPUT_ROLES.includes(role)) throw new Error(`Unknown assistance output role ${role}.`);
	}
	return Object.freeze({
		admittedInputRoles: Object.freeze([...admittedInputRoles]),
		requiredInputRoleGroups: Object.freeze(requiredInputRoleGroups.map((roles) => Object.freeze([...roles]))),
		admittedOutputRoles: Object.freeze([...admittedOutputRoles]),
	});
}

function operationRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`${label} must carry exactly its schema keys.`);
	}
	if (record.contractVersion !== ASSISTANCE_OPERATION_CONTRACT_VERSION) {
		throw new TypeError(`${label} uses an unsupported contract version.`);
	}
	return record;
}

function opaqueJobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) {
		throw new TypeError('An assistance operation job id must be 40 lowercase hexadecimal characters.');
	}
	return value;
}

function validateModels(
	value: unknown,
	operation: AssistanceOperation,
): AssistanceOperationModelBinding[] {
	const values = validateArray(value, MAXIMUM_MODELS, 'model bindings');
	if (values.length === 0 && operation !== 'shot-detection') {
		throw new TypeError(`The ${operation} operation requires at least one exact model binding.`);
	}
	const models = values.map((candidate) => {
		const record = exactRecord(candidate, MODEL_BINDING_KEYS, 'An assistance model binding');
		if (typeof record.modelId !== 'string' || !MODEL_ID.test(record.modelId)) {
			throw new TypeError('An assistance model binding needs a bounded catalog identity.');
		}
		if (typeof record.version !== 'string' || record.version.length < 1 || record.version.length > 64
			|| record.version !== record.version.trim()) {
			throw new TypeError('An assistance model binding needs one bounded exact version.');
		}
		const artifactSha256s = validateArray(
			record.artifactSha256s,
			MAXIMUM_MODEL_ARTIFACTS,
			'model artifact digests',
		);
		if (artifactSha256s.length === 0 || artifactSha256s.some((digestValue, index) => (
			typeof digestValue !== 'string' || !SHA256.test(digestValue)
			|| (index > 0 && digestValue <= artifactSha256s[index - 1]!)
		))) {
			throw new TypeError('Assistance model artifact digests must be non-empty, sorted, and unique.');
		}
		return Object.freeze({
			modelId: record.modelId,
			version: record.version,
			artifactSha256s: Object.freeze([...artifactSha256s] as string[]),
		});
	});
	if (new Set(models.map(({ modelId }) => modelId)).size !== models.length) {
		throw new TypeError('Assistance model bindings must use unique catalog identities.');
	}
	return models;
}

function exactRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`${label} must carry exactly its schema keys.`);
	}
	return record;
}

function validateArray(value: unknown, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new TypeError(`Assistance ${label} must be a bounded array.`);
	}
	return value;
}

function assertUniqueClaims(
	claims: readonly Readonly<{ claimId: string }>[],
): void {
	if (new Set(claims.map(({ claimId }) => claimId)).size !== claims.length) {
		throw new TypeError('An assistance request must use each data claim id once.');
	}
}

function assertAggregateBytes(
	claims: readonly Readonly<{ byteLength?: number; maximumByteLength?: number }>[],
	label: 'input' | 'output',
): void {
	const total = claims.reduce((sum, claim) => (
		sum + (claim.byteLength ?? claim.maximumByteLength ?? 0)
	), 0);
	if (!Number.isSafeInteger(total) || total > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		throw new RangeError(`Assistance ${label} claims exceed their aggregate data-plane byte bound.`);
	}
}

function assertCorrelated(
	record: Record<string, unknown>,
	request: AssistanceOperationRequest,
): void {
	if (record.jobId !== request.jobId || record.operation !== request.operation) {
		throw new TypeError('An assistance message does not correlate to its exact job and operation.');
	}
}

function progressUnits(completedValue: unknown, totalValue: unknown): readonly [number | null, number | null] {
	if (completedValue === null && totalValue === null) return [null, null];
	if (typeof completedValue !== 'number' || !Number.isFinite(completedValue) || completedValue < 0
		|| typeof totalValue !== 'number' || !Number.isFinite(totalValue) || totalValue <= 0
		|| completedValue > totalValue) {
		throw new TypeError('Assistance progress must be null or finite completed/total units within range.');
	}
	return [completedValue, totalValue];
}

function assertProgressUnitsAdvance(
	previous: AssistanceOperationProgress,
	next: AssistanceOperationProgress,
): void {
	if (previous.completed !== null && next.completed === null) {
		throw new TypeError('Assistance progress cannot discard determinate units within one phase.');
	}
	if (previous.completed !== null && next.completed !== null
		&& (next.completed < previous.completed || next.total !== previous.total)) {
		throw new TypeError('Assistance progress units must advance monotonically within one phase.');
	}
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	message: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(message);
	}
	return value as Values[number];
}
