/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed path-private job grant shared by every additional Milestone 7 runtime family. */

import {
	validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim,
	type AssistanceInputRole,
	type AssistanceOutputRole,
} from './assistance-data-claims.ts';
import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from './helper-data-plane.ts';
import { assertHelperWireEnvelope } from './helper-wire-admission.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	type AssistanceRuntimeFamilyDescriptor,
	type AssistanceRuntimeFamilyId,
} from './assistance-runtime-family-manifest.ts';

export const ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION = 1;
export const ASSISTANCE_RUNTIME_FAMILY_GRANT_VERSION = 1;
export const ASSISTANCE_RUNTIME_FAMILY_RESULT_VERSION = 1;

export const ASSISTANCE_RUNTIME_FAMILY_TASKS = Object.freeze({
	'onnxruntime-node': Object.freeze([
		'word-alignment', 'speech-enhancement', 'source-separation', 'audio-tagging',
		'beat-tracking', 'text-embedding', 'image-text-embedding',
		'optical-character-recognition', 'shot-detection', 'subject-detection',
		'saliency-detection',
	] as const),
	'whisper-cpp': Object.freeze(['speech-recognition'] as const),
	'llama-cpp': Object.freeze(['text-embedding', 'editorial-generation'] as const),
});

type OnnxTask = (typeof ASSISTANCE_RUNTIME_FAMILY_TASKS)['onnxruntime-node'][number];
type WhisperTask = (typeof ASSISTANCE_RUNTIME_FAMILY_TASKS)['whisper-cpp'][number];
type LlamaTask = (typeof ASSISTANCE_RUNTIME_FAMILY_TASKS)['llama-cpp'][number];
export type AssistanceRuntimeFamilyTask = OnnxTask | WhisperTask | LlamaTask;

export interface AssistanceRuntimeFamilyFileIdentityV1 {
	readonly dev: number;
	readonly ino: number;
}

export interface AssistanceRuntimeFamilyInputGrantV1 {
	readonly claimId: string;
	readonly role: AssistanceInputRole;
	readonly mediaType: string;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: AssistanceRuntimeFamilyFileIdentityV1;
}

export interface AssistanceRuntimeFamilyModelGrantV1 {
	readonly modelId: string;
	readonly version: string;
	readonly artifactRole: string;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: AssistanceRuntimeFamilyFileIdentityV1;
}

export interface AssistanceRuntimeFamilyOutputGrantV1 {
	readonly claimId: string;
	readonly role: AssistanceOutputRole;
	readonly mediaType: string;
	readonly path: string;
	readonly maximumByteLength: number;
	readonly initialByteLength: 0;
	readonly initialSha256: string;
	readonly identity: AssistanceRuntimeFamilyFileIdentityV1;
}

export interface AssistanceRuntimeFamilyJobGrantV1 {
	readonly grantVersion: typeof ASSISTANCE_RUNTIME_FAMILY_GRANT_VERSION;
	readonly jobId: string;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly settingsJson: string;
	readonly inputs: readonly AssistanceRuntimeFamilyInputGrantV1[];
	readonly models: readonly AssistanceRuntimeFamilyModelGrantV1[];
	readonly outputs: readonly AssistanceRuntimeFamilyOutputGrantV1[];
}

export interface AssistanceRuntimeFamilyJobRequestV1 {
	readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
	readonly jobId: string;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly maximumRssBytes: number;
	readonly maximumDurationMs: number;
	readonly grant: AssistanceRuntimeFamilyJobGrantV1;
}

export interface AssistanceRuntimeFamilyAdmittedJob extends AssistanceRuntimeFamilyJobRequestV1 {
	readonly descriptor: AssistanceRuntimeFamilyDescriptor;
}

