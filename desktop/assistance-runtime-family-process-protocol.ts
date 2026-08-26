/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed main/utility-process and utility-process/worker wire for runtime families. */

import {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
	validateAssistanceRuntimeFamilyJobRequestV1,
	validateAssistanceRuntimeFamilyJobResultV1,
	type AssistanceRuntimeFamilyJobRequestV1,
	type AssistanceRuntimeFamilyJobResultV1,
	type AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	ASSISTANCE_RUNTIME_FAMILY_TARGETS,
	type AssistanceRuntimeFamilyDescriptor,
	type AssistanceRuntimeFamilyDescriptorFile,
	type AssistanceRuntimeFamilyId,
	type AssistanceRuntimeFamilyTargetId,
} from './assistance-runtime-family-manifest.ts';
import { assertHelperWireEnvelope } from './helper-wire-admission.ts';

export type AssistanceRuntimeFamilyHostMessageV1 =
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'initialize';
		readonly descriptor: AssistanceRuntimeFamilyDescriptor;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'job';
		readonly request: AssistanceRuntimeFamilyJobRequestV1;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'terminate-worker';
		readonly jobId: string;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'shutdown';
	}>;

export interface AssistanceRuntimeFamilyWireErrorV1 {
	readonly name: string;
	readonly message: string;
	readonly code: string;
}

export type AssistanceRuntimeFamilyProcessMessageV1 =
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'ready';
		readonly familyId: AssistanceRuntimeFamilyId;
		readonly runtimeVersion: string;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'progress';
		readonly jobId: string;
		readonly familyId: AssistanceRuntimeFamilyId;
		readonly task: AssistanceRuntimeFamilyTask;
		readonly sequence: number;
		readonly value: number;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'result';
		readonly jobId: string;
		readonly familyId: AssistanceRuntimeFamilyId;
		readonly task: AssistanceRuntimeFamilyTask;
		readonly result: AssistanceRuntimeFamilyJobResultV1;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'error';
		readonly jobId: string;
		readonly familyId: AssistanceRuntimeFamilyId;
		readonly task: AssistanceRuntimeFamilyTask;
		readonly error: AssistanceRuntimeFamilyWireErrorV1;
	}>
	| Readonly<{
		readonly protocolVersion: typeof ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION;
		readonly type: 'worker-terminated';
		readonly jobId: string;
		readonly familyId: AssistanceRuntimeFamilyId;
		readonly task: AssistanceRuntimeFamilyTask;
	}>;

const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const ERROR_CODE = /^[A-Z][A-Z\d_]{0,63}$/u;
const MAXIMUM_DESCRIPTOR_FILES = 512;

export function validateAssistanceRuntimeFamilyDescriptorV1(
	value: unknown,
): AssistanceRuntimeFamilyDescriptor {
	assertHelperWireEnvelope(value);
	const record = exactRecord(value, [
		'familyId', 'runtimeVersion', 'target', 'executionProvider', 'entrypoint', 'files',
	], 'runtime-family descriptor');
	const familyId = family(record.familyId);
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	if (record.runtimeVersion !== definition.runtimeVersion || record.executionProvider !== 'cpu'
		|| typeof record.target !== 'string'
		|| !(ASSISTANCE_RUNTIME_FAMILY_TARGETS as readonly string[]).includes(record.target)) {
		throw new TypeError('The runtime-family descriptor version, target, or CPU provider is invalid.');
	}
	if (!Array.isArray(record.files) || record.files.length < 1
		|| record.files.length > MAXIMUM_DESCRIPTOR_FILES) {
		throw new TypeError('The runtime-family descriptor closure is outside its bound.');
	}
	const files = record.files.map(descriptorFile);
	if (new Set(files.map(({ path }) => path)).size !== files.length
		|| new Set(files.map(({ relativePath }) => relativePath)).size !== files.length) {
		throw new TypeError('The runtime-family descriptor repeats a closure file.');
	}
	const entrypoint = absolutePath(record.entrypoint, 'runtime entrypoint');
	const entry = files.find(({ path }) => path === entrypoint);
	if (!entry || entry.executable !== (definition.loader === 'executable')) {
		throw new TypeError('The runtime-family entrypoint is not bound by its exact closure.');
	}
	return Object.freeze({
		familyId, runtimeVersion: definition.runtimeVersion,
		target: record.target as AssistanceRuntimeFamilyTargetId,
		executionProvider: 'cpu', entrypoint, files: Object.freeze(files),
	});
}

