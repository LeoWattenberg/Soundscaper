/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createDesktopProjectLibraryPaths,
	type DesktopLibraryLease,
	type DesktopLibraryOwner,
} from './project-library-contract.ts';
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
	readonly recovery: DesktopLibraryRecoveryResult;
}

/** Owns the shared library only inside the Electron main process. */
export class DesktopProjectLibraryHost {
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#lease: DesktopLibraryLease;
	#leaseTtlMs: number;
	#library: SharedDesktopProjectLibrary;
	#onLeaseLost: (error: unknown) => void;
	#recovery: DesktopLibraryRecoveryResult;
	#renewalActive = false;
	#renewalTimer: ReturnType<typeof setInterval>;

	private constructor(
		library: SharedDesktopProjectLibrary,
		lease: DesktopLibraryLease,
		recovery: DesktopLibraryRecoveryResult,
		options: DesktopProjectLibraryHostOptions,
	) {
		this.#library = library;
		this.#lease = lease;
		this.#recovery = recovery;
		this.#leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
		this.#onLeaseLost = options.onLeaseLost ?? (() => {});
		const renewIntervalMs = validateRenewInterval(
			options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS,
			this.#leaseTtlMs,
		);
		this.#renewalTimer = setInterval(() => { void this.#renewLease(); }, renewIntervalMs);
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
			recovery: Object.freeze({ ...this.#recovery }),
		});
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closed = true;
		clearInterval(this.#renewalTimer);
		this.#closePromise = this.#close();
		return this.#closePromise;
	}

	async #close(): Promise<void> {
		try {
			await this.#library.releaseLease(this.#lease);
		} finally {
			this.#library.close();
		}
	}

	async #renewLease(): Promise<void> {
		if (this.#closed || this.#renewalActive) return;
		this.#renewalActive = true;
		try {
			const renewed = await this.#library.renewLease(this.#lease, this.#leaseTtlMs);
			if (!this.#closed) this.#lease = renewed;
		} catch (error) {
			clearInterval(this.#renewalTimer);
			if (this.#closed) return;
			try {
				this.#onLeaseLost(error);
			} catch {
				// A host callback cannot restore a lost fencing token.
			}
		} finally {
			this.#renewalActive = false;
		}
	}
}

function validateRenewInterval(value: number, leaseTtlMs: number): number {
	if (!Number.isSafeInteger(value) || value < 100 || value >= leaseTtlMs) {
		throw new RangeError('Desktop project library renewal interval must be shorter than its lease TTL');
	}
	return value;
}
