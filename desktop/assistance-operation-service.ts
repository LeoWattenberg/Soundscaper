/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned execution and custody boundary for pathless assistance operations. */

import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';

import {
	validateAssistanceOutputClaim,
	type AssistanceOutputClaim,
} from './assistance-data-claims.ts';
import {
	ASSISTANCE_OPERATION_CONTRACT_VERSION,
	AssistanceOperationProgressTracker,
	validateAssistanceOperationRequest,
	validateAssistanceOperationResult,
	type AssistanceOperationProgress,
	type AssistanceOperationRequest,
	type AssistanceOperationResult,
} from './assistance-operation-contract.ts';
import type { AssistanceService } from './assistance-service.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { SpeechModelPaths, SpeechRuntimeAdapter } from './assistance-speech-runtime.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';

export const ASSISTANCE_OPERATION_BRIDGE_VERSION = 1;
const MAXIMUM_ACTIVE_JOBS = 32;
const REQUIRED_SPEECH_MODEL_ROLES = Object.freeze(['encoder', 'decoder', 'joiner', 'tokens'] as const);

export interface AssistanceOperationJob {
	readonly contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
	readonly jobId: string;
}

export interface AssistanceOperationModelChoice {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly artifactSha256s: readonly string[];
}

export type AssistanceOperationUnavailableReason =
	| 'adapter-unavailable'
	| 'runtime-unavailable'
	| 'model-unavailable';

export type AssistanceOperationOutcome =
	| Readonly<{
		contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
		jobId: string;
		operation: AssistanceOperationRequest['operation'];
		outcome: 'completed';
		result: AssistanceOperationResult;
	}>
	| Readonly<{
		contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
		jobId: string;
		operation: AssistanceOperationRequest['operation'];
		outcome: 'unavailable';
		reason: AssistanceOperationUnavailableReason;
	}>;

export interface AssistanceOperationCancellation {
	readonly contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
	readonly jobId: string;
	readonly outcome: 'cancelled' | 'not-active';
}

export interface AssistanceOperationOutputRead {
	readonly binding: HelperDataPlaneBinding;
	/** Main-only path; IPC must project only binding. */
	readonly path: string;
}

export class AssistanceOperationCancelledError extends Error {
	readonly code = 'ASSISTANCE_OPERATION_CANCELLED';
	readonly jobId: string;

	constructor(jobId: string, options: ErrorOptions = {}) {
		super('The assistance operation was cancelled.', options);
		this.name = 'AssistanceOperationCancelledError';
		this.jobId = jobId;
	}
}

interface ActiveRun {
	readonly controller: AbortController;
	readonly quiesced: Promise<void>;
}

export interface AssistanceOperationServiceOptions {
	readonly registry: AssistanceStagingRegistry;
	readonly models: Pick<AssistanceService, 'status' | 'listInstalled' | 'resolveModelPaths'>;
	readonly runtime: SpeechRuntimeAdapter;
	readonly onProgress?: (progress: AssistanceOperationProgress) => void;
	readonly mintStreamId?: () => string;
}

