/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_SUCCESSOR_DELIVERY_CHANNEL, type FramescaperSuccessorNativeDelivery } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
import { contextBridge, ipcRenderer } from 'electron';
import { FRAMESCAPER_SUCCESSOR_DESKTOP } from './framescaper-successor-contract.ts';
import { createMotionSavedFilePreload } from './motion-saved-file-preload.ts';
const invoke = <T>(method: string, value: unknown): Promise<T> => ipcRenderer.invoke(FRAMESCAPER_SUCCESSOR_DELIVERY_CHANNEL, method, value) as Promise<T>;
const delivery = Object.freeze<FramescaperSuccessorNativeDelivery>({
	getProfile: () => invoke('getProfile', {}), begin: request => invoke('begin', request), write: request => invoke('write', request), commit: request => invoke('commit', request), cancel: request => invoke('cancel', request),
});
const motionSavedFiles = createMotionSavedFilePreload({ invoke: (channel, value) => ipcRenderer.invoke(channel, value) as Promise<unknown> });
contextBridge.exposeInMainWorld('scapeDesktop', Object.freeze({ v1: Object.freeze({
	getEnvironment: (): Promise<unknown> => ipcRenderer.invoke(FRAMESCAPER_SUCCESSOR_DESKTOP.environmentChannel) as Promise<unknown>,
}) }));
contextBridge.exposeInMainWorld('framescaperSuccessorDesktop', Object.freeze({ v1: Object.freeze({ motionSavedFiles, delivery }) }));
