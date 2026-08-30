/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned execution and custody boundary for pathless assistance operations. */

import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';

import {
	validateAssistanceOutputClaim,
	type AssistanceOutputClaim,
} from './assistance-data-claims.ts';
import type { SpeakerDiarizationRuntimeAdapter } from './assistance-diarization-runtime.ts';
import {
	executeAssistanceOperationWithRuntimeFamily,
	isAssistanceRuntimeFamilyOperationRequest,
} from './assistance-operation-family-execution.ts';
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
import type { AssistanceShotRuntimeAdapter } from './assistance-shot-runtime.ts';
import type {
	AssistanceRuntimeFamilyOperationAdapter,
} from './assistance-runtime-family-operation-adapter.ts';
import type { AssistanceStagingRegistry } from './assistance-staging-registry.ts';
import type { SpeechModelPaths, SpeechRuntimeAdapter } from './assistance-speech-runtime.ts';
import type { VoiceActivityRuntimeAdapter } from './assistance-vad-runtime.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';

export const ASSISTANCE_OPERATION_BRIDGE_VERSION = 1;
const MAXIMUM_ACTIVE_JOBS = 32;
const REQUIRED_SPEECH_MODEL_ROLES = Object.freeze(['encoder', 'decoder', 'joiner', 'tokens'] as const);
const ERES2NET_MODEL_ROLE = '3dspeaker_speech_eres2net_sv_en_voxceleb_16k';

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
	readonly voiceActivityRuntime?: VoiceActivityRuntimeAdapter;
	readonly diarizationRuntime?: SpeakerDiarizationRuntimeAdapter;
	readonly shotDetectionRuntime?: AssistanceShotRuntimeAdapter;
	readonly additionalRuntime?: AssistanceRuntimeFamilyOperationAdapter;
	readonly onProgress?: (progress: AssistanceOperationProgress) => void;
	readonly mintStreamId?: () => string;
}

