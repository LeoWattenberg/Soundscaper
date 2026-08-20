/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperCaptureDesktopPreloadBridgeV1,
} from './framescaper-capture-preload.ts';

declare const require: (specifier: 'electron') => Readonly<{
	contextBridge: Readonly<{ exposeInMainWorld(name: string, value: unknown): void }>;
	ipcRenderer: Readonly<{ invoke(channel: string, value?: unknown): Promise<unknown> }>;
}>;

const { contextBridge, ipcRenderer } = require('electron');
const api = createFramescaperCaptureDesktopPreloadBridgeV1({
	invoke: (channel: string, value?: unknown) => ipcRenderer.invoke(channel, value),
});

contextBridge.exposeInMainWorld(
	'framescaperCaptureDesktop',
	Object.freeze({ v1: api }),
);
