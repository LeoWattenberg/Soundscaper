/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Versioned aggregate contract for guided and advanced local-assistance work.
 * Primitive operation-v1 requests remain separate stage execution messages.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ASSISTANCE_WORKFLOW_IDS,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowId,
	type AssistanceWorkflowStageSpec,
} from './workflow-recipes.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from './workflow-settings-v1.ts';
import {
	validateAssistanceWorkflowFenceV1,
	type AssistanceWorkflowFenceV1,
} from './workflow-fence-v1.ts';

export {
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ASSISTANCE_WORKFLOW_IDS,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
};
export {
	ASSISTANCE_WORKFLOW_FENCE_VERSION,
	validateAssistanceWorkflowFenceV1,
} from './workflow-fence-v1.ts';
export type {
	AssistanceAdvancedWorkflowId,
	AssistanceGuidedWorkflowId,
	AssistanceWorkflowId,
	AssistanceWorkflowSlotSpec,
	AssistanceWorkflowStageSpec,
} from './workflow-recipes.ts';
export type {
	AssistanceWorkflowFenceV1,
	AssistanceWorkflowSourceRangeV1,
} from './workflow-fence-v1.ts';

export const ASSISTANCE_WORKFLOW_CONTRACT_VERSION = 1;
export const ASSISTANCE_WORKFLOW_CLAIM_VERSION = 1;
export const ASSISTANCE_WORKFLOW_MODEL_BINDING_VERSION = 1;

export const ASSISTANCE_WORKFLOW_PROGRESS_PHASES = Object.freeze([
	'queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing',
] as const);

export type AssistanceWorkflowProgressPhase = (typeof ASSISTANCE_WORKFLOW_PROGRESS_PHASES)[number];

export interface AssistanceWorkflowClaimV1 {
	readonly claimVersion: typeof ASSISTANCE_WORKFLOW_CLAIM_VERSION;
	readonly direction: 'input' | 'output';
	readonly claimId: string;
	readonly jobId: string;
	readonly stageId: string;
	readonly slotId: string;
}

export type AssistanceWorkflowInputClaimV1 = AssistanceWorkflowClaimV1 & Readonly<{ direction: 'input' }>;
export type AssistanceWorkflowOutputClaimV1 = AssistanceWorkflowClaimV1 & Readonly<{ direction: 'output' }>;

export interface AssistanceWorkflowModelBindingV1 {
	readonly bindingVersion: typeof ASSISTANCE_WORKFLOW_MODEL_BINDING_VERSION;
	readonly stageId: string;
	readonly slotId: string;
	readonly modelId: string;
	readonly version: string;
	readonly artifactSha256s: readonly string[];
}

export interface AssistanceWorkflowV1 {
	readonly contractVersion: typeof ASSISTANCE_WORKFLOW_CONTRACT_VERSION;
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly recipeVersion: number;
	readonly settingsVersion: number;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly fence: AssistanceWorkflowFenceV1;
	readonly stageIds: readonly string[];
	readonly models: readonly AssistanceWorkflowModelBindingV1[];
	readonly inputs: readonly AssistanceWorkflowInputClaimV1[];
	readonly outputs: readonly AssistanceWorkflowOutputClaimV1[];
}

export interface AssistanceWorkflowProgressV1 {
	readonly contractVersion: typeof ASSISTANCE_WORKFLOW_CONTRACT_VERSION;
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly sequence: number;
	readonly stageId: string;
	readonly stageIndex: number;
	readonly stageCount: number;
	readonly phase: AssistanceWorkflowProgressPhase;
	readonly completed: number | null;
	readonly total: number | null;
}

const WORKFLOW_KEYS = Object.freeze([
	'contractVersion', 'jobId', 'workflowId', 'recipeVersion', 'settingsVersion', 'settings', 'fence',
	'stageIds', 'models', 'inputs', 'outputs',
]);
const CLAIM_KEYS = Object.freeze(['claimVersion', 'direction', 'claimId', 'jobId', 'stageId', 'slotId']);
const MODEL_KEYS = Object.freeze([
	'bindingVersion', 'stageId', 'slotId', 'modelId', 'version', 'artifactSha256s',
]);
const PROGRESS_KEYS = Object.freeze([
	'contractVersion', 'jobId', 'workflowId', 'sequence', 'stageId', 'stageIndex', 'stageCount',
	'phase', 'completed', 'total',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_JOB_ID = /^[a-f\d]{40}$/u;
const SLOT_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,126}[a-z\d])?$/u;
const MAXIMUM_CLAIMS = 256;
const MAXIMUM_FRAME_PACK_CLAIMS = 64;
const MAXIMUM_MODELS = 64;
const MAXIMUM_MODEL_ARTIFACTS = 64;

