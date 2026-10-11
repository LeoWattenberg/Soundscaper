/* SPDX-License-Identifier: AGPL-3.0-only */
export const MOTION_SAVED_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MOTION_SAVED_FILE_MAXIMUM_BYTES = 64 * 1024 ** 3;
export interface MotionSavedFileWatch { readonly watchId: string; readonly name: string }
export interface MotionSavedFileSnapshot { readonly token: string; readonly name: string; readonly byteLength: number; readonly generation: number }
export type MotionSavedFileDiscovery =
	| Readonly<{ state: 'unchanged'; generation: number }>
	| Readonly<{ state: 'unavailable'; generation: number }>
	| Readonly<{ state: 'snapshot'; snapshot: MotionSavedFileSnapshot }>;
/** Platform-local permission; paths and watcher state never enter portable project intent. */
export interface MotionSavedFileCapabilities {
	select(): Promise<MotionSavedFileWatch | null>;
	poll(request: Readonly<{ watchId: string; afterGeneration: number }>): Promise<MotionSavedFileDiscovery>;
	read(request: Readonly<{ token: string; offset: number; length: number }>): Promise<Uint8Array>;
	release(request: Readonly<{ token: string }>): Promise<void>;
	cancel(request: Readonly<{ watchId: string }>): Promise<void>;
}
