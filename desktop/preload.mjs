/*
 * Electron sandbox preloads run as plain scripts with a restricted require
 * polyfill. The .mjs filename is the packaging contract; ESM imports are not
 * available while BrowserWindow sandboxing is enabled.
 */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
	environment: 'soundscaper:v1:environment',
	chooseFiles: 'soundscaper:v1:files:choose',
	releaseRead: 'soundscaper:v1:files:release',
	chooseLinkedVideoOriginal: 'soundscaper:v1:linked-video:choose',
	loadLinkedVideoOriginal: 'soundscaper:v1:linked-video:load',
	reconcileLinkedVideoOriginals: 'soundscaper:v1:linked-video:reconcile',
	releaseLinkedVideoOriginal: 'soundscaper:v1:linked-video:release',
	chooseSaveTarget: 'soundscaper:v1:save:choose',
	beginWrite: 'soundscaper:v1:save:begin',
	writeChunk: 'soundscaper:v1:save:chunk',
	finishWrite: 'soundscaper:v1:save:finish',
	abortWrite: 'soundscaper:v1:save:abort',
	listSharedProjects: 'soundscaper:v1:projects:list',
	readSharedProject: 'soundscaper:v1:projects:read',
	readSharedProjectBundle: 'soundscaper:v1:projects:bundle',
	commitSharedProject: 'soundscaper:v1:projects:commit',
	deleteSharedProject: 'soundscaper:v1:projects:delete',
	beginSharedSourceWrite: 'soundscaper:v1:projects:sources:begin',
	writeSharedSourceChunk: 'soundscaper:v1:projects:sources:chunk',
	finishSharedSourceWrite: 'soundscaper:v1:projects:sources:finish',
	abortSharedSourceWrite: 'soundscaper:v1:projects:sources:abort',
	readSharedSourceChunk: 'soundscaper:v1:projects:sources:read',
	setLocale: 'soundscaper:v1:locale:set',
	setFullscreen: 'soundscaper:v1:fullscreen:set',
	checkForUpdates: 'soundscaper:v1:updates:check',
	openExternal: 'soundscaper:v1:external:open',
	editText: 'soundscaper:v1:text:edit',
	rendererReady: 'soundscaper:v1:renderer:ready',
	respondToClose: 'soundscaper:v1:close:respond',
	openProject: 'soundscaper:v1:event:project-open',
	menuCommand: 'soundscaper:v1:event:menu-command',
	closeRequested: 'soundscaper:v1:event:close-requested',
	fullscreenChanged: 'soundscaper:v1:event:fullscreen-changed',
});

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const READ_PROFILE_MATERIALIZED_V1 = 'materialized-v1';
const READ_PROFILE_SCAPE_RANGE_V1 = 'scape-range-v1';
const SCAPE_PROJECT_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const MAX_MATERIALIZED_READ_DESCRIPTOR_BYTES = 512 * 1024 ** 2;
const MAX_SCAPE_RANGE_READ_DESCRIPTOR_BYTES = 65 * 1024 ** 3;
const MAX_DESKTOP_SAVE_BYTES = 65 * 1024 ** 3;
const MAX_SHARED_PROJECT_DOCUMENT_BYTES = 256 * 1024 ** 2;
const MAX_SHARED_PROJECT_ID_BYTES = 4 * 1024;
const MAX_SHARED_PROJECTS = 10_000;
const MAX_SHARED_SOURCE_BYTES = 64 * 1024 ** 3;
const MAX_SHARED_SOURCES = 4_094;
const MANAGED_AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const MANAGED_VIDEO_ENCODING = 'video-original-v1';
const MANAGED_BINDING_ID = /^[mv][a-f0-9]{64}$/u;
const SOURCE_WRITE_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SHARED_PROJECT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const api = Object.freeze({
	getEnvironment: () => ipcRenderer.invoke(CHANNELS.environment),
	chooseFiles: (options) => ipcRenderer.invoke(CHANNELS.chooseFiles, {
		purpose: text(options?.purpose, 24),
		multiple: options?.multiple === true,
	}).then(sanitizeReadDescriptors),
	releaseRead: (id) => ipcRenderer.invoke(CHANNELS.releaseRead, opaqueId(id, 64)),
	chooseLinkedVideoOriginal: () => ipcRenderer.invoke(CHANNELS.chooseLinkedVideoOriginal).then(nullableLinkedVideoLocator),
	loadLinkedVideoOriginal: (value) => ipcRenderer.invoke(
		CHANNELS.loadLinkedVideoOriginal, linkedVideoLoadRequest(value),
	).then(nullableLoadedLinkedVideoLocator),
	reconcileLinkedVideoOriginals: (value) => ipcRenderer.invoke(CHANNELS.reconcileLinkedVideoOriginals, linkedVideoReferences(value)).then(safeInteger),
	releaseLinkedVideoOriginal: (locatorId) => ipcRenderer.invoke(CHANNELS.releaseLinkedVideoOriginal, opaqueId(locatorId, 64)).then(strictBoolean),
	chooseSaveTarget: (options) => ipcRenderer.invoke(CHANNELS.chooseSaveTarget, {
		purpose: text(options?.purpose, 24),
		suggestedName: text(options?.suggestedName, 220),
	}),
	beginWrite: (options) => ipcRenderer.invoke(CHANNELS.beginWrite, saveDeclaration(options)),
	writeChunk: (options) => {
		const bytes = binary(options?.bytes);
		if (bytes.byteLength > MAX_CHUNK_BYTES) throw new RangeError('Save chunk is too large');
		return ipcRenderer.invoke(CHANNELS.writeChunk, {
			writeId: opaqueId(options?.writeId, 32),
			offset: safeInteger(options?.offset),
			bytes,
		});
	},
	finishWrite: (writeId) => ipcRenderer.invoke(CHANNELS.finishWrite, opaqueId(writeId, 32)),
	abortWrite: (writeId) => ipcRenderer.invoke(CHANNELS.abortWrite, opaqueId(writeId, 32)),
	listSharedProjects: () => ipcRenderer.invoke(CHANNELS.listSharedProjects).then(sharedProjectSummaries),
	readSharedProject: (projectId) => ipcRenderer.invoke(
		CHANNELS.readSharedProject,
		sharedProjectId(projectId),
	).then(nullableProjectDocument),
	readSharedProjectBundle: (projectId) => ipcRenderer.invoke(
		CHANNELS.readSharedProjectBundle,
		sharedProjectId(projectId),
	).then(nullableProjectBundle),
	commitSharedProject: (document) => ipcRenderer.invoke(
		CHANNELS.commitSharedProject,
		projectDocument(document),
	).then(projectDocument),
	deleteSharedProject: (projectId) => ipcRenderer.invoke(
		CHANNELS.deleteSharedProject,
		sharedProjectId(projectId),
	).then(strictBoolean),
	beginSharedSourceWrite: (declaration) => ipcRenderer.invoke(
		CHANNELS.beginSharedSourceWrite,
		sharedSourceWriteDeclaration(declaration),
	).then(sharedSourceWriteAdmission),
	writeSharedSourceChunk: (value) => ipcRenderer.invoke(
		CHANNELS.writeSharedSourceChunk,
		sharedSourceChunkWrite(value),
	).then(sharedSourceChunkAcknowledgement),
	finishSharedSourceWrite: (value) => ipcRenderer.invoke(
		CHANNELS.finishSharedSourceWrite,
		sharedSourceWriteCompletion(value),
	).then(sharedManagedSourceDescriptor),
	abortSharedSourceWrite: (writeId) => ipcRenderer.invoke(
		CHANNELS.abortSharedSourceWrite,
		sharedSourceWriteId(writeId),
	).then(strictBoolean),
	readSharedSourceChunk: (value) => {
		const request = sharedSourceChunkRead(value);
		return ipcRenderer.invoke(CHANNELS.readSharedSourceChunk, request)
			.then((bytes) => sharedSourceChunkResult(bytes, request.length));
	},
	setLocale: (locale) => ipcRenderer.invoke(CHANNELS.setLocale, text(locale, 32)),
	setFullscreen: (enabled) => ipcRenderer.invoke(CHANNELS.setFullscreen, enabled === true),
	checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
	openExternal: (destination) => ipcRenderer.invoke(CHANNELS.openExternal, text(destination, 32)),
	editText: (command) => ipcRenderer.invoke(CHANNELS.editText, textEditCommand(command)),
	signalReady: () => ipcRenderer.send(CHANNELS.rendererReady),
	respondToClose: (response) => ipcRenderer.send(CHANNELS.respondToClose, {
		requestId: text(response?.requestId, 64),
		allow: response?.allow === true,
	}),
	onOpenProject: (listener) => subscribe(CHANNELS.openProject, listener, sanitizeReadDescriptor),
	onMenuCommand: (listener) => subscribe(CHANNELS.menuCommand, listener, (value) => Object.freeze({ command: text(value?.command, 64) })),
	onCloseRequested: (listener) => subscribe(CHANNELS.closeRequested, listener, (value) => Object.freeze({
		requestId: text(value?.requestId, 64),
		reason: value?.reason === 'quit' ? 'quit' : 'window-close',
	})),
	onFullscreenChanged: (listener) => subscribe(CHANNELS.fullscreenChanged, listener, (value) => Object.freeze({ fullscreen: value?.fullscreen === true })),
});

