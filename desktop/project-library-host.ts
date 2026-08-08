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
import { DesktopLibraryManagedMediaInventoryStore } from './project-library-media-inventory-store.ts';
import { SharedDesktopProjectLibrary } from './project-library.ts';
import type { DesktopLibraryCheckpoint } from './project-library-api.ts';
import {
	type DesktopProjectLibraryActiveWriter,
	type DesktopProjectLibraryWriterEvidence,
	DesktopProjectLibraryWriterCoordinator,
} from './project-library-writer-coordinator.ts';

const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_RENEW_INTERVAL_MS = 10_000;

export interface DesktopProjectLibraryHostOptions {
	readonly appDataPath: string;
	readonly checkpoint?: (phase: DesktopLibraryCheckpoint) => void | Promise<void>;
	readonly owner: DesktopLibraryOwner;
	readonly leaseTtlMs?: number;
	readonly renewIntervalMs?: number;
	readonly signal?: AbortSignal;
	readonly onLeaseLost?: (error: unknown) => void;
}

export interface DesktopProjectLibraryHostSnapshot {
	readonly closed: boolean;
	readonly owner: DesktopLibraryOwner;
	readonly activeWriter: DesktopProjectLibraryActiveWriter | null;
	readonly lastWriter: DesktopProjectLibraryWriterEvidence | null;
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

/** Main-process observer with short-lived, mutation-scoped writer ownership. */
export class DesktopProjectLibraryHost {
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#coordinator: DesktopProjectLibraryWriterCoordinator;
	#leaseLossController = new AbortController();
	#library: SharedDesktopProjectLibrary;
	#media: DesktopLibraryManagedMediaStore;
	#mediaInventory: DesktopLibraryManagedMediaInventoryStore;
	#operations = new Set<Promise<unknown>>();
	#owner: DesktopLibraryOwner;
	#projects: DesktopLibraryProjectStore;

