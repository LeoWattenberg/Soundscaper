/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	IPC,
	MAX_SHARED_PROJECT_DOCUMENT_BYTES,
	MAX_SHARED_PROJECT_ID_BYTES,
	MAX_SHARED_PROJECTS,
	MAX_SHARED_SOURCE_BYTES,
	MAX_SHARED_SOURCE_CHUNK_BYTES,
	MAX_SHARED_SOURCE_READS,
	MAX_SHARED_SOURCES,
} from './constants.js';
import { RendererProjectLibraryOperations } from './project-library-renderer-operations.js';

const SUMMARY_KEYS = Object.freeze(['id', 'title', 'revision', 'updatedAt']);
const BUNDLE_KEYS = Object.freeze(['document', 'sources']);
const SOURCE_DESCRIPTOR_KEYS = Object.freeze([
	'bindingId', 'byteLength', 'encoding', 'kind', 'sha256', 'sourceId', 'storageKey',
]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MANAGED_AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const MANAGED_VIDEO_ENCODING = 'video-original-v1';
const MANAGED_VIDEO_TIMING_ENCODING = 'soundscaper-video-timing-v1';
const MANAGED_BINDING_ID = /^[mvt][a-f0-9]{64}$/u;
const SOURCE_WRITE_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Registers the pathless project-library bridge through main's trusted IPC
 * wrapper. The injected service remains main-process-owned and receives no
 * renderer-provided identity, product, path, timestamp, or lease value.
 */
export function registerDesktopProjectLibraryIpc({
	handle,
	ownerFor,
	service,
	maximumDocumentBytes = MAX_SHARED_PROJECT_DOCUMENT_BYTES,
	maximumProjects = MAX_SHARED_PROJECTS,
}) {
	if (typeof handle !== 'function' || typeof ownerFor !== 'function') {
		throw new TypeError('Desktop project-library IPC requires handler and owner seams');
	}
	assertService(service);
	const documentLimit = lowerOnlyLimit(
		maximumDocumentBytes,
		MAX_SHARED_PROJECT_DOCUMENT_BYTES,
		'Desktop shared-project document byte limit',
	);
	const projectLimit = lowerOnlyLimit(
		maximumProjects,
		MAX_SHARED_PROJECTS,
		'Desktop shared-project count limit',
	);
	const ownership = new RendererProjectLibraryOperations();
	const sourceWrites = new RendererSharedSourceWrites(service);
	let activeSourceReads = 0;
	const readSource = async (operation) => {
		if (activeSourceReads >= MAX_SHARED_SOURCE_READS) {
			throw new RangeError('Desktop shared-source read capacity is exhausted');
		}
		activeSourceReads += 1;
		try {
			return await operation();
		} finally {
			activeSourceReads -= 1;
		}
	};
	const invoke = (event, operation) => {
		const owner = ownerFor(event);
		return ownership.admit(owner, (signal) => operation(owner, signal));
	};

	handle(IPC.listSharedProjects, async (event) => invoke(event, async () => (
		sharedProjectSummaries(await service.listSharedProjects(), projectLimit)
	)));
	handle(IPC.readSharedProject, async (event, projectId) => invoke(event, async (_owner, signal) => (
		nullableProjectDocument(
			await service.readSharedProject(sharedProjectId(projectId), signal),
			documentLimit,
		)
	)));
	handle(IPC.readSharedProjectBundle, async (event, projectId) => invoke(event, async (_owner, signal) => (
		nullableProjectBundle(
			await service.readSharedProjectBundle(sharedProjectId(projectId), signal),
			documentLimit,
		)
	)));
	handle(IPC.commitSharedProject, async (event, value) => invoke(event, async (_owner, signal) => (
		projectCommitResult(
			await service.commitSharedProject(projectCommitRequest(value, documentLimit), signal),
			documentLimit,
		)
	)));
	handle(IPC.deleteSharedProject, async (event, projectId) => invoke(event, async (_owner, signal) => (
		strictBoolean(await service.deleteSharedProject(sharedProjectId(projectId), signal))
	)));
	handle(IPC.beginSharedSourceWrite, async (event, value) => invoke(event, async (owner, signal) => {
		const admission = sourceWriteAdmission(await service.beginSharedSourceWrite(sourceWriteDeclaration(value), signal));
		if (admission.status === 'ready') {
			try {
				ownership.assertActive(owner);
				sourceWrites.bind(admission.writeId, owner);
			} catch (error) {
				await service.abortSharedSourceWrite(admission.writeId).catch(() => false);
				throw error;
			}
		}
		return admission;
	}));
	handle(IPC.writeSharedSourceChunk, async (event, value) => invoke(event, async (owner) => {
		const chunk = sourceChunkWrite(value);
		sourceWrites.assertOwner(chunk.writeId, owner);
		return sourceChunkAcknowledgement(await service.writeSharedSourceChunk(chunk));
	}));
	handle(IPC.finishSharedSourceWrite, async (event, value) => invoke(event, async (owner) => {
		const completion = sourceWriteCompletion(value);
		sourceWrites.assertOwner(completion.writeId, owner);
		try {
			return managedSourceDescriptor(await service.finishSharedSourceWrite(completion));
		} finally {
			sourceWrites.releaseIfOwned(completion.writeId, owner);
		}
	}));
	handle(IPC.abortSharedSourceWrite, async (event, writeId) => invoke(event, async (owner) => {
		const id = sourceWriteId(writeId);
		sourceWrites.assertOwner(id, owner);
		try {
			return strictBoolean(await service.abortSharedSourceWrite(id));
		} finally {
			sourceWrites.releaseIfOwned(id, owner);
		}
	}));
	handle(IPC.readSharedSourceChunk, async (event, value) => invoke(event, async (_owner, signal) => readSource(async () => {
		const request = sourceChunkRead(value);
		return sourceChunkResult(await service.readSharedSourceChunk(
			request.bindingId,
			{ offset: request.offset, length: request.length, signal },
		), request.length);
	})));

	return Object.freeze({
		async dispose() {
			const drained = ownership.dispose();
			const uploads = sourceWrites.dispose();
			throwSettledFailures(await Promise.allSettled([drained, uploads]));
		},
		async revokeOwner(owner) {
			const drained = ownership.revokeOwner(owner);
			const uploads = sourceWrites.revokeOwner(owner);
			throwSettledFailures(await Promise.allSettled([drained, uploads]));
		},
	});
}

function throwSettledFailures(results) {
	const failures = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Desktop project-library cleanup failed');
}

class RendererSharedSourceWrites {
	#service;
	#sessions = new Map();

	constructor(service) {
		this.#service = service;
	}

	bind(writeId, owner) {
		if (this.#sessions.has(writeId)) throw new Error('Desktop shared-source write id is already active');
		this.#sessions.set(writeId, reference(owner));
	}

	assertOwner(writeId, owner) {
		if (this.#sessions.get(writeId) !== reference(owner)) {
			throw new Error('Desktop shared-source write belongs to another renderer owner');
		}
	}

	releaseIfOwned(writeId, owner) {
		if (this.#sessions.get(writeId) === reference(owner)) this.#sessions.delete(writeId);
	}

	async revokeOwner(owner) {
		const target = reference(owner);
		const ids = [...this.#sessions].filter(([, candidate]) => candidate === target).map(([id]) => id);
		for (const id of ids) this.#sessions.delete(id);
		await Promise.allSettled(ids.map((id) => this.#service.abortSharedSourceWrite(id)));
	}

	async dispose() {
		const ids = [...this.#sessions.keys()];
		this.#sessions.clear();
		await Promise.allSettled(ids.map((id) => this.#service.abortSharedSourceWrite(id)));
		await this.#service.dispose();
	}
}

function assertService(service) {
	if (!service || typeof service !== 'object') {
		throw new TypeError('Desktop project-library IPC requires a service');
	}
	for (const method of [
		'listSharedProjects',
		'readSharedProject',
		'readSharedProjectBundle',
		'commitSharedProject',
		'deleteSharedProject',
		'beginSharedSourceWrite',
		'writeSharedSourceChunk',
		'finishSharedSourceWrite',
		'abortSharedSourceWrite',
		'readSharedSourceChunk',
		'dispose',
	]) {
		if (typeof service[method] !== 'function') {
			throw new TypeError(`Desktop project-library service is missing ${method}`);
		}
	}
}

function sharedProjectSummaries(value, maximumProjects) {
	if (!Array.isArray(value) || value.length > maximumProjects) {
		throw new RangeError('Desktop shared-project service returned an invalid project count');
	}
	const summaries = Array.from(value, sharedProjectSummary);
	if (new Set(summaries.map(({ id }) => id)).size !== summaries.length) {
		throw new TypeError('Desktop shared-project service returned duplicate project ids');
	}
	return Object.freeze(summaries);
}

function sharedProjectSummary(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-project summary must be an object');
	}
	const summary = {
		id: sharedProjectId(value.id),
		title: humanText(value.title, 'title', 255),
		revision: nonNegativeSafeInteger(value.revision, 'revision'),
		updatedAt: canonicalInstant(value.updatedAt),
	};
	if (Object.keys(summary).some((key, index) => key !== SUMMARY_KEYS[index])) {
		throw new Error('Desktop shared-project summary contract is inconsistent');
	}
	return Object.freeze(summary);
}

function sharedProjectId(value) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop shared-project id must be a non-empty string');
	}
	if (utf8Bytes(value, MAX_SHARED_PROJECT_ID_BYTES) > MAX_SHARED_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop shared-project id exceeds its byte limit');
	}
	return value;
}

function projectDocument(value, maximumBytes) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError('Desktop shared-project document must be a non-empty string');
	}
	if (utf8Bytes(value, maximumBytes) > maximumBytes) {
		throw new RangeError('Desktop shared-project document exceeds its byte limit');
	}
	return value;
}

function nullableProjectDocument(value, maximumBytes) {
	return value === null ? null : projectDocument(value, maximumBytes);
}

function projectCommitRequest(value, maximumBytes) {
	const record = exactRecord(value, ['document', 'expectedRevision'], 'Desktop shared-project commit request');
	return Object.freeze({
		document: projectDocument(record.document, maximumBytes),
		expectedRevision: record.expectedRevision === null
			? null
			: nonNegativeSafeInteger(record.expectedRevision, 'expected revision'),
	});
}

function projectCommitResult(value, maximumBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-project commit result must be an object');
	}
	if (value.status === 'committed') {
		exactRecord(value, ['status', 'document'], 'Desktop shared-project committed result');
		return Object.freeze({ status: 'committed', document: projectDocument(value.document, maximumBytes) });
	}
	exactRecord(value, ['status', 'currentRevision'], 'Desktop shared-project conflict result');
	if (value.status !== 'conflict') throw new TypeError('Desktop shared-project commit result has an invalid status');
	return Object.freeze({
		status: 'conflict',
		currentRevision: nonNegativeSafeInteger(value.currentRevision, 'conflict current revision'),
	});
}

function nullableProjectBundle(value, maximumDocumentBytes) {
	if (value === null) return null;
	const record = exactRecord(value, BUNDLE_KEYS, 'Desktop shared-project bundle');
	if (!Array.isArray(record.sources) || record.sources.length > MAX_SHARED_SOURCES) {
		throw new RangeError('Desktop shared-project bundle has an invalid source count');
	}
	const sources = Object.freeze(record.sources.map(managedSourceDescriptor));
	if (new Set(sources.map(({ kind, sourceId }) => `${kind}:${sourceId}`)).size !== sources.length) {
		throw new TypeError('Desktop shared-project bundle contains duplicate source identities');
	}
	return Object.freeze({
		document: projectDocument(record.document, maximumDocumentBytes),
		sources,
	});
}

function managedSourceDescriptor(value) {
	const record = exactRecord(value, SOURCE_DESCRIPTOR_KEYS, 'Desktop shared-source descriptor');
	const encoding = managedSourceEncoding(record.kind, record.encoding);
	const bindingId = managedBindingId(record.bindingId);
	const byteLength = sharedSourceBytes(record.byteLength);
	const expectedPrefix = record.kind === 'audio' ? 'm' : record.kind === 'video' ? 'v' : 't';
	if (bindingId[0] !== expectedPrefix) {
		throw new TypeError('Desktop shared-source descriptor has an invalid media binding');
	}
	if (record.kind !== 'audio' && byteLength === 0) {
		throw new RangeError('Desktop shared-source retained-media byte length must be positive');
	}
	return Object.freeze({
		bindingId,
		byteLength,
		encoding,
		kind: record.kind,
		sha256: sha256(record.sha256),
		sourceId: sharedSourceIdentity(record.sourceId),
		storageKey: sharedSourceIdentity(record.storageKey),
	});
}

function sourceWriteDeclaration(value) {
	const record = exactRecord(
		value,
		['byteLength', 'encoding', 'projectId', 'projectRevision', 'sha256', 'sourceId'],
		'Desktop shared-source write declaration',
	);
	const encoding = managedEncoding(record.encoding);
	const byteLength = sharedSourceBytes(record.byteLength);
	if (encoding !== MANAGED_AUDIO_ENCODING && byteLength === 0) {
		throw new RangeError('Desktop shared-source retained-media byte length must be positive');
	}
	return Object.freeze({
		byteLength,
		encoding,
		projectId: sharedProjectId(record.projectId),
		projectRevision: nonNegativeSafeInteger(record.projectRevision, 'shared-source project revision'),
		sha256: sha256(record.sha256),
		sourceId: sharedSourceIdentity(record.sourceId),
	});
}

function sourceWriteAdmission(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write admission must be an object');
	}
	if (value.status === 'present') {
		exactRecord(value, ['status', 'source'], 'Desktop shared-source write admission');
		return Object.freeze({ status: 'present', source: managedSourceDescriptor(value.source) });
	}
	exactRecord(value, ['status', 'chunkSize', 'writeId'], 'Desktop shared-source write admission');
	if (value.status !== 'ready') throw new TypeError('Desktop shared-source write admission has an invalid status');
	const chunkSize = positiveSafeInteger(value.chunkSize, 'shared-source chunk size');
	if (chunkSize > MAX_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source write admission exceeds the chunk byte limit');
	}
	return Object.freeze({ status: 'ready', chunkSize, writeId: sourceWriteId(value.writeId) });
}

function sourceChunkWrite(value) {
	const record = exactRecord(value, ['bytes', 'offset', 'writeId'], 'Desktop shared-source chunk write');
	const bytes = binary(record.bytes);
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk exceeds its byte limit');
	}
	return Object.freeze({
		bytes,
		offset: nonNegativeSafeInteger(record.offset, 'shared-source chunk offset'),
		writeId: sourceWriteId(record.writeId),
	});
}

function sourceChunkAcknowledgement(value) {
	const record = exactRecord(value, ['nextOffset'], 'Desktop shared-source chunk acknowledgement');
	return Object.freeze({ nextOffset: nonNegativeSafeInteger(record.nextOffset, 'shared-source next offset') });
}

function sourceWriteCompletion(value) {
	const record = exactRecord(value, ['sha256', 'writeId'], 'Desktop shared-source write completion');
	return Object.freeze({ sha256: sha256(record.sha256), writeId: sourceWriteId(record.writeId) });
}

function sourceChunkRead(value) {
	const record = exactRecord(value, ['bindingId', 'length', 'offset'], 'Desktop shared-source chunk read');
	const length = positiveSafeInteger(record.length, 'shared-source read length');
	if (length > MAX_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source read length exceeds its byte limit');
	}
	return Object.freeze({
		bindingId: managedBindingId(record.bindingId),
		length,
		offset: nonNegativeSafeInteger(record.offset, 'shared-source read offset'),
	});
}

function sourceChunkResult(value, expectedLength) {
	const bytes = binary(value);
	if (bytes.byteLength !== expectedLength) {
		throw new Error('Desktop shared-source read returned an unexpected byte length');
	}
	return bytes;
}

function sharedSourceIdentity(value) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop shared-source identity must be a non-empty string');
	}
	if (utf8Bytes(value, MAX_SHARED_PROJECT_ID_BYTES) > MAX_SHARED_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop shared-source identity exceeds its byte limit');
	}
	return value;
}