/** Admit one complete aggregate workflow without changing operation-v1. */
export function validateAssistanceWorkflow(value: unknown): AssistanceWorkflowV1 {
	const record = exactRecord(value, WORKFLOW_KEYS, 'assistance workflow');
	if (record.contractVersion !== ASSISTANCE_WORKFLOW_CONTRACT_VERSION) {
		throw new TypeError('The assistance workflow uses an unsupported contract version.');
	}
	const jobId = jobIdValue(record.jobId);
	const workflowId = normalizeAssistanceWorkflowId(record.workflowId);
	const settingsVersion = positiveInteger(record.settingsVersion, 'workflow settings version');
	const settings = validateAssistanceWorkflowSettingsV1(record.settings, workflowId);
	if (settings.settingsVersion !== settingsVersion) {
		throw new TypeError('The assistance workflow settings version disagrees with its body.');
	}
	const fence = validateAssistanceWorkflowFenceV1(record.fence);
	if (fence.settingsSha256 !== assistanceWorkflowSettingsSha256V1(settings)) {
		throw new TypeError('The assistance workflow settings digest disagrees with its body.');
	}
	const recipeVersion = positiveInteger(record.recipeVersion, 'workflow recipe version');
	if (recipeVersion !== 1) {
		throw new TypeError('The assistance workflow recipe version is unsupported.');
	}
	const graph = assistanceWorkflowStageGraph(workflowId);
	const stageIds = validateSelectedStages(record.stageIds, graph);
	const selected = new Map(graph
		.filter(({ stageId }) => stageIds.includes(stageId))
		.map((stageSpec) => [stageSpec.stageId, stageSpec]));
	const inputs = validateClaims(record.inputs, 'input', jobId, selected);
	const outputs = validateClaims(record.outputs, 'output', jobId, selected);
	assertRequiredClaims(inputs, 'input', selected);
	assertRequiredClaims(outputs, 'output', selected);
	const models = validateModels(record.models, selected);
	assertRequiredModels(models, selected);
	assertShotModeAuthority(workflowId, settings, inputs, models);
	if (fence.recipeSha256 !== assistanceWorkflowRecipeSha256V1(
		workflowId, recipeVersion, stageIds,
	)) {
		throw new TypeError('The assistance workflow recipe digest disagrees with its selected graph.');
	}
	if (fence.modelBindingsSha256 !== assistanceWorkflowModelBindingsSha256V1(models)) {
		throw new TypeError('The assistance workflow model-bindings digest disagrees with its bindings.');
	}
	return Object.freeze({
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId,
		workflowId,
		recipeVersion,
		settingsVersion,
		settings,
		fence,
		stageIds,
		models,
		inputs,
		outputs,
	});
}

/** Hash the trusted declarations for exactly the selected closed recipe stages. */
export function assistanceWorkflowRecipeSha256V1(
	workflowIdValue: AssistanceWorkflowId,
	recipeVersionValue: number,
	stageIdsValue: readonly string[],
): string {
	const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
	const recipeVersion = positiveInteger(recipeVersionValue, 'workflow recipe version');
	if (recipeVersion !== 1) throw new TypeError('The assistance workflow recipe version is unsupported.');
	const graph = assistanceWorkflowStageGraph(workflowId);
	const stageIds = validateSelectedStages(stageIdsValue, graph);
	return canonicalSha256({ recipeVersion,
		stages: graph.filter(({ stageId }) => stageIds.includes(stageId)) });
}

/** Hash exact, canonically slotted model bindings. */
export function assistanceWorkflowModelBindingsSha256V1(
	models: readonly AssistanceWorkflowModelBindingV1[],
): string {
	if (!Array.isArray(models) || models.length > MAXIMUM_MODELS) {
		throw new RangeError('The assistance workflow model bindings exceed their bound.');
	}
	return canonicalSha256(models);
}

