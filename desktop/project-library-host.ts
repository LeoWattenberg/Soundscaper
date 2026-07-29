/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DesktopLibraryMetadata,
	createDesktopProjectLibraryPaths,
	type DesktopLibraryLease,
	type DesktopLibraryOwner,
} from './project-library-contract.ts';
import {
	type DesktopLibraryCommitProjectByIdOptions,
	type DesktopLibraryCommitProjectOptions,
	type DesktopLibraryDeleteProjectByIdOptions,
	type DesktopLibraryLoadedProject,
	DesktopLibraryProjectStore,
} from './project-library-projects.ts';
import {
	type DesktopLibraryRecoveryResult,
	SharedDesktopProjectLibrary,
} from './project-library.ts';

const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_RENEW_INTERVAL_MS = 10_000;

export interface DesktopProjectLibraryHostOptions {
	readonly appDataPath: string;
	readonly owner: DesktopLibraryOwner;
	readonly leaseTtlMs?: number;
	readonly renewIntervalMs?: number;
	readonly signal?: AbortSignal;
	readonly onLeaseLost?: (error: unknown) => void;
}

export interface DesktopProjectLibraryHostSnapshot {
	readonly closed: boolean;
	readonly owner: DesktopLibraryOwner;
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: DesktopLibraryRecoveryResult;
}

export type DesktopProjectLibraryHostCommitOptions = Omit<DesktopLibraryCommitProjectOptions, 'lease'>;
export type DesktopProjectLibraryHostCommitByIdOptions = Omit<DesktopLibraryCommitProjectByIdOptions, 'lease'>;
export type DesktopProjectLibraryHostDeleteByIdOptions = Omit<DesktopLibraryDeleteProjectByIdOptions, 'lease'>;

/** Owns the shared library only inside the Electron main process. */
export class DesktopProjectLibraryHost {
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#lease: DesktopLibraryLease;
	#leaseTtlMs: number;
	#library: SharedDesktopProjectLibrary;
	#onLeaseLost: (error: unknown) => void;
	#operations = new Set<Promise<unknown>>();
	#projectMutationTail: Promise<void> = Promise.resolve();
	#projects: DesktopLibraryProjectStore;
	#recovery: DesktopLibraryRecoveryResult;
	#renewalPromise: Promise<void> | null = null;
	#renewalsStopped = false;
	#renewalTimer: ReturnType<typeof setInterval>;

	private constructor(
		library: SharedDesktopProjectLibrary,
		lease: DesktopLibraryLease,
		recovery: DesktopLibraryRecoveryResult,
		options: DesktopProjectLibraryHostOptions,
	) {
		this.#library = library;
		this.#projects = new DesktopLibraryProjectStore(library);
		this.#lease = lease;
		this.#recovery = recovery;
		this.#leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
		this.#onLeaseLost = options.onLeaseLost ?? (() => {});
		const renewIntervalMs = validateRenewInterval(
			options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS,
			this.#leaseTtlMs,
		);
		this.#renewalTimer = setInterval(() => { this.#beginRenewal(); }, renewIntervalMs);
		this.#renewalTimer.unref?.();
	}

	static async start(options: DesktopProjectLibraryHostOptions): Promise<DesktopProjectLibraryHost> {
		const paths = createDesktopProjectLibraryPaths(options.appDataPath);
		const library = await SharedDesktopProjectLibrary.open(paths);
		let lease: DesktopLibraryLease | null = null;
		try {
			lease = await library.acquireLease({
				owner: options.owner,
				ttlMs: options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
				signal: options.signal,
			});
			const recovery = await library.recoverMetadata({ lease, signal: options.signal });
			return new DesktopProjectLibraryHost(library, lease, recovery, options);
		} catch (error) {
			if (lease) await library.releaseLease(lease).catch(() => false);
			library.close();
			throw error;
		}
	}

