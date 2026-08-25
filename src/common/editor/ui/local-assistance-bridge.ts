/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer-owned projection of the pathless desktop inference bridge. */

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';

export const LOCAL_ASSISTANCE_PROGRESS_PHASES = Object.freeze([
	'queued', 'staging-input', 'loading-model', 'running', 'staging-output', 'finalizing',
] as const);
export const LOCAL_ASSISTANCE_UNAVAILABLE_REASONS = Object.freeze([
	'adapter-unavailable', 'runtime-unavailable', 'model-unavailable',
] as const);

export type LocalAssistanceProgressPhase = typeof LOCAL_ASSISTANCE_PROGRESS_PHASES[number];
export type LocalAssistanceUnavailableReason = typeof LOCAL_ASSISTANCE_UNAVAILABLE_REASONS[number];
export type LocalAssistanceInputRole =
	| 'audio' | 'video' | 'frame-pack' | 'transcript' | 'text' | 'editorial-context';
export type LocalAssistanceOutputRole =
	| 'voice-activity' | 'transcript' | 'word-alignment' | 'speaker-turns'
	| 'enhanced-audio' | 'separated-audio' | 'audio-tags' | 'beat-grid' | 'embeddings'
	| 'recognized-text' | 'shot-boundaries' | 'subject-tracks' | 'saliency-map'
	| 'editorial-proposal';

export interface LocalAssistanceModel {
	readonly modelId: string;
	readonly version: string;
	readonly task: string;
	readonly artifactSha256s: readonly string[];
}

