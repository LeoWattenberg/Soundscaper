/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryMainPreloadBridge,
} from './soundscaper-project-library-main-preload.ts';

declare const require: (specifier: 'electron') => Readonly<{
	contextBridge: Readonly<{ exposeInMainWorld(name: string, value: unknown): void }>;
	ipcRenderer: Readonly<{ invoke(channel: string, value?: unknown): Promise<unknown> }>;
}>;

const { contextBridge, ipcRenderer } = require('electron');
const api = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
	invoke: (channel: string, value?: unknown) => ipcRenderer.invoke(channel, value),
});

contextBridge.exposeInMainWorld(
	'soundscaperProjectLibraryDesktop',
	Object.freeze({ v1: api }),
);
