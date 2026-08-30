/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, dialog, ipcMain, MessageChannelMain, screen } from 'electron/main';

import { SESSION_PARTITION } from './constants.js';

const SINK_CONNECT_CHANNEL = 'framescaper:external-display:v1:connect';
const SINK_CLOSE_CHANNEL = 'framescaper:external-display:v1:close';
const FRAME_CHANNEL = 'framescaper:external-display:v1:frame';
const SINK_HTML = join(import.meta.dirname, 'external-display-sink.html');
const SINK_PRELOAD = join(import.meta.dirname, 'external-display-sink-preload.cjs');
const SHA256 = /^[a-f0-9]{64}$/u;

/** Electron-only window, chooser, and display seams kept out of the main composition root. */
export function createFramescaperNativeServicesElectronPorts(settings, reportError) {
	if (!settings || typeof settings.snapshot !== 'function' || typeof reportError !== 'function') {
		throw new TypeError('Framescaper native-service Electron ports require settings and error seams.');
	}
	return Object.freeze({
		onServiceError: reportError,
		createMessageChannel: () => {
			const channel = new MessageChannelMain();
			return Object.freeze({ hostPort: channel.port1, helperPort: channel.port2 });
		},
		selectDirectory: async () => {
			const result = await dialog.showOpenDialog({
				title: 'Choose Framescaper media folder',
				properties: ['openDirectory', 'createDirectory'],
			});
			return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
		},
		selectImageSequenceFiles: async () => {
			const result = await dialog.showOpenDialog({
				title: 'Import Framescaper image sequence',
				properties: ['openFile', 'multiSelections'],
				filters: [
					{ name: 'Image sequence frames', extensions: ['png', 'tif', 'tiff', 'exr'] },
				],
			});
			return result.canceled || result.filePaths.length === 0
				? null
				: Object.freeze([...result.filePaths]);
		},
		selectOpenFxPluginBinary: async () => {
			const result = await dialog.showOpenDialog({
				title: 'Choose OpenFX plug-in binary', properties: ['openFile'],
			});
			return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
		},
		externalDisplay: Object.freeze({
			platform: process.platform,
			linuxSessionType: process.env.XDG_SESSION_TYPE,
			isEnabled: () => settings.snapshot().nativeMediaEnabled === true,
			listDisplays,
			createWindow: (options) => createWindow(options, reportError),
			sinkSelfTestPassed: () => existsSync(SINK_HTML) && existsSync(SINK_PRELOAD),
			subscribe,
			onError: reportError,
		}),
	});
}

function listDisplays() {
	const primaryId = screen.getPrimaryDisplay().id;
	return screen.getAllDisplays().map((display) => Object.freeze({
		displayId: String(display.id),
		label: String(display.label || `Display ${String(display.id)}`).slice(0, 256),
		primary: display.id === primaryId,
		width: display.size.width,
		height: display.size.height,
		// Electron exposes no cross-platform proof for these; qualification stays fail-closed.
		hdrCapable: false,
		colorManaged: false,
		bounds: Object.freeze({
			x: display.bounds.x,
			y: display.bounds.y,
			width: display.bounds.width,
			height: display.bounds.height,
		}),
	}));
}

function subscribe(listener) {
	const events = ['display-added', 'display-removed', 'display-metrics-changed'];
	for (const event of events) screen.on(event, listener);
	return () => { for (const event of events) screen.removeListener(event, listener); };
}

function createWindow(options, reportError) {
	const { bounds, ...windowOptions } = options;
	const window = new BrowserWindow({
		...windowOptions,
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		webPreferences: {
			...windowOptions.webPreferences,
			partition: SESSION_PARTITION,
			webviewTag: false,
			preload: SINK_PRELOAD,
			backgroundThrottling: false,
		},
	});
	let port = null;
	let pending = null;
	let closed = false;
	const closeListener = (event, value) => {
		if (event.sender !== window.webContents || !value || typeof value !== 'object'
			|| Object.keys(value).length !== 1
			|| !['escape-key', 'port-loss', 'frame-refused'].includes(value.reason)) return;
		window.close();
	};
	ipcMain.on(SINK_CLOSE_CHANNEL, closeListener);
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	const sinkUrl = pathToFileURL(SINK_HTML).href;
	window.webContents.on('will-navigate', (event, destination) => {
		if (destination !== sinkUrl) event.preventDefault();
	});
	window.once('closed', () => {
		closed = true;
		ipcMain.removeListener(SINK_CLOSE_CHANNEL, closeListener);
		port?.close();
		port = null;
	});
	return Object.freeze({
		load: async () => {
			await window.loadFile(SINK_HTML);
			if (closed || window.isDestroyed()) throw new Error('The external-display sink closed while loading.');
			const channel = new MessageChannelMain();
			port = channel.port1;
			port.on('message', ({ data }) => {
				try {
					if (!data || typeof data !== 'object'
						|| Object.keys(data).sort().join('|') !== 'sequence|sha256|type|version'
						|| data.version !== 1 || data.type !== 'presented'
						|| data.sequence !== pending?.sequence || data.sha256 !== pending?.sha256
						|| !SHA256.test(data.sha256)) {
						throw new Error('The external-display sink returned an invalid acknowledgement.');
					}
					pending = null;
				} catch (error) {
					reportError(error);
					window.close();
				}
			});
			port.on('close', () => { if (!closed && !window.isDestroyed()) window.close(); });
			port.start();
			window.webContents.postMessage(SINK_CONNECT_CHANNEL, Object.freeze({
				version: 1, pixelFormat: 'rgba8', colorSpace: 'srgb',
			}), [channel.port2]);
		},
		show: () => window.show(),
		close: () => window.close(),
		isDestroyed: () => window.isDestroyed(),
		setBounds: (bounds) => window.setBounds(bounds),
		send: (channel, payload) => {
			if (channel !== FRAME_CHANNEL || port === null || pending !== null) {
				throw new Error('The external-display sink is unavailable or applying backpressure.');
			}
			pending = Object.freeze({ sequence: payload.sequence, sha256: payload.rgbaSha256 });
			try { port.postMessage(Object.freeze({ version: 1, type: 'frame', ...payload })); }
			catch (error) { pending = null; throw error; }
		},
		onClosed: (listener) => window.once('closed', listener),
	});
}