export function validateAssistanceRuntimeFamilyHostMessageV1(
	value: unknown,
): AssistanceRuntimeFamilyHostMessageV1 {
	assertHelperWireEnvelope(value);
	if (!plainRecord(value) || value.protocolVersion !== ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION) {
		throw new TypeError('A runtime-family host message has an unsupported version.');
	}
	if (value.type === 'shutdown') {
		exactKeys(value, ['protocolVersion', 'type'], 'runtime-family shutdown message');
		return Object.freeze({ protocolVersion: 1, type: 'shutdown' });
	}
	if (value.type === 'initialize') {
		exactKeys(value, ['protocolVersion', 'type', 'descriptor'], 'runtime-family initialize message');
		return Object.freeze({
			protocolVersion: 1, type: 'initialize',
			descriptor: validateAssistanceRuntimeFamilyDescriptorV1(value.descriptor),
		});
	}
	if (value.type === 'job') {
		exactKeys(value, ['protocolVersion', 'type', 'request'], 'runtime-family job message');
		return Object.freeze({
			protocolVersion: 1, type: 'job',
			request: validateAssistanceRuntimeFamilyJobRequestV1(value.request),
		});
	}
	if (value.type === 'terminate-worker') {
		exactKeys(value, ['protocolVersion', 'type', 'jobId'], 'runtime-family termination message');
		return Object.freeze({ protocolVersion: 1, type: 'terminate-worker', jobId: jobId(value.jobId) });
	}
	throw new TypeError('A runtime-family host message type is unsupported.');
}

export function validateAssistanceRuntimeFamilyProcessMessageV1(
	value: unknown,
	requestValue?: unknown,
): AssistanceRuntimeFamilyProcessMessageV1 {
	assertHelperWireEnvelope(value);
	if (!plainRecord(value) || value.protocolVersion !== ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION) {
		throw new TypeError('A runtime-family process message has an unsupported version.');
	}
	if (value.type === 'ready') {
		exactKeys(value, ['protocolVersion', 'type', 'familyId', 'runtimeVersion'],
			'runtime-family ready message');
		const familyId = family(value.familyId);
		const runtimeVersion = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId].runtimeVersion;
		if (value.runtimeVersion !== runtimeVersion) {
			throw new TypeError('The runtime-family ready version is invalid.');
		}
		return Object.freeze({ protocolVersion: 1, type: 'ready', familyId, runtimeVersion });
	}
	if (requestValue === undefined) {
		throw new TypeError('A runtime-family process job message needs its active request.');
	}
	const request = validateAssistanceRuntimeFamilyJobRequestV1(requestValue);
	if (value.type === 'progress') {
		exactKeys(value, [
			'protocolVersion', 'type', 'jobId', 'familyId', 'task', 'sequence', 'value',
		], 'runtime-family progress message');
		correlate(value, request);
		if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0
			|| typeof value.value !== 'number' || !Number.isFinite(value.value)
			|| value.value < 0 || value.value > 1) {
			throw new TypeError('Runtime-family progress must be one finite forward ratio.');
		}
		return Object.freeze({
			protocolVersion: 1, type: 'progress', jobId: request.jobId,
			familyId: request.familyId, task: request.task,
			sequence: Number(value.sequence), value: value.value,
		});
	}
	if (value.type === 'result') {
		exactKeys(value, [
			'protocolVersion', 'type', 'jobId', 'familyId', 'task', 'result',
		], 'runtime-family result message');
		correlate(value, request);
		return Object.freeze({
			protocolVersion: 1, type: 'result', jobId: request.jobId,
			familyId: request.familyId, task: request.task,
			result: validateAssistanceRuntimeFamilyJobResultV1(value.result, request.grant),
		});
	}
	if (value.type === 'error') {
		exactKeys(value, [
			'protocolVersion', 'type', 'jobId', 'familyId', 'task', 'error',
		], 'runtime-family error message');
		correlate(value, request);
		return Object.freeze({
			protocolVersion: 1, type: 'error', jobId: request.jobId,
			familyId: request.familyId, task: request.task, error: wireError(value.error),
		});
	}
	if (value.type === 'worker-terminated') {
		exactKeys(value, [
			'protocolVersion', 'type', 'jobId', 'familyId', 'task',
		], 'runtime-family worker-terminated message');
		correlate(value, request);
		return Object.freeze({
			protocolVersion: 1, type: 'worker-terminated', jobId: request.jobId,
			familyId: request.familyId, task: request.task,
		});
	}
	throw new TypeError('A runtime-family process message type is unsupported.');
}

