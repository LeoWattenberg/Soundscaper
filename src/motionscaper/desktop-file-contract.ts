/* SPDX-License-Identifier: AGPL-3.0-only */
export const MOTIONSCAPER_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export interface MotionOpenFileCapability { readonly token: string; readonly name: string; readonly byteLength: number }
export interface MotionSaveFileReceipt { readonly name: string; readonly byteLength: number; readonly sha256: string }
export interface MotionDesktopFiles {
	selectOpen(): Promise<MotionOpenFileCapability | null>;
	read(request: { readonly token: string; readonly offset: number; readonly length: number }): Promise<Uint8Array>;
	release(request: { readonly token: string }): Promise<void>;
	bindOpened(request: { readonly token: string; readonly projectId: string }): Promise<void>;
	beginSave(request: { readonly projectId: string; readonly suggestedName: string; readonly saveAs: boolean; readonly saveCopy?: boolean }): Promise<{ readonly token: string } | null>;
	write(request: { readonly token: string; readonly offset: number; readonly bytes: Uint8Array }): Promise<void>;
	commit(request: { readonly token: string; readonly byteLength: number }): Promise<MotionSaveFileReceipt>;
	cancel(request: { readonly token: string }): Promise<void>;
}
export type MotionDesktopFileMethod = keyof MotionDesktopFiles;
export const MOTIONSCAPER_FILE_METHODS = Object.freeze(['selectOpen', 'read', 'release', 'bindOpened', 'beginSave', 'write', 'commit', 'cancel'] as const);
