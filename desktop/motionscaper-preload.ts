/* SPDX-License-Identifier: AGPL-3.0-only */
import { contextBridge, ipcRenderer } from 'electron';
import { MOTIONSCAPER_DESKTOP_CHANNELS as channels } from './motionscaper-desktop-contract.ts';
import type { MotionDesktopDocumentation } from '../src/motionscaper/desktop-documentation-contract.ts';
import type { MotionDesktopUpdates } from '../src/motionscaper/desktop-updates-contract.ts';
import type { MotionDesktopLaunch } from '../src/motionscaper/desktop-launch-contract.ts';

import type { MotionDesktopFiles, MotionDesktopFileMethod } from '../src/motionscaper/desktop-file-contract.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES } from '../src/motionscaper/desktop-file-contract.ts';
import { MOTION_DELIVERY_CHUNK_BYTES, type MotionDesktopDelivery, type MotionDeliveryMethod } from '../src/motionscaper/desktop-delivery-contract.ts';
const deliver = <T>(method: MotionDeliveryMethod, payload: unknown): Promise<T> => ipcRenderer.invoke(channels.delivery, method, payload) as Promise<T>;
const motionDelivery: MotionDesktopDelivery = {
	getProfile: () => deliver('getProfile', {}), begin: (request) => deliver('begin', request),
	commit: (request) => deliver('commit', request), cancel: (request) => deliver('cancel', request),
	write: (request) => {
		if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > MOTION_DELIVERY_CHUNK_BYTES) return Promise.reject(new RangeError('Motionscaper delivery chunk exceeds the bridge limit.'));
		return deliver('write', request);
	},
};
const invoke = <T>(method: MotionDesktopFileMethod, payload: unknown): Promise<T> => ipcRenderer.invoke(channels.projectFiles, method, payload) as Promise<T>;
const documentation: MotionDesktopDocumentation = { open: (request) => ipcRenderer.invoke(channels.documentation, request) as Promise<void> };
const motionUpdates: MotionDesktopUpdates = { check: () => ipcRenderer.invoke(channels.checkForUpdates, {}) as Promise<void> };
const motionLaunch: MotionDesktopLaunch = {
	take: () => ipcRenderer.invoke(channels.projectLaunch, 'take', {}) as ReturnType<MotionDesktopLaunch['take']>,
	acknowledge: request => ipcRenderer.invoke(channels.projectLaunch, 'acknowledge', request) as Promise<void>,
	onPending: listener => {
		if (typeof listener !== 'function') throw new TypeError('Motionscaper launch listener must be a function.');
		const notify = () => { listener(); };
		ipcRenderer.on(channels.projectLaunchPending, notify);
		return () => { ipcRenderer.removeListener(channels.projectLaunchPending, notify); };
	},
};
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
	v1: Object.freeze({ motionLaunch: Object.freeze(motionLaunch), motionUpdates: Object.freeze(motionUpdates), documentation: Object.freeze(documentation), motionDelivery: Object.freeze(motionDelivery), motionFiles: Object.freeze(motionFiles), getEnvironment: (): Promise<unknown> => ipcRenderer.invoke(channels.environment) as Promise<unknown> }),
}));
