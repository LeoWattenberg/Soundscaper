/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename, isAbsolute } from 'node:path';

import {
	APP_ORIGIN,
	IPC,
	MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_LINKED_AUDIO_RANGE_V1,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
	READ_PROFILE_MATERIALIZED_V1,
} from './constants.js';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from './validation.js';

const VIDEO_CHOICE = validateFileChoice({ purpose: 'video', multiple: false });
const AUDIO_CHOICE = Object.freeze({
	filters: Object.freeze([Object.freeze({
		name: 'Uncompressed WAV audio', extensions: Object.freeze(['rf64', 'wav']),
	})]),
});
const MAX_LINKED_VIDEO_LOCATOR_REFERENCES = 128;

/** Registers the owner-scoped, pathless linked-original Electron boundary. */
export function registerDesktopLinkedVideoLocatorIpc({
	dialog,
	handle,
	ownerFor,
	releaseRead,
	store,
	windowFor,
}) {
	assertDependencies({ dialog, handle, ownerFor, releaseRead, store, windowFor });
	handle(IPC.chooseLinkedAudioOriginal, async (event) => {
		const owner = reference(ownerFor(event));
		const result = await dialog.showOpenDialog(windowFor(), {
			title: 'Link WAV audio original',
			properties: ['openFile'],
			filters: AUDIO_CHOICE.filters,
		});
		const path = selectedAudioPath(result);
		if (path === null) return null;
		const locator = await store.registerPath(path, {
			kind: 'audio', owner,
			mimeType: mimeTypeForPath(path),
			displayName: basename(path),
		});
		try {
			return linkedAudioLocator(locator);
		} catch (error) {
			await rollbackLocator(store, locator, owner, error, 'audio');
		}
	});
	handle(IPC.loadLinkedAudioOriginal, async (event, value) => {
		const request = linkedAudioLoadRequest(value);
		const owner = reference(ownerFor(event));
		const loadOptions = { owner, expectedRevision: request.expectedRevision, expectedKind: 'audio' };
		const loaded = await (request.range
			? store.leaseRange(request.locatorId, loadOptions)
			: store.load(request.locatorId, loadOptions));
		if (loaded === null) return null;
		try {
			return loadedLinkedAudioLocator(
				loaded,
				request.range ? READ_PROFILE_LINKED_AUDIO_RANGE_V1 : READ_PROFILE_MATERIALIZED_V1,
			);
		} catch (error) {
			await rollbackReadCapability(releaseRead, loaded, owner, error);
		}
	});
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
		const owner = reference(ownerFor(event));
		const loadOptions = { owner, expectedRevision: request.expectedRevision, expectedKind: 'video' };
		const loaded = await (request.playback
			? store.leaseRange(request.locatorId, loadOptions)
			: store.load(request.locatorId, loadOptions));
		if (loaded === null) return null;
		try {
			return loadedLinkedVideoLocator(
				loaded,
				request.playback ? READ_PROFILE_LINKED_VIDEO_RANGE_V1 : READ_PROFILE_MATERIALIZED_V1,
			);
		} catch (error) {
			await rollbackReadCapability(releaseRead, loaded, owner, error);
		}
	});
	handle(IPC.reconcileLinkedVideoOriginals, async (event, value) => nonNegativeSafeInteger(
		await store.reconcileStartup(
			linkedVideoReferences(value),
			{ owner: reference(ownerFor(event)) },
		),
		'Linked-video reconciliation removal count',
	));
	handle(IPC.releaseLinkedVideoOriginal, async (event, value) => {
		const locator = linkedVideoReferences([value])[0];
		return strictBoolean(await store.release(locator.locatorId, {
			owner: reference(ownerFor(event)),
			expectedRevision: locator.locatorRevision,
		}));
	});
	handle(IPC.reconcileLinkedOriginals, async (event, value) => nonNegativeSafeInteger(
		await store.reconcileStartup(
			linkedOriginalReferences(value),
			{ owner: reference(ownerFor(event)) },
		),
		'Linked-original reconciliation removal count',
	));
	handle(IPC.releaseLinkedOriginal, async (event, value) => {
		const locator = linkedOriginalReferences([value])[0];
		return strictBoolean(await store.release(locator.locatorId, {
			owner: reference(ownerFor(event)),
			expectedRevision: locator.locatorRevision,
			expectedKind: locator.kind,
		}));
	});
}

