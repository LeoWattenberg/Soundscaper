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

const api = Object.freeze({
	getEnvironment: () => ipcRenderer.invoke(CHANNELS.environment),
	chooseFiles: (options) => ipcRenderer.invoke(CHANNELS.chooseFiles, {
		purpose: text(options?.purpose, 24),
		multiple: options?.multiple === true,
	}),
	releaseRead: (id) => ipcRenderer.invoke(CHANNELS.releaseRead, opaqueId(id, 64)),
	chooseSaveTarget: (options) => ipcRenderer.invoke(CHANNELS.chooseSaveTarget, {
		purpose: text(options?.purpose, 24),
		suggestedName: text(options?.suggestedName, 220),
	}),
	beginWrite: (options) => ipcRenderer.invoke(CHANNELS.beginWrite, {
		targetId: opaqueId(options?.targetId, 48),
		size: safeInteger(options?.size),
	}),
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

contextBridge.exposeInMainWorld('soundscaperDesktop', Object.freeze({ v1: api }));

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
		size: safeInteger(value?.size),
		mimeType: text(value?.mimeType, 128),
		lastModified: safeInteger(value?.lastModified),
	});
}

function trustedCapabilityUrl(value, id) {
	const url = new URL(String(value || ''));
	if (url.protocol !== 'soundscaper-app:' || url.hostname !== 'bundle' || !url.pathname.startsWith(`/_desktop/read/${opaqueId(id, 64)}/`)) {
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

function binary(value) {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected binary data');
}
