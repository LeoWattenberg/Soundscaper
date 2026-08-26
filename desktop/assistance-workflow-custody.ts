/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned workflow namespace over the existing private, authenticated staging registry. */

import { createReadStream } from 'node:fs';

import {
	validateAssistanceOutputClaim,
	validateAssistanceStagedInputClaim,
	type AssistanceInputRole,
	type AssistanceOutputClaim,
	type AssistanceOutputReservation,
	type AssistanceOutputRole,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import {
	createAssistanceWorkflowStageCustodyToken,
	type AssistanceWorkflowStageBindingV1,
	type AssistanceWorkflowStageCustodyResultV1,
} from './assistance-workflow-executor.ts';
import {
	assistanceWorkflowCustodySlotSpec,
	createAssistanceWorkflowCustodyClaimV1,
	validateAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
	type AssistanceWorkflowCustodyClaimV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowClaimV1,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';

export interface AssistanceWorkflowCustodyHandleV1 {
	readonly custody: AssistanceWorkflowCustodyClaimV1;
	readonly workflowClaim: AssistanceWorkflowClaimV1;
}

export interface AssistanceWorkflowStageInputRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly bytes: AsyncIterable<Uint8Array>;
	readonly signal?: AbortSignal;
}

export interface AssistanceWorkflowStagedInputBindingRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
	readonly claim: AssistanceStagedInputClaim;
}

export interface AssistanceWorkflowOutputReservationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
	readonly maximumByteLength: number;
	readonly mediaType?: string;
}

export interface AssistanceWorkflowProducerBindingRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
	readonly producerStageId: string;
	readonly producerSlotId: string;
	readonly producerClaimId: string;
}

interface InputRecord {
	readonly custody: AssistanceWorkflowCustodyClaimV1;
	readonly claim: AssistanceStagedInputClaim | null;
}

interface OutputRecord {
	readonly custody: AssistanceWorkflowCustodyClaimV1;
	readonly reservation: AssistanceOutputReservation;
	claim: AssistanceOutputClaim | null;
}

interface JobRecord {
	readonly jobId: string;
	workflowId: AssistanceWorkflowId | null;
	readonly inputs: Map<string, InputRecord>;
	readonly outputs: Map<string, OutputRecord>;
}

export class AssistanceWorkflowCustody {
	readonly #staging: AssistanceStagingRegistry;
	readonly #jobs = new Map<string, JobRecord>();

	constructor(options: Readonly<{ staging: AssistanceStagingRegistry }>) {
		if (!options?.staging || typeof options.staging.createJob !== 'function'
			|| typeof options.staging.stageInput !== 'function'
			|| typeof options.staging.reserveOutput !== 'function') {
			throw new TypeError('Workflow custody requires the authenticated staging registry.');
		}
		this.#staging = options.staging;
	}

	async createJob(): Promise<Readonly<{ contractVersion: 1; jobId: string }>> {
		const jobId = await this.#staging.createJob();
		if (this.#jobs.has(jobId)) {
			await this.#staging.releaseJob(jobId).catch(() => undefined);
			throw new Error('The workflow custody job identity was reused.');
		}
		this.#jobs.set(jobId, { jobId, workflowId: null, inputs: new Map(), outputs: new Map() });
		return Object.freeze({ contractVersion: 1, jobId });
	}

	assertJob(jobIdValue: unknown): void {
		this.#job(jobIdValue);
	}

	async stageInput(
		request: AssistanceWorkflowStageInputRequest,
	): Promise<AssistanceWorkflowCustodyHandleV1> {
		const spec = assistanceWorkflowCustodySlotSpec(
			request.workflowId, request.stageId, 'input', request.slotId,
		);
		if (!spec.mediaTypes.includes(request.mediaType)) {
			throw new TypeError('The external workflow input media type is incompatible with its slot.');
		}
		const claim = await this.stageRawInput({ jobId: request.jobId,
			role: spec.role as AssistanceInputRole, mediaType: request.mediaType,
			byteLength: request.byteLength, bytes: request.bytes,
			...(request.signal ? { signal: request.signal } : {}) });
		return this.bindStagedInput({ jobId: request.jobId, workflowId: request.workflowId,
			stageId: request.stageId, slotId: request.slotId, claim });
	}

	stageRawInput(
		request: Parameters<AssistanceStagingRegistry['stageInput']>[0],
	): Promise<AssistanceStagedInputClaim> {
		this.assertJob(request?.jobId);
		return this.#staging.stageInput(request);
	}