function sharedSourceBytes(value) {
	const bytes = nonNegativeSafeInteger(value, 'shared-source byte length');
	if (bytes > MAX_SHARED_SOURCE_BYTES) throw new RangeError('Desktop shared-source byte length exceeds its limit');
	return bytes;
}

function sourceWriteId(value) {
	if (typeof value !== 'string' || !SOURCE_WRITE_ID.test(value)) {
		throw new TypeError('Desktop shared-source write id is invalid');
	}
	return value;
}

function managedBindingId(value) {
	if (typeof value !== 'string' || !MANAGED_BINDING_ID.test(value)) {
		throw new TypeError('Desktop shared-source binding id is invalid');
	}
	return value;
}

function managedEncoding(value) {
	if (value !== MANAGED_AUDIO_ENCODING && value !== MANAGED_VIDEO_ENCODING
		&& value !== MANAGED_VIDEO_TIMING_ENCODING) {
		throw new TypeError('Desktop shared-source media encoding is unsupported');
	}
	return value;
}

function managedSourceEncoding(kind, encoding) {
	const admitted = managedEncoding(encoding);
	if ((kind === 'audio' && admitted === MANAGED_AUDIO_ENCODING)
		|| (kind === 'video' && admitted === MANAGED_VIDEO_ENCODING)
		|| (kind === 'video-timing' && admitted === MANAGED_VIDEO_TIMING_ENCODING)) return admitted;
	throw new TypeError('Desktop shared-source kind and encoding do not match');
}

