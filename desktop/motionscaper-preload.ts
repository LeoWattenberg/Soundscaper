/* SPDX-License-Identifier: AGPL-3.0-only */
import { contextBridge, ipcRenderer } from 'electron';
import { MOTIONSCAPER_DESKTOP_CHANNELS as channels } from './motionscaper-desktop-contract.ts';

// Identity is the sole M01 native capability. Product-specific services are
// admitted through this bridge when their owning implementation package lands.
contextBridge.exposeInMainWorld('scapeDesktop', Object.freeze({
	v1: Object.freeze({ getEnvironment: (): Promise<unknown> => ipcRenderer.invoke(channels.environment) as Promise<unknown> }),
}));