	bindStagedInput(
		request: AssistanceWorkflowStagedInputBindingRequest,
	): AssistanceWorkflowCustodyHandleV1 {
		const job = this.#boundJob(request?.jobId, request?.workflowId);
		const key = bindingKey(request.stageId, request.slotId);
		if (job.inputs.has(key)) throw new Error('That workflow input slot already has custody.');
		const spec = assistanceWorkflowCustodySlotSpec(
			request.workflowId, request.stageId, 'input', request.slotId,
		);
		const claim = validateAssistanceStagedInputClaim(request.claim);
		if (claim.jobId !== job.jobId || claim.role !== spec.role
			|| !spec.mediaTypes.includes(claim.mediaType)) {
			throw new TypeError('The staged workflow input does not match its exact slotted custody.');
		}
		const custody = createAssistanceWorkflowCustodyClaimV1({
			custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
			jobId: job.jobId, stageId: request.stageId, slotId: request.slotId,
			claimId: claim.claimId, role: claim.role, mediaType: claim.mediaType,
			byteLength: claim.byteLength, sha256: claim.sha256, maximumByteLength: null,
		});
		job.inputs.set(key, Object.freeze({ custody, claim }));
		return handle(custody);
	}

	async reserveOutput(
		request: AssistanceWorkflowOutputReservationRequest,
	): Promise<AssistanceWorkflowCustodyHandleV1> {
		const job = this.#boundJob(request?.jobId, request?.workflowId);
		const key = bindingKey(request.stageId, request.slotId);
		if (job.outputs.has(key)) throw new Error('That workflow output slot is already reserved.');
		const spec = assistanceWorkflowCustodySlotSpec(
			request.workflowId, request.stageId, 'output', request.slotId,
		);
		const mediaType = request.mediaType ?? spec.mediaTypes[0]!;
		if (!spec.mediaTypes.includes(mediaType)) {
			throw new TypeError('The workflow output media type is incompatible with its slot.');
		}
		const reservation = await this.#staging.reserveOutput({ jobId: job.jobId,
			role: spec.role as AssistanceOutputRole, mediaType,
			maximumByteLength: request.maximumByteLength });
		const custody = createAssistanceWorkflowCustodyClaimV1({
			custodyVersion: 1, workflowId: request.workflowId, direction: 'output',
			jobId: job.jobId, stageId: request.stageId, slotId: request.slotId,
			claimId: reservation.claimId, role: reservation.role, mediaType: reservation.mediaType,
			byteLength: null, sha256: null, maximumByteLength: reservation.maximumByteLength,
		});
		job.outputs.set(key, { custody, reservation, claim: null });
		return handle(custody);
	}

	bindProducer(request: AssistanceWorkflowProducerBindingRequest): AssistanceWorkflowCustodyHandleV1 {
		const job = this.#boundJob(request?.jobId, request?.workflowId);
		const key = bindingKey(request.stageId, request.slotId);
		if (job.inputs.has(key)) throw new Error('That workflow input slot already has custody.');
		const producer = job.outputs.get(bindingKey(request.producerStageId, request.producerSlotId));
		if (!producer || producer.custody.claimId !== request.producerClaimId) {
			throw new Error('The workflow producer claim is not exactly reserved in this job.');
		}
		const custody = createAssistanceWorkflowCustodyClaimV1({
			custodyVersion: 1, workflowId: request.workflowId, direction: 'input',
			jobId: job.jobId, stageId: request.stageId, slotId: request.slotId,
			claimId: producer.custody.claimId, role: producer.custody.role,
			mediaType: producer.custody.mediaType, byteLength: null, sha256: null,
			maximumByteLength: producer.custody.maximumByteLength,
			producer: { stageId: request.producerStageId, slotId: request.producerSlotId,
				claimId: request.producerClaimId },
		});
		job.inputs.set(key, Object.freeze({ custody, claim: null }));
		return handle(custody);
	}

	validateWorkflow(value: unknown): AssistanceWorkflowV1 {
		const request = validateAssistanceWorkflow(value);
		const job = this.#boundJob(request.jobId, request.workflowId);
		assertExactBindings(request.inputs, job.inputs, 'input');
		assertExactBindings(request.outputs, job.outputs, 'output');
		return request;
	}

	resolveStage(stage: AssistanceWorkflowStageBindingV1): AssistanceWorkflowStageCustodyResultV1 {
		const request = this.validateWorkflow(stage?.request);
		if (request.stageIds[stage.stageIndex] !== stage.stage.stageId
			|| stage.stageCount !== request.stageIds.length) {
			throw new TypeError('Workflow custody received an uncorrelated stage binding.');
		}
		return Object.freeze({ outcome: 'resolved',
			custody: createAssistanceWorkflowStageCustodyToken(stage) });
	}

	async resolveInput(
		value: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<{ claim: AssistanceStagedInputClaim | AssistanceOutputClaim; path: string }>> {
		const custody = validateAssistanceWorkflowCustodyClaimV1(value);
		if (custody.direction !== 'input') throw new TypeError('Workflow input custody is required.');
		const job = this.#boundJob(custody.jobId, custody.workflowId);
		const input = job.inputs.get(bindingKey(custody.stageId, custody.slotId));
		if (!input || !sameCustody(input.custody, custody)) {
			throw new Error('The workflow input custody is unknown or stale.');
		}
		if (input.claim) {
			const path = await this.#staging.resolveInputPathForMain(job.jobId, input.claim, signal);
			return Object.freeze({ claim: input.claim, path });
		}
		const producer = custody.producer!;
		const output = job.outputs.get(bindingKey(producer.stageId, producer.slotId));
		if (!output?.claim || output.claim.claimId !== producer.claimId) {
			throw new Error('The workflow producer output is not authenticated yet.');
		}
		const path = await this.#staging.resolveOutputClaimPathForMain(job.jobId, output.claim, signal);
		return Object.freeze({ claim: output.claim, path });
	}

	/** Main-only primitive projection. Producer outputs are re-staged as authenticated inputs. */
	async operationInputClaim(
		value: unknown,
		signal?: AbortSignal,
	): Promise<AssistanceStagedInputClaim> {
		const custody = this.workflowCustodyClaim(value);
		if (custody.direction !== 'input') throw new TypeError('A workflow input claim is required.');
		const job = this.#boundJob(custody.jobId, custody.workflowId);
		const record = job.inputs.get(bindingKey(custody.stageId, custody.slotId));
		if (!record || !sameCustody(record.custody, custody)) {
			throw new Error('The workflow input claim is unknown or stale.');
		}
		if (record.claim) return record.claim;
		const resolved = await this.resolveInput(custody, signal);
		const bytes = createReadStream(resolved.path, { signal }) as AsyncIterable<Uint8Array>;
		return this.#staging.stageInput({ jobId: custody.jobId,
			role: resolved.claim.role as AssistanceInputRole,
			mediaType: resolved.claim.mediaType, byteLength: resolved.claim.byteLength,
			bytes, ...(signal ? { signal } : {}) });
	}

	/** Resolve a workflow-v1 identity to its richer main-only custody token. */
	workflowCustodyClaim(value: unknown): AssistanceWorkflowCustodyClaimV1 {
		const row = dataRecord(value, 'workflow claim');
		const keys = ['claimVersion', 'direction', 'claimId', 'jobId', 'stageId', 'slotId'];
		if (Object.keys(row).length !== keys.length
			|| Object.keys(row).some((key) => !keys.includes(key))) {
			throw new TypeError('The workflow claim schema fields are invalid.');
		}
		const job = this.#job(row.jobId);
		const direction = row.direction;
		if (direction !== 'input' && direction !== 'output') {
			throw new TypeError('The workflow claim direction is invalid.');
		}
		const records = direction === 'input' ? job.inputs : job.outputs;
		const record = records.get(bindingKey(row.stageId, row.slotId));
		if (!record || !sameClaim(row as unknown as AssistanceWorkflowClaimV1,
			workflowClaimFromCustodyV1(record.custody))) {
			throw new Error('The workflow claim has no exact main-owned custody.');
		}
		return record.custody;
	}

	openOutput(value: unknown, signal?: AbortSignal): Promise<string> {
		const output = this.#output(value);
		return this.#staging.resolveOutputReservationPathForMain(
			output.custody.jobId, output.reservation, signal,
		);
	}

	async authenticateOutput(value: unknown, signal?: AbortSignal): Promise<AssistanceOutputClaim> {
		const output = this.#output(value);
		if (output.claim) throw new Error('The workflow output was already authenticated.');
		const claim = await this.#staging.authenticateOutput(
			output.custody.jobId, output.reservation, signal,
		);
		output.claim = claim;
		return claim;
	}

	/** Main-only projection for aggregate stage execution; never expose through preload. */
	outputReservation(value: unknown): AssistanceOutputReservation {
		return this.#output(value).reservation;
	}

	outputReservationForClaim(value: unknown): AssistanceOutputReservation {
		return this.outputReservation(this.workflowCustodyClaim(value));
	}

	/**
	 * Record a claim already authenticated by executeStaged against the shared
	 * registry. Re-resolving its private path proves it is still the exact file.
	 */
	async recordAuthenticatedOutput(
		value: unknown,
		claimValue: unknown,
		signal?: AbortSignal,
	): Promise<AssistanceOutputClaim> {
		const output = this.#output(value);
		if (output.claim) throw new Error('The workflow output was already authenticated.');
		const claim = validateAssistanceOutputClaim(claimValue);
		if (claim.claimId !== output.reservation.claimId || claim.jobId !== output.reservation.jobId
			|| claim.role !== output.reservation.role || claim.mediaType !== output.reservation.mediaType
			|| claim.byteLength > output.reservation.maximumByteLength) {
			throw new TypeError('The authenticated workflow output disagrees with its exact reservation.');
		}
		await this.#staging.resolveOutputClaimPathForMain(
			output.custody.jobId, claim, signal,
		);
		output.claim = claim;
		return claim;
	}

	recordAuthenticatedOutputForClaim(
		value: unknown,
		claimValue: unknown,
		signal?: AbortSignal,
	): Promise<AssistanceOutputClaim> {
		return this.recordAuthenticatedOutput(
			this.workflowCustodyClaim(value), claimValue, signal,
		);
	}

	async releaseJob(jobIdValue: unknown): Promise<boolean> {
		const jobId = opaqueId(jobIdValue);
		const job = this.#jobs.get(jobId);
		if (!job) return false;
		const released = await this.#staging.releaseJob(jobId);
		if (released) { job.inputs.clear(); job.outputs.clear(); this.#jobs.delete(jobId); }
		return released;
	}

	#output(value: unknown): OutputRecord {
		const custody = validateAssistanceWorkflowCustodyClaimV1(value);
		if (custody.direction !== 'output') throw new TypeError('Workflow output custody is required.');
		const job = this.#boundJob(custody.jobId, custody.workflowId);
		const output = job.outputs.get(bindingKey(custody.stageId, custody.slotId));
		if (!output || !sameCustody(output.custody, custody)) {
			throw new Error('The workflow output custody is unknown or stale.');
		}
		return output;
	}

	#boundJob(jobIdValue: unknown, workflowId: AssistanceWorkflowId): JobRecord {
		const job = this.#job(jobIdValue);
		if (job.workflowId !== null && job.workflowId !== workflowId) {
			throw new Error('The workflow custody job is already bound to another recipe.');
		}
		job.workflowId ??= workflowId;
		return job;
	}

	#job(jobIdValue: unknown): JobRecord {
		const jobId = opaqueId(jobIdValue);
		const job = this.#jobs.get(jobId);
		if (!job) throw new Error('The workflow custody job is unknown or released.');
		return job;
	}
}