function assertDependencies({ dialog, handle, ownerFor, releaseRead, store, windowFor }) {
	if (!dialog || typeof dialog.showOpenDialog !== 'function'
		|| typeof handle !== 'function' || typeof ownerFor !== 'function'
		|| typeof windowFor !== 'function' || typeof releaseRead !== 'function'
		|| !store || typeof store !== 'object') {
		throw new TypeError('Linked-video IPC requires its main-process dependencies.');
	}
	for (const method of ['registerPath', 'load', 'leaseRange', 'reconcileStartup', 'release']) {
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

function selectedAudioPath(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| typeof value.canceled !== 'boolean' || !Array.isArray(value.filePaths)) {
		throw new TypeError('The linked-audio chooser returned an invalid result.');
	}
	if (value.canceled) return null;
	if (value.filePaths.length !== 1 || typeof value.filePaths[0] !== 'string'
		|| !isAbsolute(value.filePaths[0])) {
		throw new TypeError('The linked-audio chooser must return a single WAV audio path.');
	}
	const path = value.filePaths[0];
	const mimeType = mimeTypeForPath(path);
	if (!/\.(?:rf64|wav)$/iu.test(path)
		|| !['audio/rf64', 'audio/wav'].includes(mimeType)) {
		throw new TypeError('The selected WAV audio file type is not allowed.');
	}
	return path;
}

function linkedAudioLoadRequest(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-audio load request is required.');
	}
	const fields = ['locatorId', 'expectedRevision', 'range'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError('A linked-audio load request contains an unsupported field.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked-audio load ${field} must be an enumerable data field.`);
		}
	}
	if (value.range !== true && value.range !== false) {
		throw new TypeError('Linked-audio range mode must be a boolean.');
	}
	const expectedRevision = value.expectedRevision === null
		? null
		: opaqueToken(value.expectedRevision, 'Invalid linked-audio locator revision.');
	if (value.range && expectedRevision === null) {
		throw new TypeError('Linked-audio range reads require an exact locator revision.');
	}
	return Object.freeze({
		locatorId: opaqueToken(value.locatorId, 'Invalid linked-audio locator identifier.'),
		expectedRevision,
		range: value.range,
	});
}

function linkedVideoLoadRequest(value) {
	const request = closedLoadRequest(value);
	if (request.playback !== true && request.playback !== false) {
		throw new TypeError('Linked-video load mode must be a boolean.');
	}
	const expectedRevision = request.expectedRevision === null
		? null
		: opaqueToken(request.expectedRevision, 'Invalid linked-video locator revision.');
	if (request.playback && expectedRevision === null) {
		throw new TypeError('Linked-video playback requires an exact locator revision.');
	}
	return Object.freeze({
		locatorId: opaqueToken(request.locatorId, 'Invalid linked-video locator identifier.'),
		expectedRevision,
		playback: request.playback,
	});
}

function closedLoadRequest(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-video load request is required.');
	}
	const keys = Reflect.ownKeys(value);
	const fields = ['locatorId', 'expectedRevision', 'playback'];
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError('A linked-video load request contains an unsupported field.');
	}
	const output = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked-video load ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
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

function linkedOriginalReferences(value) {
	if (!Array.isArray(value) || value.length > MAX_LINKED_VIDEO_LOCATOR_REFERENCES) {
		throw new RangeError('Linked-original reconciliation reference count exceeds its limit.');
	}
	const identifiers = new Set();
	return Object.freeze(value.map((referenceValue) => {
		const reference = closedLinkedOriginalReference(referenceValue);
		const locatorId = opaqueToken(reference.locatorId, 'Invalid linked-original locator identifier.');
		if (identifiers.has(locatorId)) {
			throw new Error('Linked-original reconciliation contains duplicate locator identifiers.');
		}
		identifiers.add(locatorId);
		return Object.freeze({
			kind: mediaKind(reference.kind),
			locatorId,
			locatorRevision: opaqueToken(
				reference.locatorRevision,
				'Invalid linked-original locator revision.',
			),
		});
	}));
}

