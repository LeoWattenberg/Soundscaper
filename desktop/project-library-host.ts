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
	type DesktopLibraryLoadedProjectBundle,
	DesktopLibraryProjectStore,
} from './project-library-projects.ts';
import {
	type DesktopLibraryManagedMediaReadOptions,
	type DesktopLibraryPublishAudioOptions,
	type DesktopLibraryPublishMediaOptions,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DesktopLibraryManagedMediaStore,
} from './project-library-media.ts';
import {
	DesktopLibraryManagedMediaInventoryStore,
} from './project-library-media-inventory-store.ts';
import {
	SharedDesktopProjectLibrary,
} from './project-library.ts';
import type { DesktopLibraryRecoveryResult } from './project-library-api.ts';
import {
	type DesktopLibraryProjectReclamationResult,
	DesktopLibraryProjectReclaimer,
} from './project-library-reclamation.ts';
import {
	type DesktopLibraryManagedMediaReclamationResult,
	DesktopLibraryManagedMediaReclaimer,
} from './project-library-media-reclamation.ts';

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
	readonly reclamation: DesktopLibraryProjectReclamationResult;
	readonly managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult;
}

export type DesktopProjectLibraryHostCommitOptions = Omit<DesktopLibraryCommitProjectOptions, 'lease'>;
export type DesktopProjectLibraryHostCommitByIdOptions = Omit<DesktopLibraryCommitProjectByIdOptions, 'lease'>;
export type DesktopProjectLibraryHostDeleteByIdOptions = Omit<DesktopLibraryDeleteProjectByIdOptions, 'lease'>;
export interface DesktopProjectLibraryHostPublishAudioOptions
	extends Omit<DesktopLibraryPublishAudioOptions, 'projectRevision' | 'projectSha256'> {
	readonly expectedProjectRevision: number;
	readonly expectedProjectSha256: string;
}
export interface DesktopProjectLibraryHostPublishMediaOptions
	extends Omit<DesktopLibraryPublishMediaOptions, 'projectRevision' | 'projectSha256'> {
	readonly expectedProjectRevision: number;
	readonly expectedProjectSha256: string;
}

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
	#media: DesktopLibraryManagedMediaStore;
	#mediaInventory: DesktopLibraryManagedMediaInventoryStore;
	#managedMediaReclamation: DesktopLibraryManagedMediaReclamationResult | null = null;
	#projects: DesktopLibraryProjectStore;
	#reclamation: DesktopLibraryProjectReclamationResult | null = null;
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
		this.#lease = lease;
		this.#projects = new DesktopLibraryProjectStore(library);
		this.#mediaInventory = new DesktopLibraryManagedMediaInventoryStore(library.paths);
		this.#media = new DesktopLibraryManagedMediaStore({
			managedMediaRoot: library.paths.managedMediaRoot,
			catalog: {
				readMetadata: () => library.readMetadata(),
				publishMetadata: (metadata, signal) => library.publishMetadata({
					lease: this.#lease,
					metadata,
					signal,
				}),
			},
			inventory: {
				reserve: (reservation) => this.#mediaInventory.reserve({ ...reservation, lease: this.#lease }),
				materialize: (stage) => this.#mediaInventory.materialize({ ...stage, lease: this.#lease }),
				discard: (stage) => this.#mediaInventory.discard({ ...stage, lease: this.#lease }),
			},
		});
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
		let host: DesktopProjectLibraryHost | null = null;
		try {
			lease = await library.acquireLease({
				owner: options.owner,
				ttlMs: options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
				signal: options.signal,
			});
			const recovery = await library.recoverMetadata({ lease, signal: options.signal });
			const activeHost = new DesktopProjectLibraryHost(library, lease, recovery, options);
			host = activeHost;
			activeHost.#reclamation = await new DesktopLibraryProjectReclaimer(paths).reclaim({
				lease,
				signal: options.signal,
			});
			activeHost.#managedMediaReclamation = await new DesktopLibraryManagedMediaReclaimer(paths, {
				catalog: {
					readMetadata: () => library.readMetadata(),
					publishMetadata: (metadata, signal) => library.publishMetadata({
						lease: activeHost.#lease,
						metadata,
						signal,
					}),
				},
			}).reclaim({ lease, signal: options.signal });
			return activeHost;
		} catch (error) {
			if (host) {
				try {
					await host.close();
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], 'Desktop project library startup cleanup failed');
				}
			} else {
				if (lease) await library.releaseLease(lease).catch(() => false);
				library.close();
			}
			throw error;
		}
	}

	snapshot(): DesktopProjectLibraryHostSnapshot {
		if (!this.#reclamation || !this.#managedMediaReclamation) {
			throw new Error('Desktop project library host startup is incomplete');
		}
		return Object.freeze({
			closed: this.#closed,
			owner: Object.freeze({ ...this.#lease.owner }),
			fencingToken: this.#lease.fencingToken,
			tookOverStaleLease: this.#lease.tookOverStaleLease,
			recovery: Object.freeze({ ...this.#recovery }),
			reclamation: Object.freeze({ ...this.#reclamation }),
			managedMediaReclamation: Object.freeze({ ...this.#managedMediaReclamation }),
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

	readProjectBundleById(projectId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProjectBundle | null> {
		return this.#admit(() => this.#projects.readProjectBundleById(projectId, signal));
	}

	readManagedMedia(
		bindingId: string,
		options: DesktopLibraryManagedMediaReadOptions,
	): Promise<Uint8Array> {
		return this.#admit(() => this.#media.read(bindingId, options));
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

	publishManagedAudio(options: DesktopProjectLibraryHostPublishAudioOptions) {
		return this.publishManagedMedia({ ...options, encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING });
	}

	publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions) {
		return this.#mutateProject(async () => {
			this.#library.assertLease(this.#lease);
			const loaded = await this.#projects.readProjectById(options.projectId, options.signal);
			if (!loaded) throw new Error('Desktop shared project is unavailable for managed-media publication');
			if (loaded.catalog.projectRevision !== options.expectedProjectRevision
				|| loaded.catalog.sha256 !== options.expectedProjectSha256) {
				throw new Error('Desktop shared project changed during managed-media preparation');
			}
			const {
				expectedProjectRevision: _expectedProjectRevision,
				expectedProjectSha256: _expectedProjectSha256,
				...publication
			} = options;
			return this.#media.publish({
				...publication,
				projectRevision: options.expectedProjectRevision,
				projectSha256: options.expectedProjectSha256,
			});
		});
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
		}
		try { this.#mediaInventory.close(); } catch (error) { failures.push(error); }
		try { this.#library.close(); } catch (error) { failures.push(error); }
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
