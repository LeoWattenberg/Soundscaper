/* SPDX-License-Identifier: AGPL-3.0-only */
import { contextBridge, ipcRenderer } from 'electron';
import { MOTIONSCAPER_DESKTOP_CHANNELS as channels } from './motionscaper-desktop-contract.ts';

import type { MotionDesktopFiles, MotionDesktopFileMethod } from '../src/motionscaper/desktop-file-contract.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES } from '../src/motionscaper/desktop-file-contract.ts';
const invoke = <T>(method: MotionDesktopFileMethod, payload: unknown): Promise<T> => ipcRenderer.invoke(channels.projectFiles, method, payload) as Promise<T>;
const motionFiles: MotionDesktopFiles = {
	selectOpen: () => invoke('selectOpen', {}), read: (request) => invoke('read', request),
	release: (request) => invoke('release', request), bindOpened: (request) => invoke('bindOpened', request),
	beginSave: (request) => invoke('beginSave', request), commit: (request) => invoke('commit', request), cancel: (request) => invoke('cancel', request),
	write: (request) => {
		if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > MOTIONSCAPER_FILE_CHUNK_BYTES) return Promise.reject(new RangeError('Motionscaper file chunk exceeds the bridge limit.'));
		return invoke('write', request);
	},
};
contextBridge.exposeInMainWorld('scapeDesktop', Object.freeze({
	v1: Object.freeze({ motionFiles: Object.freeze(motionFiles), getEnvironment: (): Promise<unknown> => ipcRenderer.invoke(channels.environment) as Promise<unknown> }),
}));