function handle(custody: AssistanceWorkflowCustodyClaimV1): AssistanceWorkflowCustodyHandleV1 {
	return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
}

function assertExactBindings(
	claims: readonly AssistanceWorkflowClaimV1[],
	records: ReadonlyMap<string, InputRecord | OutputRecord>,
	direction: 'input' | 'output',
): void {
	if (claims.length !== records.size) {
		throw new TypeError(`The workflow ${direction} custody inventory is incomplete or unreferenced.`);
	}
	for (const claim of claims) {
		const record = records.get(bindingKey(claim.stageId, claim.slotId));
		if (!record || !sameClaim(claim, workflowClaimFromCustodyV1(record.custody))) {
			throw new TypeError(`The workflow ${direction} claim has no exact staged custody.`);
		}
	}
}

function sameClaim(left: AssistanceWorkflowClaimV1, right: AssistanceWorkflowClaimV1): boolean {
	return left.claimVersion === right.claimVersion && left.direction === right.direction
		&& left.claimId === right.claimId && left.jobId === right.jobId
		&& left.stageId === right.stageId && left.slotId === right.slotId;
}

function sameCustody(left: AssistanceWorkflowCustodyClaimV1, right: AssistanceWorkflowCustodyClaimV1): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function bindingKey(stageId: unknown, slotId: unknown): string {
	if (typeof stageId !== 'string' || typeof slotId !== 'string') {
		throw new TypeError('Workflow custody stage and slot identities are required.');
	}
	return `${stageId}\0${slotId}`;
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The workflow custody job ID is invalid.');
	}
	return value;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