function closedLinkedOriginalReference(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-original locator reference is required.');
	}
	const fields = ['kind', 'locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError('A linked-original locator reference contains an unsupported field.');
	}
	const output = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked-original locator ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function closedReference(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked-video locator reference is required.');
	}
	const fields = ['locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError('A linked-video locator reference contains an unsupported field.');
	}
	const output = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked-video locator ${field} must be an enumerable data field.`);
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

function linkedAudioLocator(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The linked-audio locator is invalid.');
	}
	const name = audioName(value.name);
	return Object.freeze({
		locatorId: opaqueToken(value.locatorId, 'Invalid linked-audio locator identifier.'),
		locatorRevision: opaqueToken(value.locatorRevision, 'Invalid linked-audio locator revision.'),
		name,
		size: videoSize(value.size),
		mimeType: audioMimeType(value.mimeType, name),
		lastModified: nonNegativeSafeInteger(value.lastModified, 'Linked-audio modification time'),
	});
}

function loadedLinkedVideoLocator(value, readProfile) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The loaded linked-video locator is invalid.');
	}
	return Object.freeze({
		locatorRevision: opaqueToken(value.locatorRevision, 'Invalid linked-video locator revision.'),
		descriptor: videoReadDescriptor(value.descriptor, readProfile),
	});
}

function loadedLinkedAudioLocator(value, readProfile) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The loaded linked-audio locator is invalid.');
	}
	return Object.freeze({
		locatorRevision: opaqueToken(value.locatorRevision, 'Invalid linked-audio locator revision.'),
		descriptor: audioReadDescriptor(value.descriptor, readProfile),
	});
}

function audioReadDescriptor(value, readProfile) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.readProfile !== readProfile) {
		throw new TypeError(`Linked-audio reads require a ${readProfile} descriptor.`);
	}
	const id = opaqueToken(value.id, 'Invalid linked-audio read identifier.');
	const name = audioName(value.name);
	return Object.freeze({
		id,
		url: capabilityUrl(value.url, {
			id, name, readProfile,
		}),
		name,
		size: videoSize(value.size, readProfile),
		mimeType: audioMimeType(value.mimeType, name),
		readProfile,
		lastModified: nonNegativeSafeInteger(value.lastModified, 'Linked-audio modification time'),
	});
}

function videoReadDescriptor(value, readProfile) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.readProfile !== readProfile) {
		throw new TypeError(`Linked-video reads require a ${readProfile} descriptor.`);
	}
	const id = opaqueToken(value.id, 'Invalid linked-video read identifier.');
	const name = videoName(value.name);
	const mimeType = videoMimeType(value.mimeType);
	const descriptor = Object.freeze({
		id,
		url: capabilityUrl(value.url, { id, name, readProfile }),
		name,
		size: videoSize(value.size, readProfile),
		mimeType,
		readProfile,
		lastModified: nonNegativeSafeInteger(value.lastModified, 'Linked-video modification time'),
	});
	return descriptor;
}

function capabilityUrl(value, { id, name, readProfile }) {
	const expected = `${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${readProfile}/${id}/${encodeURIComponent(name)}`;
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

function audioName(value) {
	const name = videoName(value);
	if (!/\.(?:rf64|wav)$/iu.test(name)) throw new TypeError('Invalid linked-audio WAV name.');
	return name;
}

function audioMimeType(value, name) {
	if ((/\.wav$/iu.test(name) && value === 'audio/wav')
		|| (/\.rf64$/iu.test(name) && value === 'audio/rf64')) return value;
	throw new TypeError('Invalid linked-audio WAV MIME type.');
}

function mediaKind(value) {
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('Invalid linked-original media kind.');
	}
	return value;
}

function videoSize(value, readProfile = READ_PROFILE_MATERIALIZED_V1) {
	const size = nonNegativeSafeInteger(value, 'Linked-video size');
	const maximum = [READ_PROFILE_LINKED_AUDIO_RANGE_V1, READ_PROFILE_LINKED_VIDEO_RANGE_V1].includes(readProfile)
		? MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES
		: MAX_READ_CAPABILITY_BYTES_PER_OWNER;
	if (size < 1 || size > maximum) {
		throw new RangeError('Linked-video size exceeds its read limit.');
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

async function rollbackLocator(store, locator, owner, cause, kind = 'video') {
	const reference = possibleLocatorReference(locator);
	if (!reference) throw cause;
	try {
		if (await store.release(reference.locatorId, {
			owner, expectedRevision: reference.locatorRevision,
			...(kind === 'video' ? {} : { expectedKind: kind }),
		}) !== true) throw new Error('Linked-video locator cleanup was not acknowledged.');
	} catch (cleanupError) {
		throw new AggregateError(
			[cause, cleanupError],
			'Linked-video locator validation and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw cause;
}

function possibleLocatorReference(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const fields = ['locatorId', 'locatorRevision'];
	const output = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.value)) return null;
		output[field] = descriptor.value;
	}
	return Object.freeze(output);
}

async function rollbackReadCapability(releaseRead, loaded, owner, cause) {
	let id;
	try {
		id = opaqueToken(loaded?.descriptor?.id, 'Invalid linked-video read identifier.');
	} catch {
		throw cause;
	}
	try {
		if (await releaseRead(id, owner) !== true) {
			throw new Error('Linked-video read cleanup was not acknowledged.');
		}
	} catch (cleanupError) {
		throw new AggregateError(
			[cause, cleanupError],
			'Linked-video read validation and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw cause;
}
