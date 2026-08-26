/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Versioned aggregate contract for guided and advanced local-assistance work.
 * Primitive operation-v1 requests remain separate stage execution messages.
 */

import {
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ASSISTANCE_WORKFLOW_IDS,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowId,
	type AssistanceWorkflowStageSpec,
} from './workflow-recipes.ts';

export {
	ADVANCED_ASSISTANCE_WORKFLOW_IDS,
	ASSISTANCE_GUIDED_WORKFLOW_IDS,
	ASSISTANCE_WORKFLOW_IDS,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
};
export type {
	AssistanceAdvancedWorkflowId,
	AssistanceGuidedWorkflowId,
	AssistanceWorkflowId,
	AssistanceWorkflowSlotSpec,
	AssistanceWorkflowStageSpec,
} from './workflow-recipes.ts';

export const ASSISTANCE_WORKFLOW_CONTRACT_VERSION = 1;
export const ASSISTANCE_WORKFLOW_FENCE_VERSION = 1;
export const ASSISTANCE_WORKFLOW_CLAIM_VERSION = 1;
export const ASSISTANCE_WORKFLOW_MODEL_BINDING_VERSION = 1;

export const ASSISTANCE_WORKFLOW_PROGRESS_PHASES = Object.freeze([
	'queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing',
] as const);

export type AssistanceWorkflowProgressPhase = (typeof ASSISTANCE_WORKFLOW_PROGRESS_PHASES)[number];

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
	'contractVersion', 'jobId', 'workflowId', 'recipeVersion', 'settingsVersion', 'fence',
	'stageIds', 'models', 'inputs', 'outputs',
]);
const FENCE_KEYS = Object.freeze([
	'fenceVersion', 'projectId', 'schemaVersion', 'revision', 'sequenceId', 'sourceRanges',
	'transcriptBodySha256', 'recipeSha256', 'settingsSha256', 'modelBindingsSha256',
]);
const RANGE_KEYS = Object.freeze([
	'slotId', 'mediaKind', 'sourceId', 'sourceSha256', 'occurrenceIds', 'sourceStartFrame',
	'sourceEndFrame', 'linkMembershipSha256', 'timingAuthoritySha256', 'retimeKind',
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
const DOMAIN_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SLOT_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,126}[a-z\d])?$/u;
const MAXIMUM_SOURCE_RANGES = 64;
const MAXIMUM_OCCURRENCES = 1024;
const MAXIMUM_CLAIMS = 256;
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
	return Object.freeze({
		contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
		jobId,
		workflowId,
		recipeVersion: positiveInteger(record.recipeVersion, 'workflow recipe version'),
		settingsVersion: positiveInteger(record.settingsVersion, 'workflow settings version'),
		fence: validateAssistanceWorkflowFenceV1(record.fence),
		stageIds,
		models,
		inputs,
		outputs,
	});
}

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
	const seen = new Set<string>();
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
		if (seen.has(key)) throw new TypeError(`An assistance workflow ${direction} slot may be bound only once.`);
		seen.add(key);
		return Object.freeze({
			claimVersion: ASSISTANCE_WORKFLOW_CLAIM_VERSION,
			direction,
			claimId: opaqueClaimId(record.claimId),
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
