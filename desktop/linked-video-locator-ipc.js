/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename, isAbsolute } from 'node:path';

import {
	APP_ORIGIN,
	IPC,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_MATERIALIZED_V1,
} from './constants.js';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from './validation.js';

const VIDEO_CHOICE = validateFileChoice({ purpose: 'video', multiple: false });
const MAX_LINKED_VIDEO_LOCATOR_REFERENCES = 128;

/** Registers the owner-scoped, pathless linked-original Electron boundary. */
export function registerDesktopLinkedVideoLocatorIpc({
	dialog,
	handle,
	ownerFor,
	store,
	windowFor,
}) {
	assertDependencies({ dialog, handle, ownerFor, store, windowFor });
	handle(IPC.chooseLinkedVideoOriginal, async (event) => {
		const owner = reference(ownerFor(event));
		const result = await dialog.showOpenDialog(windowFor(), {
			title: 'Link video original',
			properties: ['openFile'],
			filters: VIDEO_CHOICE.filters,
		});
		const path = selectedVideoPath(result);
		if (path === null) return null;
		const locator = await store.registerPath(path, {
			owner,
			mimeType: mimeTypeForPath(path),
			displayName: basename(path),
		});
		try {
			return linkedVideoLocator(locator);
		} catch (error) {
			await rollbackLocator(store, locator, owner, error);
		}
	});
	handle(IPC.loadLinkedVideoOriginal, async (event, value) => {
		const request = linkedVideoLoadRequest(value);
		const loaded = await store.load(request.locatorId, {
			owner: reference(ownerFor(event)),
			expectedRevision: request.expectedRevision,
		});
		return loaded === null ? null : loadedLinkedVideoLocator(loaded);
	});
	handle(IPC.reconcileLinkedVideoOriginals, async (event, value) => nonNegativeSafeInteger(
		await store.reconcileStartup(
			linkedVideoReferences(value),
			{ owner: reference(ownerFor(event)) },
		),
		'Linked-video reconciliation removal count',
	));
	handle(IPC.releaseLinkedVideoOriginal, async (event, locatorId) => strictBoolean(
		await store.release(
			opaqueToken(locatorId, 'Invalid linked-video locator identifier.'),
			{ owner: reference(ownerFor(event)) },
		),
	));
}

function assertDependencies({ dialog, handle, ownerFor, store, windowFor }) {
	if (!dialog || typeof dialog.showOpenDialog !== 'function'
		|| typeof handle !== 'function' || typeof ownerFor !== 'function'
		|| typeof windowFor !== 'function' || !store || typeof store !== 'object') {
		throw new TypeError('Linked-video IPC requires its main-process dependencies.');
	}
	for (const method of ['registerPath', 'load', 'reconcileStartup', 'release']) {
		if (typeof store[method] !== 'function') {
			throw new TypeError(`Linked-video locator store is missing ${method}.`);
		}
	}
}

function selectedVideoPath(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| typeof value.canceled !== 'boolean' || !Array.isArray(value.filePaths)) {
		throw new TypeError('The linked-video chooser returned an invalid result.');
	}
	if (value.canceled) return null;
	if (value.filePaths.length !== 1 || typeof value.filePaths[0] !== 'string'
		|| !isAbsolute(value.filePaths[0])) {
		throw new TypeError('The linked-video chooser must return a single video path.');
	}
	const path = value.filePaths[0];
	if (!acceptsFile('video', path) || !mimeTypeForPath(path).startsWith('video/')) {
		throw new TypeError('The selected video file type is not allowed.');
	}
	return path;
}

function linkedVideoLoadRequest(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-video load request is required.');
	}
	return Object.freeze({
		locatorId: opaqueToken(value.locatorId, 'Invalid linked-video locator identifier.'),
		expectedRevision: value.expectedRevision === null
			? null
			: opaqueToken(value.expectedRevision, 'Invalid linked-video locator revision.'),
	});
}

