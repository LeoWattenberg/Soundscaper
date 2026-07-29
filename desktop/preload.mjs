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
	chooseSaveTarget: 'soundscaper:v1:save:choose',
	beginWrite: 'soundscaper:v1:save:begin',
	writeChunk: 'soundscaper:v1:save:chunk',
	finishWrite: 'soundscaper:v1:save:finish',
	abortWrite: 'soundscaper:v1:save:abort',
	listSharedProjects: 'soundscaper:v1:projects:list',
	readSharedProject: 'soundscaper:v1:projects:read',
	commitSharedProject: 'soundscaper:v1:projects:commit',
	deleteSharedProject: 'soundscaper:v1:projects:delete',
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

const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_READ_DESCRIPTOR_BYTES = 512 * 1024 ** 2;
const MAX_DESKTOP_SAVE_BYTES = 65 * 1024 ** 3;
const MAX_SHARED_PROJECT_DOCUMENT_BYTES = 256 * 1024 ** 2;
const MAX_SHARED_PROJECT_ID_BYTES = 4 * 1024;
const MAX_SHARED_PROJECTS = 10_000;
const SHARED_PROJECT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const api = Object.freeze({
	getEnvironment: () => ipcRenderer.invoke(CHANNELS.environment),
	chooseFiles: (options) => ipcRenderer.invoke(CHANNELS.chooseFiles, {
		purpose: text(options?.purpose, 24),
		multiple: options?.multiple === true,
	}).then(sanitizeReadDescriptors),
	releaseRead: (id) => ipcRenderer.invoke(CHANNELS.releaseRead, opaqueId(id, 64)),
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
	commitSharedProject: (document) => ipcRenderer.invoke(
		CHANNELS.commitSharedProject,
		projectDocument(document),
	).then(projectDocument),
	deleteSharedProject: (projectId) => ipcRenderer.invoke(
		CHANNELS.deleteSharedProject,
		sharedProjectId(projectId),
	).then(strictBoolean),
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
	return Object.freeze({
		id: opaqueId(value?.id, 64),
		url: trustedCapabilityUrl(value?.url, value?.id),
		name: text(value?.name, 255),
		size: readDescriptorSize(value?.size),
		mimeType: text(value?.mimeType, 128),
		lastModified: safeInteger(value?.lastModified),
	});
}

function sanitizeReadDescriptors(values) {
	if (!Array.isArray(values)) throw new TypeError('Expected read descriptors');
	return Object.freeze(values.map(sanitizeReadDescriptor));
}

function trustedCapabilityUrl(value, id) {
	const url = new URL(String(value || ''));
	if (!['soundscaper-app:', 'framescaper-app:'].includes(url.protocol) || url.hostname !== 'bundle' || !url.pathname.startsWith(`/_desktop/read/${opaqueId(id, 64)}/`)) {
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

function readDescriptorSize(value) {
	const size = safeInteger(value);
	if (size > MAX_READ_DESCRIPTOR_BYTES) throw new RangeError('Read descriptor is too large');
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