const bridge = Object.freeze({ v1: api });
contextBridge.exposeInMainWorld('scapeDesktop', bridge);
contextBridge.exposeInMainWorld('soundscaperDesktop', bridge);
contextBridge.exposeInMainWorld('framescaperDesktop', bridge);

function subscribe(channel, listener, sanitize) {
	if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
	const handler = (_event, value) => listener(sanitize(value));
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
}

function sanitizeReadDescriptor(value) {
	const id = opaqueId(value?.id, 64);
	const readProfile = readDescriptorProfile(value?.readProfile);
	const name = readDescriptorName(value?.name);
	const mimeType = readDescriptorMimeType(value?.mimeType);
	assertReadDescriptorProfile(readProfile, name, mimeType);
	return Object.freeze({
		id,
		readProfile,
		url: trustedCapabilityUrl(value?.url, { id, readProfile, name }),
		name,
		size: readDescriptorSize(value?.size, readProfile),
		mimeType,
		lastModified: safeInteger(value?.lastModified),
	});
}

function sanitizeReadDescriptors(values) {
	if (!Array.isArray(values)) throw new TypeError('Expected read descriptors');
	return Object.freeze(values.map(sanitizeReadDescriptor));
}

function nullableLinkedVideoLocator(value) {
	if (value === null) return null;
	const mimeType = linkedVideoMimeType(value?.mimeType);
	const size = readDescriptorSize(value?.size, READ_PROFILE_MATERIALIZED_V1);
	if (size === 0) throw new RangeError('Linked-video size must be positive');
	return Object.freeze({
		locatorId: opaqueId(value?.locatorId, 64), locatorRevision: linkedVideoRevision(value?.locatorRevision),
		name: readDescriptorName(value?.name), size, mimeType,
		lastModified: safeInteger(value?.lastModified),
	});
}