	private constructor(
		library: SharedDesktopProjectLibrary,
		options: DesktopProjectLibraryHostOptions,
	) {
		this.#library = library;
		this.#owner = Object.freeze({ ...options.owner });
		this.#projects = new DesktopLibraryProjectStore(library);
		this.#mediaInventory = new DesktopLibraryManagedMediaInventoryStore(library.paths);
		const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
		const renewIntervalMs = validateRenewInterval(
			options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS,
			leaseTtlMs,
		);
		this.#coordinator = new DesktopProjectLibraryWriterCoordinator({
			leaseTtlMs,
			library,
			onLeaseLost: (error) => {
				this.#leaseLossController.abort(error);
				options.onLeaseLost?.(error);
			},
			owner: options.owner,
			paths: library.paths,
			renewIntervalMs,
		});
		this.#media = new DesktopLibraryManagedMediaStore({
			managedMediaRoot: library.paths.managedMediaRoot,
			catalog: {
				readMetadata: () => library.readMetadata(),
				publishMetadata: (metadata, signal) => library.publishMetadata({
					lease: this.#coordinator.requireActiveLease(),
					metadata,
					signal,
				}),
			},
			inventory: {
				reserve: (reservation) => this.#mediaInventory.reserve({
					...reservation,
					lease: this.#coordinator.requireActiveLease(),
				}),
				materialize: (stage) => this.#mediaInventory.materialize({
					...stage,
					lease: this.#coordinator.requireActiveLease(),
				}),
				discard: (stage) => this.#mediaInventory.discard({
					...stage,
					lease: this.#coordinator.requireActiveLease(),
				}),
			},
		});
	}

	static async start(options: DesktopProjectLibraryHostOptions): Promise<DesktopProjectLibraryHost> {
		const library = await SharedDesktopProjectLibrary.open(
			createDesktopProjectLibraryPaths(options.appDataPath),
			{ checkpoint: options.checkpoint },
		);
		let host: DesktopProjectLibraryHost | null = null;
		try {
			host = new DesktopProjectLibraryHost(library, options);
			await host.#coordinator.initialize(options.signal);
			return host;
		} catch (error) {
			if (host) await host.close().catch(() => undefined);
			else library.close();
			throw error;
		}
	}

	snapshot(): DesktopProjectLibraryHostSnapshot {
		return Object.freeze({
			closed: this.#closed,
			owner: this.#owner,
			activeWriter: this.#coordinator.activeWriter,
			lastWriter: this.#coordinator.lastWriter,
		});
	}

	readCatalog(): DesktopLibraryMetadata {
		this.#assertAccepting();
		return this.#projects.readCatalog();
	}

	readProject(entryId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		return this.#admit((operationSignal) => this.#projects.readProject(entryId, operationSignal), signal);
	}

	readProjectById(projectId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProject | null> {
		return this.#admit((operationSignal) => this.#projects.readProjectById(projectId, operationSignal), signal);
	}

	readProjectBundleById(projectId: string, signal?: AbortSignal): Promise<DesktopLibraryLoadedProjectBundle | null> {
		return this.#admit((operationSignal) => this.#projects.readProjectBundleById(projectId, operationSignal), signal);
	}

	readManagedMedia(
		bindingId: string,
		options: DesktopLibraryManagedMediaReadOptions,
	): Promise<Uint8Array> {
		return this.#admit(
			(operationSignal) => this.#media.read(bindingId, { ...options, signal: operationSignal }),
			options.signal,
		);
	}

	commitProject(options: DesktopProjectLibraryHostCommitOptions): Promise<DesktopLibraryLoadedProject> {
		return this.#mutate(
			(lease, signal) => this.#projects.commitProject({ ...options, lease, signal }),
			options.signal,
		);
	}

	commitProjectById(options: DesktopProjectLibraryHostCommitByIdOptions): Promise<DesktopLibraryLoadedProject> {
		return this.#mutate(
			(lease, signal) => this.#projects.commitProjectById({ ...options, lease, signal }),
			options.signal,
		);
	}

	deleteProjectById(options: DesktopProjectLibraryHostDeleteByIdOptions): Promise<boolean> {
		return this.#mutate(
			(lease, signal) => this.#projects.deleteProjectById({ ...options, lease, signal }),
			options.signal,
		);
	}

	publishManagedAudio(options: DesktopProjectLibraryHostPublishAudioOptions) {
		return this.publishManagedMedia({ ...options, encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING });
	}

	publishManagedMedia(options: DesktopProjectLibraryHostPublishMediaOptions) {
		return this.#mutate(async (lease, signal) => {
			this.#library.assertLease(lease);
			const loaded = await this.#projects.readProjectById(options.projectId, signal);
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
				signal,
			});
		}, options.signal);
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
		for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
		try { await this.#coordinator.close(); } catch (error) { failures.push(error); }
		try { this.#mediaInventory.close(); } catch (error) { failures.push(error); }
		try { this.#library.close(); } catch (error) { failures.push(error); }
		throwHostFailures(failures);
	}

	#mutate<Result>(
		operation: (lease: DesktopLibraryLease, signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal,
	): Promise<Result> {
		return this.#admit(
			(operationSignal) => this.#coordinator.run(operation, operationSignal),
			signal,
		);
	}

	#admit<Result>(
		operation: (signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal,
	): Promise<Result> {
		try { this.#assertAccepting(); } catch (error) { return Promise.reject(error); }
		const operationSignal = signal
			? AbortSignal.any([signal, this.#leaseLossController.signal])
			: this.#leaseLossController.signal;
		let admitted: Promise<Result>;
		try { admitted = operation(operationSignal); } catch (error) { return Promise.reject(error); }
		this.#operations.add(admitted);
		void admitted.then(
			() => { this.#operations.delete(admitted); },
			() => { this.#operations.delete(admitted); },
		);
		return admitted;
	}

	#assertAccepting(): void {
		if (this.#closed) throw new Error('Desktop project library host is closed');
		if (this.#coordinator.fenced) throw new Error('Desktop project library host lost its writer lease');
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
