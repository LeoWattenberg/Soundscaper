/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperWebVcrPreloadBridgeV1,
} from './framescaper-web-vcr-preload.ts';

declare const require: (specifier: 'electron') => Readonly<{
	contextBridge: Readonly<{ exposeInMainWorld(name: string, value: unknown): void }>;
	ipcRenderer: Readonly<{
		invoke(channel: string, value?: unknown): Promise<unknown>;
		on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
		removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
	}>;
}>;

const { contextBridge, ipcRenderer } = require('electron');
const api = createFramescaperWebVcrPreloadBridgeV1({
	invoke: (channel: string, value?: unknown) => ipcRenderer.invoke(channel, value),
	on: (channel, listener) => ipcRenderer.on(channel, listener),
	removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
});

contextBridge.exposeInMainWorld(
	'framescaperWebVcr',
	Object.freeze({ v1: api }),
);