export interface AssistanceRuntimeFamilyResultOutputV1 {
	readonly claimId: string;
	readonly role: AssistanceOutputRole;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceRuntimeFamilyJobResultV1 {
	readonly resultVersion: typeof ASSISTANCE_RUNTIME_FAMILY_RESULT_VERSION;
	readonly jobId: string;
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly task: AssistanceRuntimeFamilyTask;
	readonly outputs: readonly AssistanceRuntimeFamilyResultOutputV1[];
}

export class AssistanceRuntimeFamilyTaskContractError extends TypeError {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly jobId: string | null;
	constructor(familyId: AssistanceRuntimeFamilyId, task: unknown, jobId: string | null) {
		super(`${String(task)} is not an admitted ${familyId} task.`);
		this.name = 'AssistanceRuntimeFamilyTaskContractError';
		this.familyId = familyId;
		this.jobId = jobId;
	}
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MODEL_VERSION = /^[A-Za-z\d][A-Za-z\d._+-]{0,63}$/u;
const ARTIFACT_ROLE = /^[a-z\d](?:[a-z\d._-]{0,62}[a-z\d])?$/u;
const MAXIMUM_RSS_BYTES = 64 * 1024 ** 3;
const MAXIMUM_DURATION_MS = 24 * 60 * 60_000;
const MAXIMUM_FILES = 64;
const MAXIMUM_SETTINGS_BYTES = 16 * 1024;
const GRANT_KEYS = Object.freeze([
	'grantVersion', 'jobId', 'familyId', 'task', 'settingsJson', 'inputs', 'models', 'outputs',
]);
const REQUEST_KEYS = Object.freeze([
	'protocolVersion', 'jobId', 'familyId', 'task', 'maximumRssBytes', 'maximumDurationMs', 'grant',
]);

export function assistanceRuntimeFamilyTaskAdmitted(
	familyId: AssistanceRuntimeFamilyId,
	task: unknown,
): task is AssistanceRuntimeFamilyTask {
	return typeof task === 'string'
		&& (ASSISTANCE_RUNTIME_FAMILY_TASKS[familyId] as readonly string[]).includes(task);
}

export function validateAssistanceRuntimeFamilyJobGrantV1(
	value: unknown,
): AssistanceRuntimeFamilyJobGrantV1 {
	assertHelperWireEnvelope(value);
	const record = exactRecord(value, GRANT_KEYS, 'runtime-family job grant');
	if (record.grantVersion !== ASSISTANCE_RUNTIME_FAMILY_GRANT_VERSION) {
		throw new TypeError('The runtime-family job grant version is unsupported.');
	}
	const jobId = opaqueId(record.jobId, 'job');
	const familyId = family(record.familyId);
	const task = taskFor(familyId, record.task, jobId);
	const inputs = array(record.inputs, 'input grants').map((entry) => inputGrant(entry, jobId));
	const models = array(record.models, 'model grants').map(modelGrant);
	const outputs = array(record.outputs, 'output grants').map((entry) => outputGrant(entry, jobId));
	if (inputs.length < 1 || models.length < 1 || outputs.length < 1) {
		throw new TypeError('A runtime-family grant requires input, model, and output files.');
	}
	const identities = [...inputs, ...models, ...outputs]
		.map(({ identity }) => `${String(identity.dev)}:${String(identity.ino)}`);
	const paths = [...inputs, ...models, ...outputs].map(({ path }) => path);
	if (new Set(identities).size !== identities.length || new Set(paths).size !== paths.length) {
		throw new TypeError('Runtime-family grant paths and file identities must be unique.');
	}
	boundedAggregate([
		...inputs.map(({ byteLength }) => byteLength),
		...models.map(({ byteLength }) => byteLength),
		...outputs.map(({ maximumByteLength }) => maximumByteLength),
	]);
	return Object.freeze({
		grantVersion: ASSISTANCE_RUNTIME_FAMILY_GRANT_VERSION,
		jobId, familyId, task,
		settingsJson: settings(record.settingsJson),
		inputs: Object.freeze(inputs), models: Object.freeze(models), outputs: Object.freeze(outputs),
	});
}

export function validateAssistanceRuntimeFamilyJobRequestV1(
	value: unknown,
): AssistanceRuntimeFamilyJobRequestV1 {
	assertHelperWireEnvelope(value);
	const record = exactRecord(value, REQUEST_KEYS, 'runtime-family job request');
	if (record.protocolVersion !== ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION) {
		throw new TypeError('The runtime-family job protocol version is unsupported.');
	}
	const jobId = opaqueId(record.jobId, 'job');
	const familyId = family(record.familyId);
	const task = taskFor(familyId, record.task, jobId);
	const grant = validateAssistanceRuntimeFamilyJobGrantV1(record.grant);
	if (grant.jobId !== jobId || grant.familyId !== familyId || grant.task !== task) {
		throw new TypeError('The runtime-family request does not correlate its exact grant.');
	}
	if (!integer(record.maximumRssBytes, 1, MAXIMUM_RSS_BYTES)
		|| !integer(record.maximumDurationMs, 1, MAXIMUM_DURATION_MS)) {
		throw new TypeError('A runtime-family job resource admission is invalid.');
	}
	return Object.freeze({
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		jobId, familyId, task,
		maximumRssBytes: record.maximumRssBytes as number,
		maximumDurationMs: record.maximumDurationMs as number,
		grant,
	});
}

export function validateAssistanceRuntimeFamilyJobResultV1(
	value: unknown,
	grantValue: unknown,
): AssistanceRuntimeFamilyJobResultV1 {
	assertHelperWireEnvelope(value);
	const grant = validateAssistanceRuntimeFamilyJobGrantV1(grantValue);
	const record = exactRecord(value,
		['resultVersion', 'jobId', 'familyId', 'task', 'outputs'], 'runtime-family job result');
	if (record.resultVersion !== ASSISTANCE_RUNTIME_FAMILY_RESULT_VERSION
		|| record.jobId !== grant.jobId || record.familyId !== grant.familyId || record.task !== grant.task) {
		throw new TypeError('The runtime-family result does not correlate its exact job grant.');
	}
	if (!Array.isArray(record.outputs) || record.outputs.length !== grant.outputs.length) {
		throw new TypeError('The runtime-family result must satisfy every reserved output once.');
	}
	const reservations = new Map(grant.outputs.map((output) => [output.claimId, output]));
	const outputs = record.outputs.map((candidate) => {
		const result = exactRecord(candidate,
			['claimId', 'role', 'mediaType', 'byteLength', 'sha256'], 'runtime-family result output');
		const claimId = opaqueId(result.claimId, 'output claim');
		const reservation = reservations.get(claimId);
		if (!reservation) throw new TypeError('The runtime-family result repeats or invents an output.');
		reservations.delete(claimId);
		const claim = validateAssistanceOutputClaim({
			claimVersion: 1, claimId, jobId: grant.jobId, role: result.role,
			mediaType: result.mediaType, byteLength: result.byteLength, sha256: result.sha256,
		}, {
			claimVersion: 1, claimId, jobId: grant.jobId, role: reservation.role,
			mediaType: reservation.mediaType, maximumByteLength: reservation.maximumByteLength,
		});
		return Object.freeze({
			claimId, role: claim.role, mediaType: claim.mediaType,
			byteLength: claim.byteLength, sha256: claim.sha256,
		});
	});
	return Object.freeze({
		resultVersion: ASSISTANCE_RUNTIME_FAMILY_RESULT_VERSION,
		jobId: grant.jobId, familyId: grant.familyId, task: grant.task,
		outputs: Object.freeze(outputs),
	});
}

function inputGrant(value: unknown, jobId: string): AssistanceRuntimeFamilyInputGrantV1 {
	const record = exactRecord(value,
		['claimId', 'role', 'mediaType', 'path', 'byteLength', 'sha256', 'identity'],
		'runtime-family input grant');
	const claim = validateAssistanceStagedInputClaim({
		claimVersion: 1, claimId: record.claimId, jobId,
		role: record.role, mediaType: record.mediaType,
		byteLength: record.byteLength, sha256: record.sha256,
	});
	return Object.freeze({
		claimId: claim.claimId, role: claim.role, mediaType: claim.mediaType,
		path: absolutePath(record.path), byteLength: claim.byteLength, sha256: claim.sha256,
		identity: identity(record.identity),
	});
}

function modelGrant(value: unknown): AssistanceRuntimeFamilyModelGrantV1 {
	const record = exactRecord(value,
		['modelId', 'version', 'artifactRole', 'path', 'byteLength', 'sha256', 'identity'],
		'runtime-family model grant');
	if (typeof record.modelId !== 'string' || !MODEL_ID.test(record.modelId)
		|| typeof record.version !== 'string' || !MODEL_VERSION.test(record.version)
		|| typeof record.artifactRole !== 'string' || !ARTIFACT_ROLE.test(record.artifactRole)
		|| !integer(record.byteLength, 1, HELPER_DATA_PLANE_MAXIMUM_BYTES)
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new TypeError('A runtime-family model artifact grant is invalid.');
	}
	return Object.freeze({
		modelId: record.modelId, version: record.version, artifactRole: record.artifactRole,
		path: absolutePath(record.path), byteLength: record.byteLength as number,
		sha256: record.sha256, identity: identity(record.identity),
	});
}

function outputGrant(value: unknown, jobId: string): AssistanceRuntimeFamilyOutputGrantV1 {
	const record = exactRecord(value, [
		'claimId', 'role', 'mediaType', 'path', 'maximumByteLength',
		'initialByteLength', 'initialSha256', 'identity',
	], 'runtime-family output grant');
	const reservation = validateAssistanceOutputReservation({
		claimVersion: 1, claimId: record.claimId, jobId,
		role: record.role, mediaType: record.mediaType,
		maximumByteLength: record.maximumByteLength,
	});
	if (record.initialByteLength !== 0 || record.initialSha256 !== EMPTY_SHA256) {
		throw new TypeError('A runtime-family output grant must bind one authenticated empty file.');
	}
	return Object.freeze({
		claimId: reservation.claimId, role: reservation.role, mediaType: reservation.mediaType,
		path: absolutePath(record.path), maximumByteLength: reservation.maximumByteLength,
		initialByteLength: 0, initialSha256: EMPTY_SHA256, identity: identity(record.identity),
	});
}

function family(value: unknown): AssistanceRuntimeFamilyId {
	if (typeof value !== 'string' || !Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, value)) {
		throw new TypeError('The runtime-family grant family is invalid.');
	}
	return value as AssistanceRuntimeFamilyId;
}

function taskFor(
	familyId: AssistanceRuntimeFamilyId,
	value: unknown,
	jobId: string | null,
): AssistanceRuntimeFamilyTask {
	if (!assistanceRuntimeFamilyTaskAdmitted(familyId, value)) {
		throw new AssistanceRuntimeFamilyTaskContractError(familyId, value, jobId);
	}
	return value;
}

function identity(value: unknown): AssistanceRuntimeFamilyFileIdentityV1 {
	const record = exactRecord(value, ['dev', 'ino'], 'runtime-family file identity');
	if (!integer(record.dev, 0, Number.MAX_SAFE_INTEGER)
		|| !integer(record.ino, 0, Number.MAX_SAFE_INTEGER)) {
		throw new TypeError('A runtime-family file identity is invalid.');
	}
	return Object.freeze({ dev: record.dev as number, ino: record.ino as number });
}

function settings(value: unknown): string {
	if (typeof value !== 'string' || Buffer.byteLength(value) > MAXIMUM_SETTINGS_BYTES) {
		throw new TypeError('Runtime-family settings JSON is outside its byte bound.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(value); } catch { throw new TypeError('Runtime-family settings JSON is invalid.'); }
	assertHelperWireEnvelope(parsed);
	if (!plainRecord(parsed) || JSON.stringify(parsed) !== value) {
		throw new TypeError('Runtime-family settings JSON must be one canonical plain record.');
	}
	return value;
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || value.length < 2 || Buffer.byteLength(value) > 4_096
		|| value.includes('\0') || value.split(/[\\/]/u).includes('..')
		|| !value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) && !value.startsWith('\\\\')) {
		throw new TypeError('A runtime-family grant path must be absolute, bounded, and traversal-free.');
	}
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`The runtime-family ${label} id is invalid.`);
	}
	return value;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_FILES) {
		throw new TypeError(`The runtime-family ${label} are outside their bound.`);
	}
	return value;
}

function boundedAggregate(values: readonly number[]): void {
	let total = 0;
	for (const value of values) {
		if (total > HELPER_DATA_PLANE_MAXIMUM_BYTES - value) {
			throw new RangeError('The runtime-family grant aggregate byte bound is exceeded.');
		}
		total += value;
	}
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
	return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!plainRecord(value)) throw new TypeError(`The ${label} must be a plain record.`);
	const present = Object.keys(value);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} carries unsupported fields.`);
	}
	return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