export function createAssistanceOperationService(options: AssistanceOperationServiceOptions) {
	const jobs = new Set<string>();
	let pendingJobs = 0;
	const activeRuns = new Map<string, ActiveRun>();
	const mintStreamId = options.mintStreamId ?? (() => randomBytes(20).toString('hex'));

	async function createJob(): Promise<AssistanceOperationJob> {
		if (jobs.size + pendingJobs >= MAXIMUM_ACTIVE_JOBS) {
			throw new Error('The assistance operation job bound is exhausted.');
		}
		pendingJobs += 1;
		try {
			const jobId = await options.registry.createJob();
			jobs.add(jobId);
			return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION, jobId });
		} finally {
			pendingJobs -= 1;
		}
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

	async function executeStaged(
		value: unknown,
		signal: AbortSignal,
	): Promise<AssistanceOperationOutcome> {
		if (!(signal instanceof AbortSignal)) {
			throw new TypeError('Main-owned staged execution requires one cancellation signal.');
		}
		signal.throwIfAborted();
		const request = validateAssistanceOperationRequest(value);
		if (jobs.has(request.jobId)) {
			throw new Error('A renderer-owned operation job cannot enter aggregate staged execution.');
		}
		return execute(request, signal, undefined);
	}

	async function execute(
		request: AssistanceOperationRequest,
		signal: AbortSignal,
		publish: AssistanceOperationServiceOptions['onProgress'] = options.onProgress,
	): Promise<AssistanceOperationOutcome> {
		const emit = progressEmitter(request, publish);
		emit('queued');
		emit('staging-input');
		const inputPaths = await Promise.all(request.inputs.map((claim) =>
			options.registry.resolveInputPathForMain(request.jobId, claim, signal)));
		if (isAssistanceRuntimeFamilyOperationRequest(request)) {
			emit('loading-model');
			if (!options.additionalRuntime) {
				emit('finalizing');
				return unavailable(request, 'adapter-unavailable');
			}
			emit('running');
			const familyResult = await executeAssistanceOperationWithRuntimeFamily({
				request, inputPaths, models: options.models, registry: options.registry,
				runtime: options.additionalRuntime, signal,
				onProgress: (value) => emit('running', value, 1),
			});
			if (familyResult.outcome === 'unavailable') {
				emit('finalizing');
				return unavailable(request, familyResult.reason);
			}
			signal.throwIfAborted();
			emit('staging-output');
			const outputs = await Promise.all(request.outputs.map((reservation) =>
				options.registry.authenticateOutput(request.jobId, reservation, signal)));
			for (const [index, output] of outputs.entries()) {
				const summary = familyResult.outputs[index];
				if (!summary || summary.claimId !== output.claimId || summary.role !== output.role
					|| summary.mediaType !== output.mediaType || summary.byteLength !== output.byteLength
					|| summary.sha256 !== output.sha256) {
					throw new Error('The runtime-family output changed after worker authentication.');
				}
			}
			emit('finalizing');
			const result = validateAssistanceOperationResult({
				contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
				jobId: request.jobId,
				operation: request.operation,
				outputs,
			}, request);
			return Object.freeze({
				contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
				jobId: request.jobId,
				operation: request.operation,
				outcome: 'completed',
				result,
			});
		}
		if (request.operation !== 'speech-recognition' && request.operation !== 'voice-activity-detection'
			&& request.operation !== 'speaker-diarization' && request.operation !== 'shot-detection') {
			emit('finalizing');
			return unavailable(request, 'adapter-unavailable');
		}
		const directInputCountValid = request.operation === 'speech-recognition'
			? request.inputs.filter(({ role }) => role === 'audio').length === 1
				&& request.inputs.filter(({ role }) => role === 'voice-activity').length <= 1
				&& (request.inputs.length === 1 || request.inputs.length === 2)
			: request.inputs.length === 1;
		if (!directInputCountValid || request.outputs.length !== 1) {
			emit('finalizing');
			return unavailable(request, 'adapter-unavailable');
		}
		emit('loading-model');
		let resultBody: unknown | AssistanceOperationUnavailableReason;
		if (request.operation === 'speech-recognition') {
			resultBody = await executeSpeech(request,
				inputPathForRole(request, inputPaths, 'audio'),
				inputPathForRole(request, inputPaths, 'voice-activity', false), signal, emit, options);
		} else if (request.operation === 'voice-activity-detection') {
			resultBody = await executeVoiceActivity(request, inputPaths[0]!, signal, emit, options);
		} else if (request.operation === 'speaker-diarization') {
			resultBody = await executeSpeakerDiarization(request, inputPaths[0]!, signal, emit, options);
		} else {
			resultBody = await executeShotDetection(request, inputPaths[0]!, signal, emit, options);
		}
		if (isUnavailableReason(resultBody)) {
			emit('finalizing');
			return unavailable(request, resultBody);
		}
		signal.throwIfAborted();
		emit('staging-output');
		const reservation = request.outputs[0]!;
		const outputPath = await options.registry.resolveOutputReservationPathForMain(
			request.jobId, reservation, signal,
		);
		const body = Buffer.from(JSON.stringify(resultBody), 'utf8');
		if (body.byteLength < 1 || body.byteLength > reservation.maximumByteLength) {
			throw new RangeError('The assistance result exceeds its exact output reservation.');
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
		// The id is surrendered before the removal is attempted, as the run failure
		// path does: a release that throws must not leave the job counted against
		// the admission bound for the rest of the process.
		jobs.delete(jobId);
		await options.registry.releaseJob(jobId);
		return cancellation(jobId, 'cancelled');
	}

	async function release(jobId: string): Promise<boolean> {
		if (!jobs.has(jobId)) return false;
		const active = activeRuns.get(jobId);
		active?.controller.abort(new AssistanceOperationCancelledError(jobId));
		if (active) await active.quiesced;
		jobs.delete(jobId);
		await options.registry.releaseJob(jobId);
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
		stageInput, reserveOutput, run, executeStaged, cancel, release, openOutput, dispose });
}

type ProgressEmitter = (
	phase: AssistanceOperationProgress['phase'], completed?: number, total?: number,
) => void;

async function executeSpeech(
	request: AssistanceOperationRequest,
	audioPath: string,
	voiceActivityPath: string | undefined,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const resolved = await resolveInstalledModels(request, options.models, ['speech-recognition']);
	if (resolved === null) return 'model-unavailable';
	const model = speechModelPaths(resolved[0]!.paths);
	if (model === null) return 'model-unavailable';
	const runtimeStatus = await options.runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return options.runtime.recognize({
		modelId: request.models[0]!.modelId, audioPath, voiceActivityPath, model, signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'audio',
): string;
function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'voice-activity',
	required: false,
): string | undefined;
function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'audio' | 'voice-activity',
	required = true,
): string | undefined {
	const index = request.inputs.findIndex((claim) => claim.role === role);
	if (index < 0) {
		if (!required) return undefined;
		throw new TypeError(`The assistance operation omitted its ${role} input path.`);
	}
	const path = inputPaths[index];
	if (typeof path !== 'string' || path === '') {
		throw new TypeError(`The assistance operation has an invalid ${role} input path.`);
	}
	return path;
}