export interface LocalAssistanceInputClaim {
	readonly claimVersion: 1;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: LocalAssistanceInputRole;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface LocalAssistanceOutputReservation {
	readonly claimVersion: 1;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: LocalAssistanceOutputRole;
	readonly mediaType: string;
	readonly maximumByteLength: number;
}

export interface LocalAssistanceOutputClaim {
	readonly claimVersion: 1;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: LocalAssistanceOutputRole;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface LocalAssistanceRunRequest {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly operation: AssistanceOperation;
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly Readonly<Pick<LocalAssistanceModel,
		'modelId' | 'version' | 'artifactSha256s'>>[];
	readonly inputs: readonly LocalAssistanceInputClaim[];
	readonly outputs: readonly LocalAssistanceOutputReservation[];
}

export interface LocalAssistanceProgress {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly operation: AssistanceOperation;
	readonly sequence: number;
	readonly phase: LocalAssistanceProgressPhase;
	readonly completed: number | null;
	readonly total: number | null;
}

export type LocalAssistanceRunOutcome = Readonly<{
	contractVersion: 1;
	jobId: string;
	operation: AssistanceOperation;
	outcome: 'completed';
	result: Readonly<{
		contractVersion: 1;
		jobId: string;
		operation: AssistanceOperation;
		outputs: readonly LocalAssistanceOutputClaim[];
	}>;
}> | Readonly<{
	contractVersion: 1;
	jobId: string;
	operation: AssistanceOperation;
	outcome: 'unavailable';
	reason: LocalAssistanceUnavailableReason;
}>;

export interface LocalAssistanceBridge {
	models(): Promise<readonly LocalAssistanceModel[]>;
	createJob(): Promise<Readonly<{ contractVersion: 1; jobId: string }>>;
	stageInput(value: Readonly<{ jobId: string; role: LocalAssistanceInputRole;
		mediaType: string; byteLength: number; bytes: Blob }>): Promise<LocalAssistanceInputClaim>;
	reserveOutput(value: Readonly<{ jobId: string; role: LocalAssistanceOutputRole;
		mediaType: string; maximumByteLength: number }>): Promise<LocalAssistanceOutputReservation>;
	run(value: LocalAssistanceRunRequest): Promise<LocalAssistanceRunOutcome>;
	cancel(jobId: string): Promise<Readonly<{ contractVersion: 1; jobId: string;
		outcome: 'cancelled' | 'not-active' }>>;
	readOutput(value: Readonly<{ jobId: string; claim: LocalAssistanceOutputClaim }>): Promise<Blob>;
	release(jobId: string): Promise<boolean>;
	onProgress(listener: (progress: LocalAssistanceProgress) => void): () => void;
}

const API_METHODS = Object.freeze([
	'models', 'createJob', 'stageInput', 'reserveOutput', 'run', 'cancel',
	'readOutput', 'release', 'onProgress',
] as const);
const JOB_ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MEDIA_TYPE = /^[a-z\d][a-z\d!#$&^_.+-]{0,126}\/[a-z\d][a-z\d!#$&^_.+-]{0,126}$/u;
const INPUT_ROLES = Object.freeze([
	'audio', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);
const OUTPUT_ROLES = Object.freeze([
	'voice-activity', 'transcript', 'word-alignment', 'speaker-turns', 'enhanced-audio',
	'separated-audio', 'audio-tags', 'beat-grid', 'embeddings', 'recognized-text',
	'shot-boundaries', 'subject-tracks', 'saliency-map', 'editorial-proposal',
] as const);
const INPUT_MEDIA_TYPES: Readonly<Record<LocalAssistanceInputRole, readonly string[]>> = Object.freeze({
	audio: Object.freeze(['audio/wav', 'audio/x-wav', 'audio/flac']),
	video: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	transcript: Object.freeze(['application/json', 'application/vnd.soundscaper.transcript+json']),
	text: Object.freeze(['text/plain']),
	'editorial-context': Object.freeze(['application/json', 'application/vnd.soundscaper.editorial-context+json']),
});
const OUTPUT_MEDIA_TYPES: Readonly<Record<LocalAssistanceOutputRole, readonly string[]>> = Object.freeze({
	'voice-activity': jsonTypes('voice-activity'), transcript: jsonTypes('transcript'),
	'word-alignment': jsonTypes('word-alignment'), 'speaker-turns': jsonTypes('speaker-turns'),
	'enhanced-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'separated-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'audio-tags': jsonTypes('audio-tags'), 'beat-grid': jsonTypes('beat-grid'),
	embeddings: jsonTypes('embeddings'), 'recognized-text': jsonTypes('recognized-text'),
	'shot-boundaries': jsonTypes('shot-boundaries'), 'subject-tracks': jsonTypes('subject-tracks'),
	'saliency-map': jsonTypes('saliency-map'), 'editorial-proposal': jsonTypes('editorial-proposal'),
});
const OPERATION_ROLES = Object.freeze({
	'voice-activity-detection': roles(['audio'], [['audio']], ['voice-activity']),
	'speech-recognition': roles(['audio'], [['audio']], ['transcript']),
	'word-alignment': roles(['audio', 'transcript'], [['audio'], ['transcript']], ['word-alignment']),
	'speaker-diarization': roles(['audio'], [['audio']], ['speaker-turns']),
	'speech-enhancement': roles(['audio'], [['audio']], ['enhanced-audio']),
	'source-separation': roles(['audio'], [['audio']], ['separated-audio']),
	'audio-tagging': roles(['audio'], [['audio']], ['audio-tags']),
	'beat-tracking': roles(['audio'], [['audio']], ['beat-grid']),
	'text-embedding': roles(['transcript', 'text'], [['transcript', 'text']], ['embeddings']),
	'image-text-embedding': roles(['frame-pack', 'text'], [['frame-pack', 'text']], ['embeddings']),
	'optical-character-recognition': roles(['frame-pack'], [['frame-pack']], ['recognized-text']),
	'shot-detection': roles(['video'], [['video']], ['shot-boundaries']),
	'subject-detection': roles(['frame-pack'], [['frame-pack']], ['subject-tracks']),
	'saliency-detection': roles(['frame-pack'], [['frame-pack']], ['saliency-map']),
	'editorial-generation': roles(['editorial-context'], [['editorial-context']], ['editorial-proposal']),
} satisfies Readonly<Record<AssistanceOperation, Readonly<{
	inputs: readonly LocalAssistanceInputRole[];
	required: readonly (readonly LocalAssistanceInputRole[])[];
	outputs: readonly LocalAssistanceOutputRole[];
}>>>);
const MAXIMUM_BYTES = 8 * 1024 * 1024 * 1024;

export function resolveLocalAssistanceBridge(value: unknown): LocalAssistanceBridge | null {
	if (!isRecord(value) || !isRecord(value.localAssistance)) return null;
	const candidate = value.localAssistance;
	const keys = Object.keys(candidate);
	if (keys.length !== API_METHODS.length || keys.some((key) => !API_METHODS.includes(
		key as typeof API_METHODS[number],
	)) || API_METHODS.some((method) => typeof candidate[method] !== 'function')) return null;

	const invoke = (method: typeof API_METHODS[number], ...args: readonly unknown[]) =>
		(candidate[method] as (...values: readonly unknown[]) => unknown).apply(candidate, [...args]);
	const bridge: LocalAssistanceBridge = Object.freeze({
		async models() {
			return normalizeModels(await invoke('models'));
		},
		async createJob() {
			const record = exactRecord(await invoke('createJob'), ['contractVersion', 'jobId'], 'job');
			contract(record);
			return Object.freeze({ contractVersion: 1 as const, jobId: jobId(record.jobId) });
		},
		async stageInput(value: Parameters<LocalAssistanceBridge['stageInput']>[0]) {
			const request = normalizeStageInput(value);
			const sha256 = await blobSha256(request.bytes);
			const claim = normalizeInputClaim(await invoke('stageInput', Object.freeze({
				jobId: request.jobId, role: request.role, mediaType: request.mediaType, sha256,
				bytes: request.bytes,
			})));
			if (claim.jobId !== request.jobId || claim.role !== request.role
				|| claim.mediaType !== request.mediaType || claim.byteLength !== request.byteLength) {
				throw new TypeError('The staged input claim disagrees with its exact Blob request.');
			}
			if (sha256 !== claim.sha256) {
				throw new TypeError('The staged input claim digest disagrees with its Blob body.');
			}
			return claim;
		},
		async reserveOutput(value: Parameters<LocalAssistanceBridge['reserveOutput']>[0]) {
			const request = normalizeReserveOutput(value);
			const reservation = normalizeOutputReservation(await invoke('reserveOutput', request));
			if (reservation.jobId !== request.jobId || reservation.role !== request.role
				|| reservation.mediaType !== request.mediaType
				|| reservation.maximumByteLength !== request.maximumByteLength) {
				throw new TypeError('The output reservation disagrees with its exact request.');
			}
			return reservation;
		},
		async run(value: LocalAssistanceRunRequest) {
			const request = normalizeRunRequest(value);
			return normalizeRunOutcome(await invoke('run', request), request);
		},
		async cancel(value: string) {
			const expectedJobId = jobId(value);
			const record = exactRecord(await invoke('cancel', expectedJobId),
				['contractVersion', 'jobId', 'outcome'], 'cancellation');
			contract(record);
			if (jobId(record.jobId) !== expectedJobId
				|| (record.outcome !== 'cancelled' && record.outcome !== 'not-active')) {
				throw new TypeError('The assistance cancellation is not correlated.');
			}
			return Object.freeze({ contractVersion: 1 as const, jobId: expectedJobId,
				outcome: record.outcome });
		},
		async readOutput(value: Parameters<LocalAssistanceBridge['readOutput']>[0]) {
			const record = exactRecord(value, ['jobId', 'claim'], 'output read request');
			const expectedJobId = jobId(record.jobId);
			const claim = normalizeOutputClaim(record.claim);
			if (claim.jobId !== expectedJobId) throw new TypeError('The output read is not job-bound.');
			const body = await invoke('readOutput', Object.freeze({ jobId: expectedJobId, claim }));
			if (!(body instanceof Blob) || body.size !== claim.byteLength
				|| (body.type !== '' && body.type !== claim.mediaType)
				|| await blobSha256(body) !== claim.sha256) {
				throw new TypeError('The output Blob disagrees with its authenticated claim.');
			}
			return body;
		},
		async release(value: string) {
			const released = await invoke('release', jobId(value));
			if (typeof released !== 'boolean') throw new TypeError('The assistance release result is invalid.');
			return released;
		},
		onProgress(listener: (progress: LocalAssistanceProgress) => void) {
			if (typeof listener !== 'function') throw new TypeError('An assistance progress listener is required.');
			const unsubscribe = invoke('onProgress', (value: unknown) => {
				try { listener(normalizeProgress(value)); } catch { /* Reject malformed desktop events. */ }
			});
			if (typeof unsubscribe !== 'function') throw new TypeError('The progress bridge needs an unsubscribe function.');
			return () => { (unsubscribe as () => void)(); };
		},
	});
	return bridge;
}

export function normalizeModels(value: unknown): readonly LocalAssistanceModel[] {
	if (!Array.isArray(value) || value.length > 256) throw new TypeError('The assistance model inventory is invalid.');
	const seen = new Set<string>();
	const models = value.map((candidate) => {
		const record = exactRecord(candidate, ['modelId', 'version', 'task', 'artifactSha256s'], 'model');
		const modelIdValue = boundedModelId(record.modelId);
		if (seen.has(modelIdValue)) throw new TypeError('The assistance model inventory repeats an identity.');
		seen.add(modelIdValue);
		if (!Array.isArray(record.artifactSha256s) || record.artifactSha256s.length < 1
			|| record.artifactSha256s.length > 64) throw new TypeError('A model needs authenticated artifacts.');
		const artifactSha256s = Object.freeze(record.artifactSha256s.map(digest));
		if (new Set(artifactSha256s).size !== artifactSha256s.length) {
			throw new TypeError('A model repeats an authenticated artifact.');
		}
		return Object.freeze({ modelId: modelIdValue, version: text(record.version, 64, 'model version'),
			task: text(record.task, 64, 'model task'), artifactSha256s });
	});
	return Object.freeze(models);
}

export function normalizeProgress(value: unknown): LocalAssistanceProgress {
	const record = exactRecord(value, [
		'contractVersion', 'jobId', 'operation', 'sequence', 'phase', 'completed', 'total',
	], 'progress');
	contract(record);
	if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0) {
		throw new TypeError('An assistance progress sequence is invalid.');
	}
	if (!LOCAL_ASSISTANCE_PROGRESS_PHASES.includes(record.phase as LocalAssistanceProgressPhase)) {
		throw new TypeError('An assistance progress phase is invalid.');
	}
	const completed = nullableUnit(record.completed, 'completed progress');
	const total = nullableUnit(record.total, 'total progress');
	if ((completed === null) !== (total === null) || (completed !== null && completed > (total ?? 0))) {
		throw new TypeError('Assistance progress units are inconsistent.');
	}
	return Object.freeze({ contractVersion: 1, jobId: jobId(record.jobId),
		operation: normalizeAssistanceOperation(record.operation), sequence: Number(record.sequence),
		phase: record.phase as LocalAssistanceProgressPhase, completed, total });
}

function normalizeRunRequest(value: unknown): LocalAssistanceRunRequest {
	const record = exactRecord(value, [
		'contractVersion', 'jobId', 'operation', 'selectionFence', 'models', 'inputs', 'outputs',
	], 'operation request');
	contract(record);
	const operation = normalizeAssistanceOperation(record.operation);
	const expectedJobId = jobId(record.jobId);
	const models = normalizeRunModels(record.models, operation);
	const inputs = boundedArray(record.inputs, 64, 'input claims').map(normalizeInputClaim);
	const outputs = boundedArray(record.outputs, 64, 'output reservations').map(normalizeOutputReservation);
	if (inputs.length < 1 || outputs.length < 1
		|| [...inputs, ...outputs].some((claim) => claim.jobId !== expectedJobId)) {
		throw new TypeError('An assistance operation needs exact job-bound input and output claims.');
	}
	assertOperationRoles(operation, inputs, outputs);
	return Object.freeze({ contractVersion: 1, jobId: expectedJobId, operation,
		selectionFence: validateAssistanceSelectionFence(record.selectionFence), models,
		inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) });
}

function normalizeRunOutcome(value: unknown, request: LocalAssistanceRunRequest): LocalAssistanceRunOutcome {
	const record = isRecord(value) ? value : {};
	if (record.outcome === 'unavailable') {
		const exact = exactRecord(value, ['contractVersion', 'jobId', 'operation', 'outcome', 'reason'], 'outcome');
		correlate(exact, request);
		if (!LOCAL_ASSISTANCE_UNAVAILABLE_REASONS.includes(exact.reason as LocalAssistanceUnavailableReason)) {
			throw new TypeError('The assistance unavailable reason is invalid.');
		}
		return Object.freeze({ contractVersion: 1, jobId: request.jobId, operation: request.operation,
			outcome: 'unavailable', reason: exact.reason as LocalAssistanceUnavailableReason });
	}
	const exact = exactRecord(value, ['contractVersion', 'jobId', 'operation', 'outcome', 'result'], 'outcome');
	correlate(exact, request);
	if (exact.outcome !== 'completed') throw new TypeError('The assistance outcome is invalid.');
	const result = exactRecord(exact.result, ['contractVersion', 'jobId', 'operation', 'outputs'], 'result');
	correlate(result, request);
	const reservations = new Map(request.outputs.map((item) => [item.claimId, item]));
	const outputs = boundedArray(result.outputs, 64, 'output claims').map((candidate) => {
		const claim = normalizeOutputClaim(candidate);
		const reservation = reservations.get(claim.claimId);
		if (!reservation || claim.jobId !== reservation.jobId || claim.role !== reservation.role
			|| claim.mediaType !== reservation.mediaType || claim.byteLength > reservation.maximumByteLength) {
			throw new TypeError('An assistance output claim disagrees with its reservation.');
		}
		reservations.delete(claim.claimId);
		return claim;
	});
	if (reservations.size !== 0) throw new TypeError('The assistance result omitted a reserved output.');
	return Object.freeze({ contractVersion: 1, jobId: request.jobId, operation: request.operation,
		outcome: 'completed', result: Object.freeze({ contractVersion: 1, jobId: request.jobId,
			operation: request.operation, outputs: Object.freeze(outputs) }) });
}

function normalizeStageInput(value: unknown) {
	const record = exactRecord(value, ['jobId', 'role', 'mediaType', 'byteLength', 'bytes'], 'input staging request');
	if (!(record.bytes instanceof Blob)) throw new TypeError('Selected media must be supplied as a Blob.');
	const byteLengthValue = bytes(record.byteLength);
	if (record.bytes.size !== byteLengthValue) throw new TypeError('The selected-media Blob length is inconsistent.');
	return Object.freeze({ jobId: jobId(record.jobId), role: enumValue(record.role, INPUT_ROLES, 'input role'),
		mediaType: mediaType(record.mediaType), byteLength: byteLengthValue, bytes: record.bytes });
}

function normalizeReserveOutput(value: unknown) {
	const record = exactRecord(value, ['jobId', 'role', 'mediaType', 'maximumByteLength'], 'output reservation request');
	return Object.freeze({ jobId: jobId(record.jobId), role: enumValue(record.role, OUTPUT_ROLES, 'output role'),
		mediaType: mediaType(record.mediaType), maximumByteLength: bytes(record.maximumByteLength) });
}

function normalizeInputClaim(value: unknown): LocalAssistanceInputClaim {
	const record = claimRecord(value, ['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256']);
	const role = enumValue(record.role, INPUT_ROLES, 'input role');
	return Object.freeze({ claimVersion: 1, claimId: jobId(record.claimId), jobId: jobId(record.jobId),
		role, mediaType: roleMediaType(record.mediaType, role, INPUT_MEDIA_TYPES),
		byteLength: bytes(record.byteLength), sha256: digest(record.sha256) });
}

function normalizeOutputReservation(value: unknown): LocalAssistanceOutputReservation {
	const record = claimRecord(value, ['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'maximumByteLength']);
	const role = enumValue(record.role, OUTPUT_ROLES, 'output role');
	return Object.freeze({ claimVersion: 1, claimId: jobId(record.claimId), jobId: jobId(record.jobId),
		role, mediaType: roleMediaType(record.mediaType, role, OUTPUT_MEDIA_TYPES),
		maximumByteLength: bytes(record.maximumByteLength) });
}

function normalizeOutputClaim(value: unknown): LocalAssistanceOutputClaim {
	const record = claimRecord(value, ['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256']);
	const role = enumValue(record.role, OUTPUT_ROLES, 'output role');
	return Object.freeze({ claimVersion: 1, claimId: jobId(record.claimId), jobId: jobId(record.jobId),
		role, mediaType: roleMediaType(record.mediaType, role, OUTPUT_MEDIA_TYPES),
		byteLength: bytes(record.byteLength), sha256: digest(record.sha256) });
}

function assertOperationRoles(
	operation: AssistanceOperation,
	inputs: readonly LocalAssistanceInputClaim[],
	outputs: readonly LocalAssistanceOutputReservation[],
): void {
	const operationRoles = OPERATION_ROLES[operation];
	if (inputs.some(({ role }) => !operationRoles.inputs.includes(role))
		|| outputs.some(({ role }) => !operationRoles.outputs.includes(role))) {
		throw new TypeError('An assistance claim role is not admitted by its operation.');
	}
	for (const required of operationRoles.required) {
		if (!inputs.some(({ role }) => required.includes(role))) {
			throw new TypeError('An assistance operation omitted one required input role.');
		}
	}
}

function roles(
	inputs: readonly LocalAssistanceInputRole[],
	required: readonly (readonly LocalAssistanceInputRole[])[],
	outputs: readonly LocalAssistanceOutputRole[],
) {
	return Object.freeze({ inputs: Object.freeze(inputs),
		required: Object.freeze(required.map((group) => Object.freeze(group))), outputs: Object.freeze(outputs) });
}

function jsonTypes(role: LocalAssistanceOutputRole): readonly string[] {
	return Object.freeze(['application/json', `application/vnd.soundscaper.${role}+json`]);
}

function roleMediaType<Role extends string>(
	value: unknown,
	role: Role,
	admitted: Readonly<Record<Role, readonly string[]>>,
): string {
	const candidate = mediaType(value);
	if (!admitted[role].includes(candidate)) {
		throw new TypeError(`The assistance ${role} role does not admit that media type.`);
	}
	return candidate;
}

function normalizeRunModels(value: unknown, operation: AssistanceOperation) {
	const values = boundedArray(value, 8, 'model bindings');
	if (values.length < 1 && operation !== 'shot-detection') throw new TypeError('The operation needs a model binding.');
	return Object.freeze(values.map((candidate) => {
		const record = exactRecord(candidate, ['modelId', 'version', 'artifactSha256s'], 'model binding');
		if (!Array.isArray(record.artifactSha256s) || record.artifactSha256s.length < 1
			|| record.artifactSha256s.length > 64) throw new TypeError('A model binding needs authenticated artifacts.');
		return Object.freeze({ modelId: boundedModelId(record.modelId),
			version: text(record.version, 64, 'model version'),
			artifactSha256s: Object.freeze(record.artifactSha256s.map(digest)) });
	}));
}

async function blobSha256(value: Blob): Promise<string> {
	const digestBytes = await crypto.subtle.digest('SHA-256', await value.arrayBuffer());
	return [...new Uint8Array(digestBytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function claimRecord(value: unknown, fields: readonly string[]) {
	const record = exactRecord(value, fields, 'data claim');
	if (record.claimVersion !== 1) throw new TypeError('The assistance claim version is unsupported.');
	return record;
}

function correlate(record: Record<string, unknown>, request: LocalAssistanceRunRequest): void {
	contract(record);
	if (jobId(record.jobId) !== request.jobId
		|| normalizeAssistanceOperation(record.operation) !== request.operation) {
		throw new TypeError('The assistance response is not correlated.');
	}
}

function contract(record: Record<string, unknown>): void {
	if (record.contractVersion !== 1) throw new TypeError('The assistance contract version is unsupported.');
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new TypeError(`The assistance ${label} must be a record.`);
	const keys = Object.keys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The assistance ${label} must carry exactly its schema fields.`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

function boundedArray(value: unknown, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`The assistance ${label} are invalid.`);
	return value;
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) throw new TypeError('An assistance opaque id is invalid.');
	return value;
}

function boundedModelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID.test(value)) throw new TypeError('An assistance model id is invalid.');
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('An assistance digest is invalid.');
	return value;
}

function mediaType(value: unknown): string {
	if (typeof value !== 'string' || !MEDIA_TYPE.test(value)) throw new TypeError('An assistance media type is invalid.');
	return value;
}

function bytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_BYTES) {
		throw new TypeError('An assistance byte length is invalid.');
	}
	return Number(value);
}

function nullableUnit(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`The ${label} is invalid.`);
	return Number(value);
}

function text(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function enumValue<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value as Values[number];
}