function linkedVideoLoadRequest(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A linked-video load request is required');
	return Object.freeze({
		locatorId: opaqueId(value.locatorId, 64),
		expectedRevision: value.expectedRevision === null ? null : linkedVideoRevision(value.expectedRevision),
	});
}
function linkedVideoReferences(value) {
	if (!Array.isArray(value) || value.length > 128) throw new RangeError('Linked-video reconciliation reference count exceeds its limit');
	const identifiers = new Set();
	return Object.freeze(value.map((reference) => {
		const fields = ['locatorId', 'locatorRevision'];
		const keys = reference && typeof reference === 'object' && !Array.isArray(reference) ? Reflect.ownKeys(reference) : [];
		if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) || fields.some((field) => {
			const descriptor = Object.getOwnPropertyDescriptor(reference, field); return !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
		})) throw new TypeError('Linked-video reconciliation reference contains an unsupported field');
		const locatorId = opaqueId(reference.locatorId, 64);
		if (identifiers.has(locatorId)) throw new Error('Linked-video reconciliation contains a duplicate identifier');
		identifiers.add(locatorId);
		return Object.freeze({ locatorId, locatorRevision: linkedVideoRevision(reference.locatorRevision) });
	}));
}
function nullableLoadedLinkedVideoLocator(value) {
	if (value === null) return null;
	const descriptor = sanitizeReadDescriptor(value?.descriptor);
	if (descriptor.readProfile !== READ_PROFILE_MATERIALIZED_V1 || descriptor.size === 0) throw new TypeError('Linked-video reads require a positive materialized-v1 descriptor');
	linkedVideoMimeType(descriptor.mimeType);
	return Object.freeze({ locatorRevision: linkedVideoRevision(value?.locatorRevision), descriptor });
}
function linkedVideoRevision(value) { try { return opaqueId(value, 64); } catch { throw new TypeError('Invalid linked-video locator revision'); } }
function linkedVideoMimeType(value) {
	const mimeType = readDescriptorMimeType(value);
	if (!/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)) throw new TypeError('Invalid linked-video MIME type');
	return mimeType;
}
function trustedCapabilityUrl(value, { id, readProfile, name }) {
	let url;
	try { url = new URL(String(value || '')); } catch { throw new TypeError('Invalid read capability URL'); }
	const expectedPath = `/_desktop/read/${readProfile}/${id}/${encodeURIComponent(name)}`;
	if (!['soundscaper-app:', 'framescaper-app:'].includes(url.protocol)
		|| url.hostname !== 'bundle' || url.port || url.username || url.password
		|| url.search || url.hash || url.pathname !== expectedPath) {
		throw new TypeError('Invalid read capability URL');
	}
	return url.href;
}

