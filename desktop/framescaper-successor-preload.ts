/* SPDX-License-Identifier: AGPL-3.0-only */
import { contextBridge, ipcRenderer } from 'electron';
import { FRAMESCAPER_SUCCESSOR_DESKTOP } from './framescaper-successor-contract.ts';
import { createMotionSavedFilePreload } from './motion-saved-file-preload.ts';
const motionSavedFiles = createMotionSavedFilePreload({ invoke: (channel, value) => ipcRenderer.invoke(channel, value) as Promise<unknown> });
contextBridge.exposeInMainWorld('scapeDesktop', Object.freeze({ v1: Object.freeze({
	getEnvironment: (): Promise<unknown> => ipcRenderer.invoke(FRAMESCAPER_SUCCESSOR_DESKTOP.environmentChannel) as Promise<unknown>,
}) }));
contextBridge.exposeInMainWorld('framescaperSuccessorDesktop', Object.freeze({ v1: Object.freeze({ motionSavedFiles }) }));