	snapshot(): DesktopProjectLibraryHostSnapshot {
		return Object.freeze({
			closed: this.#closed,
			owner: Object.freeze({ ...this.#lease.owner }),
			fencingToken: this.#lease.fencingToken,
			tookOverStaleLease: this.#lease.tookOverStaleLease,
			recovery: Object.freeze({ ...this.#recovery }),
		});
	}

	readCatalog(): DesktopLibraryMetadata {
		this.#assertAccepting();
		return this.#projects.readCatalog();
	}

	readProject(entryId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		return this.#admit(() => this.#projects.readProject(entryId, signal));
	}

	readProjectById(projectId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		return this.#admit(() => this.#projects.readProjectById(projectId, signal));
	}

	commitProject(options: DesktopProjectLibraryHostCommitOptions): Promise<DesktopLibraryLoadedProject> {
		return this.#mutateProject(() => this.#projects.commitProject({ ...options, lease: this.#lease }));
	}

	commitProjectById(options: DesktopProjectLibraryHostCommitByIdOptions): Promise<DesktopLibraryLoadedProject> {
		return this.#mutateProject(() => this.#projects.commitProjectById({ ...options, lease: this.#lease }));
	}

	deleteProjectById(options: DesktopProjectLibraryHostDeleteByIdOptions): Promise<boolean> {
		return this.#mutateProject(() => this.#projects.deleteProjectById({ ...options, lease: this.#lease }));
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closed = true;
		this.#closePromise = this.#close([...this.#operations]);
		return this.#closePromise;
	}

	async #close(operations: readonly Promise<unknown>[]): Promise<void> {
		const failures: unknown[] = [];
		const results = await Promise.allSettled(operations);
		for (const result of results) {
			if (result.status === 'rejected') failures.push(result.reason);
		}
		this.#renewalsStopped = true;
		clearInterval(this.#renewalTimer);
		if (this.#renewalPromise) await this.#renewalPromise;
		try {
			if (!await this.#library.releaseLease(this.#lease)) {
				failures.push(new Error('Desktop project library host no longer owns its lease during close'));
			}
		} catch (error) {
			failures.push(error);
		} finally {
			try {
				this.#library.close();
			} catch (error) {
				failures.push(error);
			}
		}
		throwHostFailures(failures);
	}

	#beginRenewal(): void {
		if (this.#renewalsStopped || this.#renewalPromise) return;
		const renewal = this.#renewLease();
		this.#renewalPromise = renewal;
		void renewal.then(
			() => { if (this.#renewalPromise === renewal) this.#renewalPromise = null; },
			() => { if (this.#renewalPromise === renewal) this.#renewalPromise = null; },
		);
	}

	async #renewLease(): Promise<void> {
		try {
			const renewed = await this.#library.renewLease(this.#lease, this.#leaseTtlMs);
			this.#lease = renewed;
		} catch (error) {
			this.#renewalsStopped = true;
			clearInterval(this.#renewalTimer);
			if (this.#closed) return;
			try {
				this.#onLeaseLost(error);
			} catch {
				// A host callback cannot restore a lost fencing token.
			}
		}
	}

	#mutateProject<Result>(operation: () => Promise<Result>): Promise<Result> {
		return this.#admit(() => {
			const mutation = this.#projectMutationTail.then(operation);
			this.#projectMutationTail = mutation.then(() => undefined, () => undefined);
			return mutation;
		});
	}

	#admit<Result>(operation: () => Promise<Result>): Promise<Result> {
		try {
			this.#assertAccepting();
		} catch (error) {
			return Promise.reject(error);
		}
		let admitted: Promise<Result>;
		try {
			admitted = operation();
		} catch (error) {
			return Promise.reject(error);
		}
		this.#operations.add(admitted);
		void admitted.then(
			() => { this.#operations.delete(admitted); },
			() => { this.#operations.delete(admitted); },
		);
		return admitted;
	}

	#assertAccepting(): void {
		if (this.#closed) throw new Error('Desktop project library host is closed');
	}
}

function validateRenewInterval(value: number, leaseTtlMs: number): number {
	if (!Number.isSafeInteger(value) || value < 100 || value >= leaseTtlMs) {
		throw new RangeError('Desktop project library renewal interval must be shorter than its lease TTL');
	}
	return value;
}

function throwHostFailures(failures: readonly unknown[]): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, 'Desktop project library host shutdown failed');
}
