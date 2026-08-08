/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopLibraryRecoveryResult } from './project-library-api.ts';
import { DesktopLibraryLeaseBusyError } from './project-library-api.ts';
import type {
	DesktopLibraryLease,
	DesktopLibraryOwner,
	DesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import type { DesktopLibraryManagedMediaReclamationResult } from './project-library-media-reclamation.ts';
import { DesktopLibraryManagedMediaReclaimer } from './project-library-media-reclamation.ts';
import type { DesktopLibraryProjectReclamationResult } from './project-library-reclamation.ts';
import { DesktopLibraryProjectReclaimer } from './project-library-reclamation.ts';
import type { SharedDesktopProjectLibrary } from './project-library.ts';

const EMPTY_PROJECT_RECLAMATION = Object.freeze({
	canonicalFiles: 0,
	complete: true,
	liveStageFiles: 0,
	protectedFiles: 0,
	reclaimedFiles: 0,
	reclaimedStageFiles: 0,
	scannedEntries: 0,
	stageFiles: 0,
}) satisfies DesktopLibraryProjectReclamationResult;

const EMPTY_MEDIA_RECLAMATION = Object.freeze({
	canonicalFiles: 0,
	catalogRowsRetired: 0,
	complete: true,
	liveStageFiles: 0,
	protectedFiles: 0,
	reclaimedFiles: 0,
	reclaimedStageFiles: 0,
	scannedEntries: 0,
	stageFiles: 0,
}) satisfies DesktopLibraryManagedMediaReclamationResult;

export interface DesktopProjectLibraryWriterEvidence {
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: DesktopLibraryRecoveryResult;
	readonly reclamation: DesktopLibraryProjectReclamationResult;
	readonly managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult;
}

export interface DesktopProjectLibraryActiveWriter {
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
}

export interface DesktopProjectLibraryWriterCoordinatorOptions {
	readonly leaseTtlMs: number;
	readonly library: SharedDesktopProjectLibrary;
	readonly owner: DesktopLibraryOwner;
	readonly paths: DesktopProjectLibraryPaths;
	readonly renewIntervalMs: number;
	readonly onLeaseLost?: (error: unknown) => void;
}

/** Serializes short-lived main-process writer sessions without fencing observers. */
export class DesktopProjectLibraryWriterCoordinator {
	#activeController: AbortController | null = null;
	#activeLease: DesktopLibraryLease | null = null;
	#backgroundTimer: ReturnType<typeof setTimeout> | null = null;
	#closed = false;
	#fenced = false;
	#lastWriter: DesktopProjectLibraryWriterEvidence | null = null;
	#leaseLossNotified = false;
	#leaseTtlMs: number;
	#library: SharedDesktopProjectLibrary;
	#onLeaseLost: (error: unknown) => void;
	#owner: DesktopLibraryOwner;
	#paths: DesktopProjectLibraryPaths;
	#renewIntervalMs: number;
	#startupMaintenanceComplete = false;
	#tail: Promise<void> = Promise.resolve();

	constructor(options: DesktopProjectLibraryWriterCoordinatorOptions) {
		this.#library = options.library;
		this.#owner = options.owner;
		this.#paths = options.paths;
		this.#leaseTtlMs = options.leaseTtlMs;
		this.#renewIntervalMs = options.renewIntervalMs;
		this.#onLeaseLost = options.onLeaseLost ?? (() => {});
	}

	get activeWriter(): DesktopProjectLibraryActiveWriter | null {
		const lease = this.#activeLease;
		return lease ? freezeActiveWriter(lease) : null;
	}

	get lastWriter(): DesktopProjectLibraryWriterEvidence | null {
		return this.#lastWriter;
	}

	get fenced(): boolean {
		return this.#fenced;
	}

	async initialize(signal?: AbortSignal): Promise<void> {
		try {
			await this.#enqueue(
				(coordinatorSignal) => this.#writerSession(async () => undefined, coordinatorSignal, 0, true),
				signal,
			);
		} catch (error) {
			if (!(error instanceof DesktopLibraryLeaseBusyError)) throw error;
			this.#scheduleRecovery(error.holder.expiresAtMs);
		}
	}

	run<Result>(
		operation: (lease: DesktopLibraryLease, signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal,
	): Promise<Result> {
		if (this.#backgroundTimer) clearTimeout(this.#backgroundTimer);
		this.#backgroundTimer = null;
		return this.#enqueue(
			(coordinatorSignal) => this.#writerSession(operation, coordinatorSignal, this.#leaseTtlMs, false),
			signal,
		);
	}

	requireActiveLease(): DesktopLibraryLease {
		if (!this.#activeLease) throw new Error('Desktop project library has no active writer lease');
		return this.#library.assertLease(this.#activeLease);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#backgroundTimer) clearTimeout(this.#backgroundTimer);
		this.#backgroundTimer = null;
		await this.#tail;
	}

	#enqueue<Result>(
		operation: (signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal,
	): Promise<Result> {
		if (this.#closed) return Promise.reject(new Error('Desktop project library writer coordinator is closed'));
		if (this.#fenced) return Promise.reject(new Error('Desktop project library writer coordinator lost its lease'));
		const queued = this.#tail.then(async () => {
			if (this.#closed) throw new Error('Desktop project library writer coordinator is closed');
			if (this.#fenced) throw new Error('Desktop project library writer coordinator lost its lease');
			if (signal?.aborted) throw signal.reason;
			return operation(signal ?? neverAbortedSignal());
		});
		this.#tail = queued.then(() => undefined, () => undefined);
		return queued;
	}

	async #writerSession<Result>(
		operation: (lease: DesktopLibraryLease, signal: AbortSignal) => Promise<Result>,
		callerSignal: AbortSignal,
		waitMs: number,
		startup: boolean,
	): Promise<Result> {
		const controller = new AbortController();
		const acquisitionSignal = AbortSignal.any([callerSignal, controller.signal]);
		let lease = await this.#library.acquireLease({
			owner: this.#owner,
			ttlMs: this.#leaseTtlMs,
			waitMs,
			signal: acquisitionSignal,
		});
		this.#activeController = controller;
		this.#activeLease = lease;
		const renewalState: { pending: Promise<void> | null } = { pending: null };
		const timer = setInterval(() => {
			if (renewalState.pending || controller.signal.aborted) return;
			renewalState.pending = this.#renew(controller).finally(() => { renewalState.pending = null; });
		}, this.#renewIntervalMs);
		timer.unref?.();
		let maintenanceCompleted = false;
		let primaryError: unknown;
		try {
			const fullMaintenance = startup || !this.#startupMaintenanceComplete || lease.tookOverStaleLease;
			const maintenance = fullMaintenance
				? await this.#maintain(lease, controller.signal, true)
				: await this.#recover(lease, controller.signal);
			if (fullMaintenance) this.#startupMaintenanceComplete = true;
			this.#lastWriter = freezeWriterEvidence(lease, maintenance);
			maintenanceCompleted = true;
			return await operation(lease, AbortSignal.any([callerSignal, controller.signal]));
		} catch (error) {
			primaryError = error;
			if (maintenanceCompleted && !controller.signal.aborted) {
				try {
					lease = this.#activeLease ?? lease;
					const maintenance = await this.#maintain(lease, controller.signal, false);
					this.#lastWriter = freezeWriterEvidence(lease, maintenance);
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], 'Desktop writer operation and recovery failed');
				}
			}
			throw error;
		} finally {
			clearInterval(timer);
			const pendingRenewal = renewalState.pending;
			if (pendingRenewal) await pendingRenewal.catch(() => undefined);
			const release = this.#activeLease ?? lease;
			this.#activeLease = null;
			this.#activeController = null;
			try {
				await this.#library.releaseLease(release);
			} catch (releaseError) {
				if (primaryError === undefined) throw releaseError;
			}
		}
	}

	async #maintain(
		lease: DesktopLibraryLease,
		signal: AbortSignal,
		preserveCurrentLeaseReservations: boolean,
	): Promise<Readonly<{
		recovery: DesktopLibraryRecoveryResult;
		reclamation: DesktopLibraryProjectReclamationResult;
		managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult;
	}>> {
		const recovery = await this.#library.recoverMetadata({ lease, signal });
		const reclamation = await new DesktopLibraryProjectReclaimer(this.#paths, {
			preserveCurrentLeaseReservations,
		}).reclaim({ lease, signal });
		const managedMediaReclamation = await new DesktopLibraryManagedMediaReclaimer(this.#paths, {
			catalog: {
				readMetadata: () => this.#library.readMetadata(),
				publishMetadata: (metadata, publicationSignal) => this.#library.publishMetadata({
					lease,
					metadata,
					signal: publicationSignal,
				}),
			},
			preserveCurrentLeaseReservations,
		}).reclaim({ lease, signal });
		return { recovery, reclamation, managedMediaReclamation };
	}

	async #recover(
		lease: DesktopLibraryLease,
		signal: AbortSignal,
	): Promise<Readonly<{
		recovery: DesktopLibraryRecoveryResult;
		reclamation: DesktopLibraryProjectReclamationResult;
		managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult;
	}>> {
		const recovery = await this.#library.recoverMetadata({ lease, signal });
		return {
			recovery,
			reclamation: EMPTY_PROJECT_RECLAMATION,
			managedMediaReclamation: EMPTY_MEDIA_RECLAMATION,
		};
	}

	async #renew(controller: AbortController): Promise<void> {
		const lease = this.#activeLease;
		if (!lease) return;
		try {
			this.#activeLease = await this.#library.renewLease(lease, this.#leaseTtlMs, controller.signal);
		} catch (error) {
			if (controller.signal.aborted || this.#closed) return;
			this.#fenced = true;
			controller.abort(error);
			if (this.#leaseLossNotified) return;
			this.#leaseLossNotified = true;
			try { this.#onLeaseLost(error); } catch { /* Lease loss remains authoritative. */ }
		}
	}

	#scheduleRecovery(expiresAtMs: number): void {
		if (this.#closed || this.#fenced || this.#backgroundTimer) return;
		const waitMs = Math.max(10, Math.min(this.#leaseTtlMs, expiresAtMs - Date.now() + 10));
		this.#backgroundTimer = setTimeout(() => {
			this.#backgroundTimer = null;
			void this.initialize().catch((error: unknown) => {
				if (error instanceof DesktopLibraryLeaseBusyError) this.#scheduleRecovery(error.holder.expiresAtMs);
				else this.#notifyBackgroundFailure(error);
			});
		}, waitMs);
		this.#backgroundTimer.unref?.();
	}

	#notifyBackgroundFailure(error: unknown): void {
		if (this.#closed || this.#leaseLossNotified) return;
		this.#fenced = true;
		this.#leaseLossNotified = true;
		try { this.#onLeaseLost(error); } catch { /* Background maintenance remains failed. */ }
	}
}

let idleSignal: AbortSignal | undefined;

function neverAbortedSignal(): AbortSignal {
	idleSignal ??= new AbortController().signal;
	return idleSignal;
}

function freezeActiveWriter(lease: DesktopLibraryLease): DesktopProjectLibraryActiveWriter {
	return Object.freeze({
		fencingToken: lease.fencingToken,
		tookOverStaleLease: lease.tookOverStaleLease,
	});
}

function freezeWriterEvidence(
	lease: DesktopLibraryLease,
	maintenance: Readonly<{
		recovery: DesktopLibraryRecoveryResult;
		reclamation: DesktopLibraryProjectReclamationResult;
		managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult;
	}>,
): DesktopProjectLibraryWriterEvidence {
	return Object.freeze({
		...freezeActiveWriter(lease),
		recovery: Object.freeze({ ...maintenance.recovery }),
		reclamation: Object.freeze({ ...maintenance.reclamation }),
		managedMediaReclamation: Object.freeze({ ...maintenance.managedMediaReclamation }),
	});
}