function sha256(value) {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Desktop shared-source SHA-256 digest is invalid');
	}
	return value;
}

function exactRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
		throw new TypeError(`${label} has unsupported fields`);
	}
	return value;
}

function binary(value) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	}
	throw new TypeError('Desktop shared-source value must be binary data');
}

function strictBoolean(value) {
	if (typeof value !== 'boolean') throw new TypeError('Desktop shared-project delete result must be a boolean');
	return value;
}

function humanText(value, label, maximumLength) {
	if (typeof value !== 'string' || !value || value.length > maximumLength
		|| value.trim() !== value || hasControlCharacters(value)) {
		throw new TypeError(`Desktop shared-project ${label} is invalid`);
	}
	return value;
}

function hasControlCharacters(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function canonicalInstant(value) {
	if (typeof value !== 'string' || !ISO_INSTANT.test(value)) {
		throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	}
	const date = new Date(value);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	}
	return value;
}

function nonNegativeSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Desktop shared-project ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveSafeInteger(value, label) {
	const number = nonNegativeSafeInteger(value, label);
	if (number === 0) throw new RangeError(`Desktop shared-project ${label} must be positive`);
	return number;
}

function lowerOnlyLimit(value, hardLimit, label) {
	if (!Number.isSafeInteger(value) || value < 1 || value > hardLimit) {
		throw new RangeError(`${label} must be positive and cannot exceed its hard limit`);
	}
	return value;
}

function utf8Bytes(value, maximum) {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff
			&& value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
		if (bytes > maximum) return bytes;
	}
	return bytes;
}

function reference(value) {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Renderer project-library owner must be an object reference');
	}
	return value;
}
