/* SPDX-License-Identifier: AGPL-3.0-only */

export type TrackFreezeStatus = 'none' | 'fresh' | 'stale' | 'verifying' | 'unknown';
export type TrackFreezeOperation = 'freeze' | 'refresh' | 'unfreeze' | 'commit';

/** Product-neutral seam for the per-track freeze submenu. */
export interface TrackFreezeRuntime {
	readonly freezeStatus: TrackFreezeStatus;
	readonly freezeActionsAvailable: boolean;
	freeze(operation: TrackFreezeOperation, trackId: string): unknown;
}
