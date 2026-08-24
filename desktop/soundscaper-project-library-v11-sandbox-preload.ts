/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV11MainPreloadBridge,
} from './soundscaper-project-library-v11-main-preload.ts';

declare const require: (specifier: 'electron') => Readonly<{
	contextBridge: Readonly<{ exposeInMainWorld(name: string, value: unknown): void }>;
	ipcRenderer: Readonly<{ invoke(channel: string, value?: unknown): Promise<unknown> }>;
}>;

const { contextBridge, ipcRenderer } = require('electron');
const api = createSoundscaperDesktopProjectLibraryV11MainPreloadBridge({
	invoke: (channel: string, value?: unknown) => ipcRenderer.invoke(channel, value),
});

contextBridge.exposeInMainWorld(
	'soundscaperProjectLibraryDesktop',
	Object.freeze({ v11: api }),
);