export function validateAssistanceWorkflowProgress(
	value: unknown,
	workflowValue: unknown,
): AssistanceWorkflowProgressV1 {
	const workflow = validateAssistanceWorkflow(workflowValue);
	const record = exactRecord(value, PROGRESS_KEYS, 'assistance workflow progress');
	if (record.contractVersion !== ASSISTANCE_WORKFLOW_CONTRACT_VERSION) {
		throw new TypeError('The assistance workflow progress uses an unsupported contract version.');
	}
	const progressJobId = jobIdValue(record.jobId);
	const workflowId = normalizeAssistanceWorkflowId(record.workflowId);
	if (progressJobId !== workflow.jobId || workflowId !== workflow.workflowId) {
		throw new TypeError('Assistance workflow progress does not correlate to its exact workflow.');
	}
	const stageIndex = nonNegativeInteger(record.stageIndex, 'workflow progress stage index');
	const stageCount = positiveInteger(record.stageCount, 'workflow progress stage count');
	const stageId = slotId(record.stageId, 'workflow progress stage ID');
	if (stageCount !== workflow.stageIds.length || workflow.stageIds[stageIndex] !== stageId) {
		throw new TypeError('Assistance workflow progress must name the selected stage at its exact stage index.');
	}
	const [completed, total] = progressUnits(record.completed, record.total);
	return Object.freeze({
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId: progressJobId,
		workflowId,
		sequence: nonNegativeInteger(record.sequence, 'workflow progress sequence'),
		stageId,
		stageIndex,
		stageCount,
		phase: enumValue(record.phase, ASSISTANCE_WORKFLOW_PROGRESS_PHASES, 'workflow progress phase'),
		completed,
		total,
	});
}

/** Stateful admission for a correlated progress stream across workflow stages. */
export class AssistanceWorkflowProgressTracker {
	readonly #workflow: AssistanceWorkflowV1;
	#last: AssistanceWorkflowProgressV1 | null = null;

	constructor(workflowValue: unknown) {
		this.#workflow = validateAssistanceWorkflow(workflowValue);
	}