function opaqueId(value, length) {
	const id = String(value || '');
	if (id.length !== length || !/^[a-f0-9]+$/u.test(id)) throw new TypeError('Invalid opaque identifier');
	return id;
}

function text(value, maxLength) {
	return String(value || '').replace(/[\u0000-\u001f]/gu, '').slice(0, maxLength);
}

function textEditCommand(value) {
	const command = String(value || '');
	if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(command)) throw new TypeError('Unsupported text edit command');
	return command;
}

function safeInteger(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('Expected a non-negative safe integer');
	return number;
}

function readDescriptorProfile(value) {
	const profile = String(value || '');
	if (![READ_PROFILE_MATERIALIZED_V1, READ_PROFILE_SCAPE_RANGE_V1].includes(profile)) {
		throw new TypeError('Invalid read descriptor profile');
	}
	return profile;
}

function readDescriptorName(value) {
	const name = text(value, 255);
	if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
		throw new TypeError('Invalid read descriptor name');
	}
	return name;
}

function readDescriptorMimeType(value) {
	const mimeType = text(value, 128);
	if (!mimeType) throw new TypeError('Invalid read descriptor MIME type');
	return mimeType;
}

function assertReadDescriptorProfile(readProfile, name, mimeType) {
	const hasScapeName = /\.scape$/iu.test(name);
	const hasScapeMime = mimeType === SCAPE_PROJECT_MIME_TYPE;
	if (readProfile === READ_PROFILE_SCAPE_RANGE_V1) {
		if (!hasScapeName || !hasScapeMime) throw new TypeError('Invalid Scape range read descriptor');
	} else if (hasScapeName || hasScapeMime) {
		throw new TypeError('Invalid materialized read descriptor profile');
	}
}

function readDescriptorSize(value, readProfile) {
	const size = safeInteger(value);
	const maximum = readProfile === READ_PROFILE_SCAPE_RANGE_V1
		? MAX_SCAPE_RANGE_READ_DESCRIPTOR_BYTES
		: MAX_MATERIALIZED_READ_DESCRIPTOR_BYTES;
	if (size > maximum) throw new RangeError('Read descriptor is too large for its profile');
	return size;
}

function saveDeclaration(options) {
	const targetId = opaqueId(options?.targetId, 48);
	const exactSize = options?.size !== undefined;
	if (exactSize === (options?.maximumSize !== undefined)) {
		throw new RangeError('Expected exactly one exact size or admitted maximum');
	}
	return exactSize
		? { targetId, size: saveSize(options.size) }
		: { targetId, maximumSize: saveSize(options.maximumSize) };
}