export function createAssistanceOperationService(options: AssistanceOperationServiceOptions) {
	const jobs = new Set<string>();
	const activeRuns = new Map<string, ActiveRun>();
	const mintStreamId = options.mintStreamId ?? (() => randomBytes(20).toString('hex'));

	async function createJob(): Promise<AssistanceOperationJob> {
		if (jobs.size >= MAXIMUM_ACTIVE_JOBS) throw new Error('The assistance operation job bound is exhausted.');
		const jobId = await options.registry.createJob();
		jobs.add(jobId);
		return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION, jobId });
	}

	async function models(): Promise<readonly AssistanceOperationModelChoice[]> {
		const [status, installed] = await Promise.all([options.models.status(), options.models.listInstalled()]);
		const installations = new Map(installed.map((model) => [model.modelId, model]));
		const choices: AssistanceOperationModelChoice[] = [];
		for (const view of status.models) {
			if (view.availability !== 'installed') continue;
			const installation = installations.get(view.modelId);
			if (!installation || installation.version !== view.version) continue;
			try { await options.models.resolveModelPaths(view.modelId); }
			catch (error) { if (modelChoiceEvidenceUnavailable(error)) continue; throw error; }
			choices.push(Object.freeze({ modelId: view.modelId, version: view.version, task: view.task,
				artifactSha256s: Object.freeze(installation.artifacts.map(({ sha256 }) => sha256).sort()) }));
		}
		return Object.freeze(choices);
	}

	function assertOwnedJob(jobId: string): void {
		if (!jobs.has(jobId)) throw new Error('The assistance operation job is unknown or released.');
	}

	function stageInput(request: Parameters<AssistanceStagingRegistry['stageInput']>[0]) {
		assertOwnedJob(request?.jobId);
		return options.registry.stageInput(request);
	}

	function reserveOutput(request: Parameters<AssistanceStagingRegistry['reserveOutput']>[0]) {
		assertOwnedJob(request?.jobId);
		return options.registry.reserveOutput(request);
	}

	async function run(value: unknown): Promise<AssistanceOperationOutcome> {
		const request = validateAssistanceOperationRequest(value);
		assertOwnedJob(request.jobId);
		if (activeRuns.has(request.jobId)) throw new Error('This assistance operation job is already running.');
		const controller = new AbortController();
		const execution = execute(request, controller.signal);
		const quiesced = execution.then(() => undefined, () => undefined);
		const active = Object.freeze({ controller, quiesced });
		activeRuns.set(request.jobId, active);
		try {
			return await execution;
		} catch (error) {
			if (controller.signal.aborted) {
				throw new AssistanceOperationCancelledError(request.jobId, { cause: controller.signal.reason ?? error });
			}
			jobs.delete(request.jobId);
			await options.registry.releaseJob(request.jobId).catch(() => undefined);
			throw error;
		} finally {
			if (activeRuns.get(request.jobId) === active) activeRuns.delete(request.jobId);
		}
	}

	async function execute(
		request: AssistanceOperationRequest,
		signal: AbortSignal,
	): Promise<AssistanceOperationOutcome> {
		const emit = progressEmitter(request, options.onProgress);
		emit('queued');
		emit('staging-input');
		const inputPaths = await Promise.all(request.inputs.map((claim) =>
			options.registry.resolveInputPathForMain(request.jobId, claim, signal)));
		if (request.operation !== 'speech-recognition') {
			emit('finalizing');
			return unavailable(request, 'adapter-unavailable');
		}
		if (request.inputs.length !== 1 || request.outputs.length !== 1) {
			emit('finalizing');
			return unavailable(request, 'adapter-unavailable');
		}
		emit('loading-model');
		const model = await resolveSpeechModel(request, options.models);
		if (model === null) { emit('finalizing'); return unavailable(request, 'model-unavailable'); }
		const runtimeStatus = await options.runtime.status();
		if (!runtimeStatus.available) { emit('finalizing'); return unavailable(request, 'runtime-unavailable'); }
		emit('running');
		const recognized = await options.runtime.recognize({
			modelId: request.models[0]!.modelId,
			audioPath: inputPaths[0]!,
			model,
			signal,
			onProgress: ({ completed, total }) => emit('running', completed, total),
		});
		signal.throwIfAborted();
		emit('staging-output');
		const reservation = request.outputs[0]!;
		const outputPath = await options.registry.resolveOutputReservationPathForMain(
			request.jobId, reservation, signal,
		);
		const body = Buffer.from(JSON.stringify(recognized), 'utf8');
		if (body.byteLength < 1 || body.byteLength > reservation.maximumByteLength) {
			throw new RangeError('The assistance transcript exceeds its exact output reservation.');
		}
		const handle = await open(outputPath, 'r+');
		try { await handle.truncate(0); await handle.writeFile(body); await handle.sync(); }
		finally { await handle.close(); }
		const output = await options.registry.authenticateOutput(request.jobId, reservation, signal);
		emit('finalizing');
		const result = validateAssistanceOperationResult({
			contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
			jobId: request.jobId,
			operation: request.operation,
			outputs: [output],
		}, request);
		return Object.freeze({
			contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
			jobId: request.jobId,
			operation: request.operation,
			outcome: 'completed',
			result,
		});
	}

	async function cancel(jobId: string): Promise<AssistanceOperationCancellation> {
		if (!jobs.has(jobId)) return cancellation(jobId, 'not-active');
		const active = activeRuns.get(jobId);
		active?.controller.abort(new AssistanceOperationCancelledError(jobId));
		if (active) await active.quiesced;
		await options.registry.releaseJob(jobId);
		jobs.delete(jobId);
		return cancellation(jobId, 'cancelled');
	}

	async function release(jobId: string): Promise<boolean> {
		if (!jobs.has(jobId)) return false;
		const active = activeRuns.get(jobId);
		active?.controller.abort(new AssistanceOperationCancelledError(jobId));
		if (active) await active.quiesced;
		await options.registry.releaseJob(jobId);
		jobs.delete(jobId);
		return true;
	}

	async function openOutput(value: Readonly<{ jobId: string; claim: unknown }>): Promise<AssistanceOperationOutputRead> {
		assertOwnedJob(value?.jobId);
		const claim: AssistanceOutputClaim = validateAssistanceOutputClaim(value.claim);
		const path = await options.registry.resolveOutputClaimPathForMain(value.jobId, claim);
		return Object.freeze({ path, binding: Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			transport: 'message-port', streamId: mintStreamId(), direction: 'helper-to-host',
			byteLength: claim.byteLength, sha256: claim.sha256,
			maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
		}) });
	}

	async function dispose(): Promise<void> {
		await Promise.all([...jobs].map((jobId) => release(jobId)));
	}

	return Object.freeze({ models, createJob, assertJob: assertOwnedJob,
		stageInput, reserveOutput, run, cancel, release, openOutput, dispose });
}