export function serializeAssistanceRuntimeFamilyWireErrorV1(
	value: unknown,
): AssistanceRuntimeFamilyWireErrorV1 {
	const error = value instanceof Error ? value : new Error(String(value));
	const candidateCode = (error as Error & { readonly code?: unknown }).code;
	const code = typeof candidateCode === 'string' && ERROR_CODE.test(candidateCode)
		? candidateCode : 'RUNTIME_FAMILY_WORKER_ERROR';
	return Object.freeze({
		name: serializeBoundedText(error.name, 'Error', 64),
		message: serializeBoundedText(error.message,
			'The runtime-family worker failed.', 2_048, true),
		code,
	});
}

function descriptorFile(value: unknown): AssistanceRuntimeFamilyDescriptorFile {
	const record = exactRecord(value,
		['path', 'relativePath', 'byteLength', 'sha256', 'executable'], 'runtime-family descriptor file');
	if (!Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 1
		|| Number(record.byteLength) > 16 * 1024 ** 3
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)
		|| typeof record.executable !== 'boolean') {
		throw new TypeError('A runtime-family descriptor file is invalid.');
	}
	return Object.freeze({
		path: absolutePath(record.path, 'runtime file'),
		relativePath: relativePath(record.relativePath),
		byteLength: Number(record.byteLength), sha256: record.sha256,
		executable: record.executable,
	});
}

function correlate(value: Record<string, unknown>, request: AssistanceRuntimeFamilyJobRequestV1): void {
	if (value.jobId !== request.jobId || value.familyId !== request.familyId || value.task !== request.task) {
		throw new TypeError('The runtime-family process message does not correlate its active job.');
	}
}

function wireError(value: unknown): AssistanceRuntimeFamilyWireErrorV1 {
	const record = exactRecord(value, ['name', 'message', 'code'], 'runtime-family wire error');
	if (typeof record.code !== 'string' || !ERROR_CODE.test(record.code)) {
		throw new TypeError('The runtime-family wire error code is invalid.');
	}
	return Object.freeze({
		name: boundedText(record.name, 64, 'runtime-family error name'),
		message: boundedText(record.message, 2_048, 'runtime-family error message'),
		code: record.code,
	});
}

function family(value: unknown): AssistanceRuntimeFamilyId {
	if (typeof value !== 'string' || !Object.hasOwn(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS, value)) {
		throw new TypeError('The runtime-family process family is invalid.');
	}
	return value as AssistanceRuntimeFamilyId;
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError('The runtime-family process job id is invalid.');
	}
	return value;
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 2 || Buffer.byteLength(value) > 4_096
		|| value.includes('\0') || value.split(/[\\/]/u).includes('..')
		|| !value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) && !value.startsWith('\\\\')) {
		throw new TypeError(`The ${label} path is invalid.`);
	}
	return value;
}

function relativePath(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > 240
		|| value.startsWith('/') || value.includes('\\')
		|| value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		throw new TypeError('A runtime-family descriptor relative path is invalid.');
	}
	return value;
}

function boundedText(value: unknown, maximumBytes: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > maximumBytes
		|| /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`The ${label} is not bounded text.`);
	}
	return value;
}

function serializeBoundedText(
	value: unknown,
	fallback: string,
	maximumBytes: number,
	redactPaths = false,
): string {
	let text = typeof value === 'string' && value.length > 0 ? value : fallback;
	text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
	if (redactPaths) {
		text = text.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>]+/gu, '[private path]');
	}
	text = text.trim() || fallback;
	if (Buffer.byteLength(text) <= maximumBytes) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(text.slice(0, middle)) <= maximumBytes) low = middle;
		else high = middle - 1;
	}
	return text.slice(0, low).replace(/[\uD800-\uDBFF]$/u, '') || fallback;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!plainRecord(value)) throw new TypeError(`The ${label} must be a plain record.`);
	exactKeys(value, keys, label);
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(value);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} carries unsupported fields.`);
	}
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