	accept(value: unknown): AssistanceWorkflowProgressV1 {
		const progress = validateAssistanceWorkflowProgress(value, this.#workflow);
		const previous = this.#last;
		if (!previous && progress.stageIndex !== 0) {
			throw new TypeError('Assistance workflow progress must begin with the first selected stage.');
		}
		if (previous) assertWorkflowProgressAdvances(previous, progress);
		this.#last = progress;
		return progress;
	}
}

function validateSelectedStages(
	value: unknown,
	graph: readonly AssistanceWorkflowStageSpec[],
): readonly string[] {
	const candidates = boundedArray(value, 1, graph.length, 'selected stages')
		.map((candidate) => slotId(candidate, 'workflow stage ID'));
	if (new Set(candidates).size !== candidates.length) {
		throw new TypeError('Assistance workflow stage IDs must be unique.');
	}
	const selected = new Set(candidates);
	const graphIds = new Set(graph.map(({ stageId }) => stageId));
	if (candidates.some((candidate) => !graphIds.has(candidate))) {
		throw new TypeError('An assistance workflow selected an unpermitted stage.');
	}
	for (const stageSpec of graph) {
		if (stageSpec.required && !selected.has(stageSpec.stageId)) {
			throw new TypeError(`The assistance workflow omitted required stage ${stageSpec.stageId}.`);
		}
		if (selected.has(stageSpec.stageId)
			&& stageSpec.after.some((dependency) => !selected.has(dependency))) {
			throw new TypeError(`The assistance workflow stage ${stageSpec.stageId} omitted a dependency.`);
		}
	}
	const canonical = graph.filter(({ stageId }) => selected.has(stageId)).map(({ stageId }) => stageId);
	if (canonical.some((stageId, index) => candidates[index] !== stageId)) {
		throw new TypeError('Assistance workflow stages must follow their derived canonical graph order.');
	}
	return Object.freeze(candidates);
}

function validateClaims(
	value: unknown,
	direction: 'input',
	jobId: string,
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): readonly AssistanceWorkflowInputClaimV1[];
function validateClaims(
	value: unknown,
	direction: 'output',
	jobId: string,
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): readonly AssistanceWorkflowOutputClaimV1[];
function validateClaims(
	value: unknown,
	direction: 'input' | 'output',
	jobId: string,
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): readonly AssistanceWorkflowClaimV1[] {
	const seen = new Map<string, Set<string>>();
	const claims = boundedArray(value, 1, MAXIMUM_CLAIMS, `${direction} claims`).map((candidate) => {
		const record = exactRecord(candidate, CLAIM_KEYS, `assistance workflow ${direction} claim`);
		if (record.claimVersion !== ASSISTANCE_WORKFLOW_CLAIM_VERSION || record.direction !== direction) {
			throw new TypeError(`The assistance workflow ${direction} claim uses an invalid version or direction.`);
		}
		const claimJobId = jobIdValue(record.jobId);
		if (claimJobId !== jobId) throw new TypeError('An assistance workflow claim must bind its exact job ID.');
		const stageId = slotId(record.stageId, 'workflow claim stage ID');
		const stageSpec = selected.get(stageId);
		if (!stageSpec) throw new TypeError('An assistance workflow claim names an unselected stage.');
		const claimSlotId = slotId(record.slotId, `workflow ${direction} slot ID`);
		const admittedSlots = direction === 'input' ? stageSpec.inputSlots : stageSpec.outputSlots;
		if (!admittedSlots.some(({ slotId: admitted }) => admitted === claimSlotId)) {
			throw new TypeError(`The assistance workflow stage does not admit that ${direction} slot.`);
		}
		const key = `${stageId}\0${claimSlotId}`;
		const claimId = opaqueClaimId(record.claimId);
		const claimIds = seen.get(key) ?? new Set<string>();
		if (claimIds.size > 0 && (direction !== 'input' || claimSlotId !== 'frame-pack')) {
			throw new TypeError(`An assistance workflow ${direction} slot may be bound only once.`);
		}
		if (claimIds.has(claimId) || claimIds.size >= MAXIMUM_FRAME_PACK_CLAIMS) {
			throw new TypeError('Assistance workflow frame-pack claims must be distinct and bounded.');
		}
		claimIds.add(claimId);
		seen.set(key, claimIds);
		return Object.freeze({
			claimVersion: ASSISTANCE_WORKFLOW_CLAIM_VERSION,
			direction,
			claimId,
			jobId: claimJobId,
			stageId,
			slotId: claimSlotId,
		});
	});
	return Object.freeze(claims);
}

function assertRequiredClaims(
	claims: readonly AssistanceWorkflowClaimV1[],
	direction: 'input' | 'output',
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): void {
	const present = new Set(claims.map(({ stageId, slotId }) => `${stageId}\0${slotId}`));
	for (const stageSpec of selected.values()) {
		const slots = direction === 'input' ? stageSpec.inputSlots : stageSpec.outputSlots;
		for (const slot of slots) {
			if (slot.required && !present.has(`${stageSpec.stageId}\0${slot.slotId}`)) {
				throw new TypeError(`The assistance workflow omitted required ${direction} slot ${slot.slotId}.`);
			}
		}
	}
}

function assertShotModeAuthority(
	workflowId: AssistanceWorkflowId,
	settings: AssistanceWorkflowSettingsV1,
	inputs: readonly AssistanceWorkflowInputClaimV1[],
	models: readonly AssistanceWorkflowModelBindingV1[],
): void {
	const mode = settings.workflowId === 'mark-cuts' ? settings.mode
		: settings.workflowId === 'index-video' ? settings.shotMode : null;
	if (mode === null) return;
	const expectedInput = mode === 'accurate' ? 'frame-pack' : 'video';
	const shotInputs = inputs.filter(({ stageId }) => stageId === 'detect-shots');
	if (shotInputs.length < 1 || shotInputs.length > (mode === 'accurate'
		? MAXIMUM_FRAME_PACK_CLAIMS : 1)
		|| shotInputs.some(({ slotId }) => slotId !== expectedInput)) {
		throw new TypeError('The assistance shot input disagrees with its explicit mode.');
	}
	const shotModels = models.filter(({ stageId, slotId }) =>
		stageId === 'detect-shots' && slotId === 'accurate-shot-detector');
	if (shotModels.length !== (mode === 'accurate' ? 1 : 0)) {
		throw new TypeError('The assistance shot model disagrees with its explicit mode.');
	}
}

function validateModels(
	value: unknown,
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): readonly AssistanceWorkflowModelBindingV1[] {
	const seen = new Set<string>();
	const models = boundedArray(value, 0, MAXIMUM_MODELS, 'model bindings').map((candidate) => {
		const record = exactRecord(candidate, MODEL_KEYS, 'assistance workflow model binding');
		if (record.bindingVersion !== ASSISTANCE_WORKFLOW_MODEL_BINDING_VERSION) {
			throw new TypeError('The assistance workflow model binding uses an unsupported version.');
		}
		const stageId = slotId(record.stageId, 'workflow model stage ID');
		const stageSpec = selected.get(stageId);
		if (!stageSpec) throw new TypeError('An assistance workflow model binding names an unselected stage.');
		const modelSlotId = slotId(record.slotId, 'workflow model slot ID');
		if (!stageSpec.modelSlots.some(({ slotId: admitted }) => admitted === modelSlotId)) {
			throw new TypeError('The assistance workflow stage does not admit that model slot.');
		}
		const key = `${stageId}\0${modelSlotId}`;
		if (seen.has(key)) throw new TypeError('An assistance workflow model slot may be bound only once.');
		seen.add(key);
		const artifacts = boundedArray(
			record.artifactSha256s,
			1,
			MAXIMUM_MODEL_ARTIFACTS,
			'model artifact digests',
		).map((artifact) => digest(artifact, 'model artifact'));
		if (artifacts.some((artifact, index) => index > 0 && artifact <= artifacts[index - 1]!)) {
			throw new TypeError('Assistance workflow model artifact digests must be sorted and unique.');
		}
		return Object.freeze({
			bindingVersion: ASSISTANCE_WORKFLOW_MODEL_BINDING_VERSION,
			stageId,
			slotId: modelSlotId,
			modelId: modelId(record.modelId),
			version: boundedVersion(record.version),
			artifactSha256s: Object.freeze(artifacts),
		});
	});
	return Object.freeze(models);
}

function assertRequiredModels(
	models: readonly AssistanceWorkflowModelBindingV1[],
	selected: ReadonlyMap<string, AssistanceWorkflowStageSpec>,
): void {
	const present = new Set(models.map(({ stageId, slotId }) => `${stageId}\0${slotId}`));
	for (const stageSpec of selected.values()) {
		for (const slot of stageSpec.modelSlots) {
			if (slot.required && !present.has(`${stageSpec.stageId}\0${slot.slotId}`)) {
				throw new TypeError(`The assistance workflow omitted required model slot ${slot.slotId}.`);
			}
		}
	}
}

function assertWorkflowProgressAdvances(
	previous: AssistanceWorkflowProgressV1,
	next: AssistanceWorkflowProgressV1,
): void {
	if (next.sequence <= previous.sequence) {
		throw new TypeError('Assistance workflow progress sequence must advance strictly.');
	}
	if (next.stageIndex < previous.stageIndex) {
		throw new TypeError('Assistance workflow progress stages cannot regress.');
	}
	if (next.stageIndex > previous.stageIndex) {
		if (next.stageIndex !== previous.stageIndex + 1 || previous.phase !== 'finalizing') {
			throw new TypeError('Assistance workflow progress must finalize each stage before advancing.');
		}
		return;
	}
	const previousPhase = ASSISTANCE_WORKFLOW_PROGRESS_PHASES.indexOf(previous.phase);
	const nextPhase = ASSISTANCE_WORKFLOW_PROGRESS_PHASES.indexOf(next.phase);
	if (nextPhase < previousPhase) throw new TypeError('Assistance workflow progress phases cannot regress.');
	if (nextPhase === previousPhase) assertProgressUnitsAdvance(previous, next);
}

function progressUnits(completedValue: unknown, totalValue: unknown): readonly [number | null, number | null] {
	if (completedValue === null && totalValue === null) return [null, null];
	if (typeof completedValue !== 'number' || !Number.isFinite(completedValue) || completedValue < 0
		|| typeof totalValue !== 'number' || !Number.isFinite(totalValue) || totalValue <= 0
		|| completedValue > totalValue) {
		throw new TypeError('Assistance workflow progress units must be finite and within range.');
	}
	return [completedValue, totalValue];
}

function assertProgressUnitsAdvance(
	previous: AssistanceWorkflowProgressV1,
	next: AssistanceWorkflowProgressV1,
): void {
	if (previous.completed !== null && next.completed === null) {
		throw new TypeError('Assistance workflow progress cannot discard determinate units within a phase.');
	}
	if (previous.completed !== null && next.completed !== null
		&& (next.completed < previous.completed || next.total !== previous.total)) {
		throw new TypeError('Assistance workflow progress units must advance monotonically within a phase.');
	}
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

function jobIdValue(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_JOB_ID.test(value)) {
		throw new TypeError('An assistance workflow job ID must be 40 lowercase hexadecimal characters.');
	}
	return value;
}

function opaqueClaimId(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_JOB_ID.test(value)) {
		throw new TypeError('An assistance workflow claim ID must be 40 lowercase hexadecimal characters.');
	}
	return value;
}

function slotId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SLOT_ID.test(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function modelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID.test(value)) {
		throw new TypeError('The assistance workflow model ID is invalid.');
	}
	return value;
}

function boundedVersion(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value !== value.trim()) {
		throw new TypeError('The assistance workflow model version is invalid.');
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

function canonicalSha256(value: unknown): string {
	return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))));
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) {
		throw new TypeError('The assistance workflow digest body is not canonical JSON.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record).sort().map((key) =>
		`${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
