/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopLibraryLease,
	DesktopLibraryMetadata,
	DesktopLibraryOwner,
} from './project-library-contract.ts';

export type DesktopLibraryCheckpoint = 'prepared' | 'committed';

export interface DesktopLibraryOpenOptions {
	readonly now?: () => number;
	readonly randomId?: () => string;
	readonly checkpoint?: (phase: DesktopLibraryCheckpoint) => void | Promise<void>;
}

export interface DesktopLibraryAcquireLeaseOptions {
	readonly owner: DesktopLibraryOwner;
	readonly ttlMs: number;
	readonly waitMs?: number;
	readonly pollIntervalMs?: number;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryPublishMetadataOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadata: DesktopLibraryMetadata;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryRecoverMetadataOptions {
	readonly lease: DesktopLibraryLease;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryReserveProjectFileOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadataFile: string;
	readonly stageFile?: string;
}

export interface DesktopLibraryMaterializeProjectFileOptions {
	readonly lease: DesktopLibraryLease;
	readonly metadataFile: string;
	readonly stageFile: string | null;
}

export interface DesktopLibraryDiscardProjectStageFileOptions
	extends Omit<DesktopLibraryMaterializeProjectFileOptions, 'stageFile'> {
	readonly removeFile: boolean;
	readonly stageFile: string;
}

export interface DesktopLibraryRecoveryResult {
	readonly outcome: 'clean' | 'committed' | 'interrupted';
	readonly previousRevision: number | null;
	readonly publishedRevision: number | null;
	readonly restoredPrevious: boolean;
}

export class DesktopLibraryLeaseBusyError extends Error {
	readonly holder: DesktopLibraryLease;

	constructor(holder: DesktopLibraryLease) {
		super(`Desktop project library is leased by ${holder.owner.product} process ${holder.owner.processId}`);
		this.name = 'DesktopLibraryLeaseBusyError';
		this.holder = holder;
	}
}

export function freezeDesktopLibraryRecovery(
	value: DesktopLibraryRecoveryResult,
): DesktopLibraryRecoveryResult {
	return Object.freeze({ ...value });
}