async function resolveSpeechModel(
	request: AssistanceOperationRequest,
	models: AssistanceOperationServiceOptions['models'],
): Promise<SpeechModelPaths | null> {
	if (request.models.length !== 1) throw new TypeError('Speech recognition requires one exact model binding.');
	const binding = request.models[0]!;
	const status = await models.status();
	const view = status.models.find(({ modelId }) => modelId === binding.modelId);
	if (!view || view.task !== 'speech-recognition' || view.version !== binding.version
		|| view.availability !== 'installed') return null;
	const installed = (await models.listInstalled()).find(({ modelId }) => modelId === binding.modelId);
	if (!installed || installed.version !== binding.version) return null;
	const actualDigests = installed.artifacts.map(({ sha256 }) => sha256).sort();
	if (actualDigests.length !== binding.artifactSha256s.length
		|| actualDigests.some((digest, index) => digest !== binding.artifactSha256s[index])) {
		throw new Error('The assistance model binding disagrees with its authenticated artifact inventory.');
	}
	let resolved: Record<string, string>;
	try { resolved = await models.resolveModelPaths(binding.modelId); }
	catch (error) { if (modelEvidenceUnavailable(error)) return null; throw error; }
	for (const role of REQUIRED_SPEECH_MODEL_ROLES) {
		if (typeof resolved[role] !== 'string' || resolved[role] === '') {
			return null;
		}
	}
	return Object.freeze({
		encoder: resolved.encoder!, decoder: resolved.decoder!, joiner: resolved.joiner!, tokens: resolved.tokens!,
	});
}

function unavailable(
	request: AssistanceOperationRequest,
	reason: AssistanceOperationUnavailableReason,
): AssistanceOperationOutcome {
	return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
		jobId: request.jobId, operation: request.operation, outcome: 'unavailable', reason });
}

function cancellation(jobId: string, outcome: AssistanceOperationCancellation['outcome']): AssistanceOperationCancellation {
	return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION, jobId, outcome });
}

function progressEmitter(
	request: AssistanceOperationRequest,
	publish: AssistanceOperationServiceOptions['onProgress'],
): (phase: AssistanceOperationProgress['phase'], completed?: number, total?: number) => void {
	const tracker = new AssistanceOperationProgressTracker(request);
	let sequence = 0;
	return (phase, completed, total): void => {
		const progress = tracker.accept({
			contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
			jobId: request.jobId, operation: request.operation, sequence, phase,
			completed: completed ?? null, total: total ?? null,
		});
		sequence += 1;
		publish?.(progress);
	};
}

function modelEvidenceUnavailable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /is not installed/u.test(error.message);
}

function modelChoiceEvidenceUnavailable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /is not installed|does not match the current authenticated catalog entry|failed its integrity check/u
		.test(error.message);
}