function linkedVideoReferences(value) {
	if (!Array.isArray(value) || value.length > MAX_LINKED_VIDEO_LOCATOR_REFERENCES) {
		throw new RangeError('Linked-video reconciliation reference count exceeds its limit.');
	}
	const identifiers = new Set();
	return Object.freeze(value.map((referenceValue) => {
		const reference = closedReference(referenceValue);
		const locatorId = opaqueToken(reference.locatorId, 'Invalid linked-video locator identifier.');
		if (identifiers.has(locatorId)) {
			throw new Error('Linked-video reconciliation contains duplicate locator identifiers.');
		}
		identifiers.add(locatorId);
		return Object.freeze({
			locatorId,
			locatorRevision: opaqueToken(
				reference.locatorRevision,
				'Invalid linked-video locator revision.',
			),
		});
	}));
}

function closedReference(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-video reconciliation reference is required.');
	}
	const fields = ['locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError('A linked-video reconciliation reference contains an unsupported field.');
	}
	const output = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked-video reconciliation ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function linkedVideoLocator(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The linked-video locator is invalid.');
	}
	return Object.freeze({
		locatorId: opaqueToken(value.locatorId, 'Invalid linked-video locator identifier.'),
		locatorRevision: opaqueToken(value.locatorRevision, 'Invalid linked-video locator revision.'),
		name: videoName(value.name),
		size: videoSize(value.size),
		mimeType: videoMimeType(value.mimeType),
		lastModified: nonNegativeSafeInteger(value.lastModified, 'Linked-video modification time'),
	});
}

function loadedLinkedVideoLocator(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The loaded linked-video locator is invalid.');
	}
	return Object.freeze({
		locatorRevision: opaqueToken(value.locatorRevision, 'Invalid linked-video locator revision.'),
		descriptor: materializedVideoReadDescriptor(value.descriptor),
	});
}

function materializedVideoReadDescriptor(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.readProfile !== READ_PROFILE_MATERIALIZED_V1) {
		throw new TypeError('Linked-video reads require a materialized-v1 descriptor.');
	}
	const id = opaqueToken(value.id, 'Invalid linked-video read identifier.');
	const name = videoName(value.name);
	const mimeType = videoMimeType(value.mimeType);
	const descriptor = Object.freeze({
		id,
		url: capabilityUrl(value.url, { id, name }),
		name,
		size: videoSize(value.size),
		mimeType,
		readProfile: READ_PROFILE_MATERIALIZED_V1,
		lastModified: nonNegativeSafeInteger(value.lastModified, 'Linked-video modification time'),
	});
	return descriptor;
}

function capabilityUrl(value, { id, name }) {
	const expected = `${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${READ_PROFILE_MATERIALIZED_V1}/${id}/${encodeURIComponent(name)}`;
	let url;
	try {
		url = new URL(String(value || ''));
	} catch {
		throw new TypeError('Invalid linked-video read capability URL.');
	}
	if (url.href !== expected) throw new TypeError('Invalid linked-video read capability URL.');
	return url.href;
}

function opaqueToken(value, message) {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(message);
	return value;
}

function videoName(value) {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| value.length > 255 || value === '.' || value === '..'
		|| value.includes('/') || value.includes('\\') || hasControlCharacters(value)) {
		throw new TypeError('Invalid linked-video name.');
	}
	return value;
}

function hasControlCharacters(value) {
	for (const character of value) {
		if (character.codePointAt(0) <= 0x1f) return true;
	}
	return false;
}

function videoMimeType(value) {
	if (typeof value !== 'string' || value.length > 128
		|| !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value)) {
		throw new TypeError('Invalid linked-video MIME type.');
	}
	return value;
}

function videoSize(value) {
	const size = nonNegativeSafeInteger(value, 'Linked-video size');
	if (size < 1 || size > MAX_READ_CAPABILITY_BYTES_PER_OWNER) {
		throw new RangeError('Linked-video size exceeds the materialized read limit.');
	}
	return size;
}

function nonNegativeSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function reference(value) {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('A linked-video renderer owner is required.');
	}
	return value;
}

function strictBoolean(value) {
	if (value !== true && value !== false) throw new TypeError('Linked-video release returned an invalid result.');
	return value;
}

async function rollbackLocator(store, locator, owner, cause) {
	if (typeof locator?.locatorId !== 'string' || !/^[a-f0-9]{64}$/u.test(locator.locatorId)) throw cause;
	try {
		await store.release(locator.locatorId, { owner });
	} catch (cleanupError) {
		throw new AggregateError(
			[cause, cleanupError],
			'Linked-video locator validation and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw cause;
}