function saveSize(value) {
	const size = safeInteger(value);
	if (size > MAX_DESKTOP_SAVE_BYTES) throw new RangeError('Save size is too large');
	return size;
}

function sharedProjectSummaries(value) {
	if (!Array.isArray(value) || value.length > MAX_SHARED_PROJECTS) {
		throw new RangeError('Desktop shared-project service returned an invalid project count');
	}
	const summaries = Array.from(value, (summary) => Object.freeze({
		id: sharedProjectId(summary?.id),
		title: sharedProjectTitle(summary?.title),
		revision: safeInteger(summary?.revision),
		updatedAt: sharedProjectInstant(summary?.updatedAt),
	}));
	if (new Set(summaries.map(({ id }) => id)).size !== summaries.length) {
		throw new TypeError('Desktop shared-project service returned duplicate project ids');
	}
	return Object.freeze(summaries);
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

function sharedProjectTitle(value) {
	if (typeof value !== 'string' || !value || value.length > 255
		|| value.trim() !== value || hasControlCharacters(value)) {
		throw new TypeError('Desktop shared-project title is invalid');
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

function sharedProjectInstant(value) {
	if (typeof value !== 'string' || !SHARED_PROJECT_INSTANT.test(value)) {
		throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	}
	const date = new Date(value);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	}
	return value;
}

function projectDocument(value, maximumBytes = MAX_SHARED_PROJECT_DOCUMENT_BYTES) {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
		|| maximumBytes > MAX_SHARED_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Desktop shared-project document byte limit cannot exceed its hard limit');
	}
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError('Desktop shared-project document must be a non-empty string');
	}
	if (utf8Bytes(value, maximumBytes) > maximumBytes) {
		throw new RangeError('Desktop shared-project document exceeds its byte limit');
	}
	return value;
}

function nullableProjectDocument(value) {
	return value === null ? null : projectDocument(value);
}

function nullableProjectBundle(value) {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Array.isArray(value.sources) || value.sources.length > MAX_SHARED_SOURCES) {
		throw new TypeError('Desktop shared-project bundle is invalid');
	}
	const sources = Object.freeze(value.sources.map(sharedManagedSourceDescriptor));
	if (new Set(sources.map(({ sourceId }) => sourceId)).size !== sources.length) {
		throw new TypeError('Desktop shared-project bundle contains duplicate source identities');
	}
	return Object.freeze({ document: projectDocument(value.document), sources });
}

function sharedManagedSourceDescriptor(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor is invalid');
	}
	const encoding = sharedManagedSourceEncoding(value.kind, value.encoding);
	const bindingId = sharedManagedBindingId(value.bindingId);
	const byteLength = sharedSourceBytes(value.byteLength);
	if (bindingId[0] !== (value.kind === 'audio' ? 'm' : 'v')) {
		throw new TypeError('Desktop shared-source descriptor is invalid');
	}
	if (value.kind === 'video' && byteLength === 0) {
		throw new RangeError('Desktop shared-source original video byte length must be positive');
	}
	return Object.freeze({
		bindingId,
		byteLength,
		encoding,
		kind: value.kind,
		sha256: sharedSourceSha256(value.sha256),
		sourceId: sharedSourceIdentity(value.sourceId),
		storageKey: sharedSourceIdentity(value.storageKey),
	});
}

function sharedSourceWriteDeclaration(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write declaration is invalid');
	}
	const encoding = sharedManagedEncoding(value.encoding);
	const byteLength = sharedSourceBytes(value.byteLength);
	if (encoding === MANAGED_VIDEO_ENCODING && byteLength === 0) {
		throw new RangeError('Desktop shared-source original video byte length must be positive');
	}
	return Object.freeze({
		byteLength,
		encoding,
		projectId: sharedProjectId(value.projectId),
		projectRevision: safeInteger(value.projectRevision),
		sha256: sharedSourceSha256(value.sha256),
		sourceId: sharedSourceIdentity(value.sourceId),
	});
}

