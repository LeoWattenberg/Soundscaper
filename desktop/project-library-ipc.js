/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	IPC,
	MAX_SHARED_PROJECT_DOCUMENT_BYTES,
	MAX_SHARED_PROJECT_ID_BYTES,
	MAX_SHARED_PROJECTS,
} from './constants.js';

const SUMMARY_KEYS = Object.freeze(['id', 'title', 'revision', 'updatedAt']);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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
	const invoke = (event, operation) => ownership.admit(ownerFor(event), operation);

	handle(IPC.listSharedProjects, async (event) => invoke(event, async () => (
		sharedProjectSummaries(await service.listSharedProjects(), projectLimit)
	)));
	handle(IPC.readSharedProject, async (event, projectId) => invoke(event, async () => (
		nullableProjectDocument(
			await service.readSharedProject(sharedProjectId(projectId)),
			documentLimit,
		)
	)));
	handle(IPC.commitSharedProject, async (event, document) => invoke(event, async () => (
		projectDocument(
			await service.commitSharedProject(projectDocument(document, documentLimit)),
			documentLimit,
		)
	)));
	handle(IPC.deleteSharedProject, async (event, projectId) => invoke(event, async () => (
		strictBoolean(await service.deleteSharedProject(sharedProjectId(projectId)))
	)));

	return Object.freeze({ revokeOwner: (owner) => ownership.revokeOwner(owner) });
}

class RendererProjectLibraryOperations {
	#owners = new WeakMap();

	admit(owner, operation) {
		const state = this.#state(reference(owner));
		if (state.revoked) return Promise.reject(new Error('Renderer project-library owner was revoked'));
		let admitted;
		try {
			admitted = Promise.resolve(operation()).then((value) => {
				if (state.revoked) throw new Error('Renderer project-library owner was revoked');
				return value;
			});
		} catch (error) {
			return Promise.reject(error);
		}
		state.operations.add(admitted);
		void admitted.then(
			() => { state.operations.delete(admitted); },
			() => { state.operations.delete(admitted); },
		);
		return admitted;
	}

	async revokeOwner(owner) {
		const state = this.#owners.get(reference(owner));
		if (!state) return;
		state.revoked = true;
		await Promise.allSettled([...state.operations]);
	}

	#state(owner) {
		let state = this.#owners.get(owner);
		if (!state) {
			state = { operations: new Set(), revoked: false };
			this.#owners.set(owner, state);
		}
		return state;
	}
}

function assertService(service) {
	if (!service || typeof service !== 'object') {
		throw new TypeError('Desktop project-library IPC requires a service');
	}
	for (const method of [
		'listSharedProjects',
		'readSharedProject',
		'commitSharedProject',
		'deleteSharedProject',
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