async function executeVoiceActivity(
	request: AssistanceOperationRequest,
	audioPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const runtime = options.voiceActivityRuntime;
	if (!runtime) return 'adapter-unavailable';
	const resolved = await resolveInstalledModels(request, options.models, ['voice-activity-detection']);
	const modelPath = resolved?.[0]?.paths.silero_vad;
	if (typeof modelPath !== 'string' || modelPath === '') {
		return 'model-unavailable';
	}
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return runtime.detect({
		modelId: request.models[0]!.modelId, audioPath,
		model: { model: modelPath }, signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

async function executeSpeakerDiarization(
	request: AssistanceOperationRequest,
	audioPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const runtime = options.diarizationRuntime;
	if (!runtime) return 'adapter-unavailable';
	const resolved = await resolveInstalledModels(request, options.models,
		['speaker-segmentation', 'speaker-embedding']);
	const segmentation = resolved?.[0];
	const embedding = resolved?.[1];
	const segmentationPath = segmentation?.paths.model;
	const embeddingPath = embedding?.paths[ERES2NET_MODEL_ROLE];
	if (!segmentation || !embedding || typeof segmentationPath !== 'string' || segmentationPath === ''
		|| typeof embeddingPath !== 'string' || embeddingPath === '') return 'model-unavailable';
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return runtime.diarize({
		audioPath,
		modelIds: {
			segmentation: segmentation.binding.modelId,
			embedding: embedding.binding.modelId,
		},
		models: { segmentation: segmentationPath, embedding: embeddingPath },
		signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

async function executeShotDetection(
	request: AssistanceOperationRequest,
	videoPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	if (request.models.length !== 0) {
		throw new TypeError('shot-detection does not accept model bindings.');
	}
	const runtime = options.shotDetectionRuntime;
	if (!runtime) return 'adapter-unavailable';
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return (await runtime.detect({ videoPath, signal })) ?? 'runtime-unavailable';
}

function speechModelPaths(resolved: Readonly<Record<string, string>>): SpeechModelPaths | null {
	for (const role of REQUIRED_SPEECH_MODEL_ROLES) {
		if (typeof resolved[role] !== 'string' || resolved[role] === '') return null;
	}
	return Object.freeze({
		encoder: resolved.encoder!, decoder: resolved.decoder!, joiner: resolved.joiner!, tokens: resolved.tokens!,
	});
}

interface ResolvedOperationModel {
	readonly binding: AssistanceOperationRequest['models'][number];
	readonly paths: Readonly<Record<string, string>>;
}

async function resolveInstalledModels(
	request: AssistanceOperationRequest,
	models: AssistanceOperationServiceOptions['models'],
	tasks: readonly string[],
): Promise<readonly ResolvedOperationModel[] | null> {
	if (request.models.length !== tasks.length) {
		throw new TypeError(`${request.operation} requires ${tasks.length} exact model binding(s).`);
	}
	const [status, installedModels] = await Promise.all([models.status(), models.listInstalled()]);
	const used = new Set<string>();
	const resolved: ResolvedOperationModel[] = [];
	for (const task of tasks) {
		const candidates = request.models.filter((binding) => status.models.some((view) => (
			view.modelId === binding.modelId && view.task === task && view.version === binding.version
			&& view.availability === 'installed'
		)));
		if (candidates.length !== 1 || used.has(candidates[0]!.modelId)) return null;
		const binding = candidates[0]!;
		used.add(binding.modelId);
		const installed = installedModels.find(({ modelId }) => modelId === binding.modelId);
		if (!installed || installed.version !== binding.version) return null;
		const actualDigests = installed.artifacts.map(({ sha256 }) => sha256).sort();
		if (actualDigests.length !== binding.artifactSha256s.length
			|| actualDigests.some((digest, index) => digest !== binding.artifactSha256s[index])) {
			throw new Error('The assistance model binding disagrees with its authenticated artifact inventory.');
		}
		let paths: Record<string, string>;
		try { paths = await models.resolveModelPaths(binding.modelId); }
		catch (error) { if (modelEvidenceUnavailable(error)) return null; throw error; }
		resolved.push(Object.freeze({ binding, paths: Object.freeze({ ...paths }) }));
	}
	return Object.freeze(resolved);
}

function unavailable(
	request: AssistanceOperationRequest,
	reason: AssistanceOperationUnavailableReason,
): AssistanceOperationOutcome {
	return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
		jobId: request.jobId, operation: request.operation, outcome: 'unavailable', reason });
}

function isUnavailableReason(value: unknown): value is AssistanceOperationUnavailableReason {
	return value === 'adapter-unavailable' || value === 'runtime-unavailable'
		|| value === 'model-unavailable';
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