function sharedSourceWriteAdmission(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write admission is invalid');
	}
	if (value.status === 'present') {
		return Object.freeze({ status: 'present', source: sharedManagedSourceDescriptor(value.source) });
	}
	if (value.status !== 'ready') throw new TypeError('Desktop shared-source write admission is invalid');
	const chunkSize = positiveSafeInteger(value.chunkSize);
	if (chunkSize > MAX_CHUNK_BYTES) throw new RangeError('Desktop shared-source chunk size is too large');
	return Object.freeze({ status: 'ready', chunkSize, writeId: sharedSourceWriteId(value.writeId) });
}

function sharedSourceChunkWrite(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk write is invalid');
	}
	const bytes = binary(value.bytes);
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk is too large');
	}
	return Object.freeze({
		bytes,
		offset: safeInteger(value.offset),
		writeId: sharedSourceWriteId(value.writeId),
	});
}

function sharedSourceChunkAcknowledgement(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk acknowledgement is invalid');
	}
	return Object.freeze({ nextOffset: safeInteger(value.nextOffset) });
}

function sharedSourceWriteCompletion(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write completion is invalid');
	}
	return Object.freeze({
		sha256: sharedSourceSha256(value.sha256),
		writeId: sharedSourceWriteId(value.writeId),
	});
}

function sharedSourceChunkRead(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk read is invalid');
	}
	const length = positiveSafeInteger(value.length);
	if (length > MAX_CHUNK_BYTES) throw new RangeError('Desktop shared-source read is too large');
	return Object.freeze({
		bindingId: sharedManagedBindingId(value.bindingId),
		length,
		offset: safeInteger(value.offset),
	});
}

function sharedSourceChunkResult(value, expectedLength) {
	const bytes = binary(value);
	if (bytes.byteLength !== expectedLength) {
		throw new Error('Desktop shared-source read returned an unexpected byte length');
	}
	return bytes;
}

function sharedSourceIdentity(value) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop shared-source identity is invalid');
	}
	if (utf8Bytes(value, MAX_SHARED_PROJECT_ID_BYTES) > MAX_SHARED_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop shared-source identity exceeds its byte limit');
	}
	return value;
}

function sharedSourceBytes(value) {
	const bytes = safeInteger(value);
	if (bytes > MAX_SHARED_SOURCE_BYTES) throw new RangeError('Desktop shared-source byte length is too large');
	return bytes;
}

function sharedSourceWriteId(value) {
	if (typeof value !== 'string' || !SOURCE_WRITE_ID.test(value)) {
		throw new TypeError('Desktop shared-source write id is invalid');
	}
	return value;
}

function sharedManagedBindingId(value) {
	if (typeof value !== 'string' || !MANAGED_BINDING_ID.test(value)) {
		throw new TypeError('Desktop shared-source binding id is invalid');
	}
	return value;
}

function sharedManagedEncoding(value) {
	if (value !== MANAGED_AUDIO_ENCODING && value !== MANAGED_VIDEO_ENCODING) {
		throw new TypeError('Desktop shared-source media encoding is unsupported');
	}
	return value;
}

function sharedManagedSourceEncoding(kind, encoding) {
	const admitted = sharedManagedEncoding(encoding);
	if ((kind === 'audio' && admitted === MANAGED_AUDIO_ENCODING)
		|| (kind === 'video' && admitted === MANAGED_VIDEO_ENCODING)) return admitted;
	throw new TypeError('Desktop shared-source kind and encoding do not match');
}

function sharedSourceSha256(value) {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Desktop shared-source SHA-256 digest is invalid');
	}
	return value;
}

function positiveSafeInteger(value) {
	const number = safeInteger(value);
	if (number === 0) throw new RangeError('Expected a positive safe integer');
	return number;
}

function strictBoolean(value) {
	if (typeof value !== 'boolean') throw new TypeError('Desktop shared-project delete result must be a boolean');
	return value;
}

function utf8Bytes(value, maximumBytes) {
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
		if (bytes > maximumBytes) return bytes;
	}
	return bytes;
}

function binary(value) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected binary data');
}
