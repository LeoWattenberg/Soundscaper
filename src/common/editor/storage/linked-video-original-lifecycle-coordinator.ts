/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	LinkedVideoOriginalLocatorReference,
	LinkedVideoOriginalRepository,
} from './linked-video-original-repository.ts';
import type { LinkedVideoOriginalResolver } from './linked-video-original-resolver.ts';
import { linkedVideoOriginalBindingKey } from './linked-video-original-schema.ts';

const MAXIMUM_PENDING_REFERENCES = 128;
const MAXIMUM_TRANSIENT_SOURCE_IDS = 100_000;

export type LinkedVideoOriginalCleanupOperation = 'save-project' | 'delete-project' | 'clear' | 'retry';

export interface LinkedVideoOriginalProjectBindingPruneResult {
	readonly durableVideoSourceIds: readonly string[];
	readonly removedLocatorReferences: readonly LinkedVideoOriginalLocatorReference[];
}

export type LinkedVideoOriginalCleanupError =
	| LinkedVideoOriginalLocatorCleanupError
	| LinkedVideoOriginalProjectBindingCleanupError;

export interface LocalStoreClearOperation {
	readonly localCommit: Promise<boolean>;
	readonly completion: Promise<void>;
}

export interface LocalStoreClearAdmission {
	begin(): LocalStoreClearOperation;
	cancel(): void;
}

export interface LocalStoreClearPort {
	admitClear?(): LocalStoreClearAdmission;
	beginClear?(): LocalStoreClearOperation;
	clear(): Promise<void>;
}

export interface LinkedVideoOriginalLifecycleOptions {
	readonly onCleanupError?: (error: LinkedVideoOriginalCleanupError) => void;
}

/** A local binding mutation committed, but exact platform-locator cleanup remains pending. */
export class LinkedVideoOriginalLocatorCleanupError extends Error {
	readonly committed = true;
	readonly operation: LinkedVideoOriginalCleanupOperation;
	readonly pendingCount: number;

	constructor(
		operation: LinkedVideoOriginalCleanupOperation,
		pendingCount: number,
		cause: unknown,
	) {
		super('Committed linked-video binding cleanup could not release every platform locator.', { cause });
		this.name = 'LinkedVideoOriginalLocatorCleanupError';
		this.operation = operation;
		this.pendingCount = pendingCount;
	}
}

/** A project commit succeeded, but stale local binding retirement remains pending. */
export class LinkedVideoOriginalProjectBindingCleanupError extends Error {
	readonly committed = true;
	readonly operation = 'save-project' as const;
	readonly projectId: string;

	constructor(projectId: string, cause: unknown) {
		super(`Project ${projectId} committed, but linked-video binding cleanup failed.`, { cause });
		this.name = 'LinkedVideoOriginalProjectBindingCleanupError';
		this.projectId = projectId;
	}
}

/** Serializes one store's binding mutations with alias-aware exact locator retirement. */
export class LinkedVideoOriginalLifecycleCoordinator {
	readonly #bindings: LinkedVideoOriginalRepository | null;
	readonly #resolver: LinkedVideoOriginalResolver | null;
	readonly #onCleanupError: (error: LinkedVideoOriginalCleanupError) => void;
	readonly #pending = new Map<string, Readonly<{
		locatorRevision: string;
	}>>();
	readonly #transientSourceIds = new Map<string, Set<string>>();
	readonly #blockedTransientProjects = new Set<string>();
	#transientSourceCount = 0;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		bindings: LinkedVideoOriginalRepository | null,
		resolver: LinkedVideoOriginalResolver | null,
		options: LinkedVideoOriginalLifecycleOptions = {},
	) {
		if (options.onCleanupError !== undefined && typeof options.onCleanupError !== 'function') {
			throw new TypeError('Linked-video locator cleanup reporting must be a function.');
		}
		this.#bindings = bindings;
		this.#resolver = resolver;
		this.#onCleanupError = options.onCleanupError ?? reportCleanupError;
	}

	run<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		return this.#enqueue(async () => {
			try { return await operation(); }
			finally { await this.#drainPending('retry'); }
		});
	}

	bind<Value>(
		projectId: string,
		sourceId: string,
		operation: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		validateProjectSourceIds(projectId, sourceId);
		return this.#enqueue(async () => {
			try {
				const result = await operation();
				this.#rememberTransientSource(projectId, sourceId);
				return result;
			} finally { await this.#drainPending('retry'); }
		});
	}

	unlink(
		projectId: string,
		sourceId: string,
		operation: () => PromiseLike<boolean> | boolean,
	): Promise<boolean> {
		validateProjectSourceIds(projectId, sourceId);
		return this.#enqueue(async () => {
			try {
				const removed = await operation();
				if (removed) this.#forgetTransientSource(projectId, sourceId);
				return removed;
			} finally { await this.#drainPending('retry'); }
		});
	}

	saveProject<Value>(
		projectId: string,
		operation: (maintain: () => Promise<void>) => PromiseLike<Value> | Value,
		prune: (
			transientSourceIds: readonly string[],
		) => PromiseLike<LinkedVideoOriginalProjectBindingPruneResult | null>
			| LinkedVideoOriginalProjectBindingPruneResult | null,
	): Promise<Value> {
		validateProjectSourceIds(projectId, 'save-project-validation-source');
		if (typeof operation !== 'function' || typeof prune !== 'function') {
			throw new TypeError('Linked-video project save lifecycle operations must be functions.');
		}
		return this.#enqueue(async () => {
			let maintenance: Promise<void> | null = null;
			const maintain = (): Promise<void> => {
				maintenance ??= this.#maintainProjectBindings(projectId, prune);
				return maintenance;
			};
			try {
				const result = await operation(maintain);
				await maintain();
				return result;
			} catch (error) {
				await this.#drainPending('retry');
				throw error;
			}
		});
	}

	deleteProject<Value>(
		projectIdOrOperation: string | (() => PromiseLike<Value> | Value),
		requestedOperation?: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		const projectId = typeof projectIdOrOperation === 'string' ? projectIdOrOperation : null;
		const operation = typeof projectIdOrOperation === 'function'
			? projectIdOrOperation
			: requestedOperation;
		if (projectId) validateProjectSourceIds(projectId, 'delete-project-validation-source');
		if (typeof operation !== 'function') {
			throw new TypeError('A linked-video project deletion operation is required.');
		}
		return this.#enqueue(async () => {
			if (!this.#canRelease()) {
				const result = await operation();
				if (projectId) this.#clearTransientProject(projectId);
				return result;
			}
			const before = await this.#bindings!.listLocatorReferences();
			try {
				const result = await operation();
				if (projectId) this.#clearTransientProject(projectId);
				await this.#drainPending('delete-project', before);
				return result;
			} catch (error) {
				await this.#drainPending('retry');
				throw error;
			}
		});
	}

	clear(admission: LocalStoreClearAdmission): Promise<void> {
		return this.#enqueue(async () => {
			try {
				if (!this.#canRelease()) {
					const operation = admission.begin();
					if (await operation.localCommit) this.#clearTransientSources();
					return operation.completion;
				}
				const before = await this.#bindings!.listLocatorReferences();
				const operation = admission.begin();
				const committed = await operation.localCommit;
				if (!committed) {
					try { return await operation.completion; }
					finally { await this.#drainPending('retry'); }
				}
				this.#clearTransientSources();
				const [completion] = await Promise.allSettled([
					operation.completion,
					this.#drainPending('clear', before),
				]);
				if (completion.status === 'rejected') throw completion.reason;
			} finally {
				admission.cancel();
			}
		});
	}

	releaseUnused(
		reference: LinkedVideoOriginalLocatorReference,
	): Promise<boolean> {
		return this.#enqueue(async () => {
			const admitted = this.#resolver!.validateLocatorReference(reference);
			if (this.#canRelease()) {
				const live = await this.#bindings!.listLocatorReferences();
				if (live.some(({ locatorId }) => locatorId === admitted.locatorId)) {
					await this.#drainPending('retry');
					return false;
				}
			}
			try {
				const released = await this.#resolver!.release(admitted);
				if (released === true || released === false) {
					const pending = this.#pending.get(admitted.locatorId);
					if (pending?.locatorRevision === admitted.locatorRevision) {
						this.#pending.delete(admitted.locatorId);
					}
				}
				await this.#drainPending('retry');
				return released;
			} catch (error) {
				await this.#drainPending('retry');
				throw error;
			}
		});
	}

	#enqueue<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		const result = this.#tail.catch(() => undefined).then(operation);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}

	#canRelease(): boolean {
		return Boolean(this.#bindings && this.#resolver?.canReleaseLocators());
	}

	async #maintainProjectBindings(
		projectId: string,
		prune: (
			transientSourceIds: readonly string[],
		) => PromiseLike<LinkedVideoOriginalProjectBindingPruneResult | null>
			| LinkedVideoOriginalProjectBindingPruneResult | null,
	): Promise<void> {
		if (this.#blockedTransientProjects.has(projectId)) {
			return;
		}
		const transientSourceIds = Object.freeze([
			...(this.#transientSourceIds.get(projectId) ?? []),
		].sort());
		let result: LinkedVideoOriginalProjectBindingPruneResult | null;
		try {
			result = normalizeProjectBindingPruneResult(await prune(transientSourceIds));
		} catch (cause) {
			this.#reportProjectBindingCleanup(projectId, cause);
			return;
		}
		if (!result) {
			return;
		}
		for (const sourceId of result.durableVideoSourceIds) {
			this.#forgetTransientSource(projectId, sourceId);
		}
		if (result.removedLocatorReferences.length) {
			await this.#drainPending('save-project', result.removedLocatorReferences);
		}
	}

	#rememberTransientSource(projectId: string, sourceId: string): void {
		const sourceIds = this.#transientSourceIds.get(projectId) ?? new Set<string>();
		if (sourceIds.has(sourceId)) return;
		if (this.#transientSourceCount >= MAXIMUM_TRANSIENT_SOURCE_IDS) {
			this.#blockedTransientProjects.add(projectId);
			return;
		}
		sourceIds.add(sourceId);
		this.#transientSourceCount += 1;
		this.#transientSourceIds.set(projectId, sourceIds);
	}

	#forgetTransientSource(projectId: string, sourceId: string): void {
		const sourceIds = this.#transientSourceIds.get(projectId);
		if (!sourceIds?.delete(sourceId)) return;
		this.#transientSourceCount -= 1;
		if (!sourceIds.size) this.#transientSourceIds.delete(projectId);
	}

	#clearTransientSources(): void {
		this.#transientSourceIds.clear();
		this.#blockedTransientProjects.clear();
		this.#transientSourceCount = 0;
	}

	#clearTransientProject(projectId: string): void {
		const sourceIds = this.#transientSourceIds.get(projectId);
		if (sourceIds) this.#transientSourceCount -= sourceIds.size;
		this.#transientSourceIds.delete(projectId);
		this.#blockedTransientProjects.delete(projectId);
	}

	async #drainPending(
		operation: LinkedVideoOriginalCleanupOperation,
		possible: readonly LinkedVideoOriginalLocatorReference[] = [],
	): Promise<void> {
		if (!this.#canRelease() || (!possible.length && !this.#pending.size)) return;
		let live: readonly LinkedVideoOriginalLocatorReference[];
		try { live = await this.#bindings!.listLocatorReferences(); }
		catch (cause) {
			this.#rememberPossible(possible, operation);
			this.#report(operation, cause);
			return;
		}
		const liveIds = new Set(live.map(({ locatorId }) => locatorId));
		for (const locatorId of liveIds) this.#pending.delete(locatorId);
		this.#rememberPossible(
			possible.filter(({ locatorId }) => !liveIds.has(locatorId)),
			operation,
		);
		const candidates = [...this.#pending].map(([locatorId, pending]) => ({
			locatorId,
			locatorRevision: pending.locatorRevision,
		}));
		const results = await Promise.allSettled(candidates.map((reference) => (
			this.#resolver!.release(reference)
		)));
		const failures: unknown[] = [];
		for (const [index, result] of results.entries()) {
			const reference = candidates[index];
			if (result.status === 'rejected') failures.push(result.reason);
			else if (this.#pending.get(reference.locatorId)?.locatorRevision === reference.locatorRevision) {
				this.#pending.delete(reference.locatorId);
			}
		}
		if (failures.length) {
			this.#report(operation, new AggregateError(
				failures,
				'One or more exact linked-video locator releases failed.',
			));
		}
	}

	#rememberPossible(
		references: readonly LinkedVideoOriginalLocatorReference[],
		operation: LinkedVideoOriginalCleanupOperation,
	): void {
		let exceeded = false;
		for (const { locatorId, locatorRevision } of references) {
			if (!this.#pending.has(locatorId) && this.#pending.size >= MAXIMUM_PENDING_REFERENCES) {
				exceeded = true;
				continue;
			}
			this.#pending.set(locatorId, Object.freeze({ locatorRevision }));
		}
		if (exceeded) this.#report(operation, new RangeError(
			'Linked-video locator cleanup pending references exceed their limit.',
		));
	}

	#report(operation: LinkedVideoOriginalCleanupOperation, cause: unknown): void {
		const error = new LinkedVideoOriginalLocatorCleanupError(operation, this.#pending.size, cause);
		try { this.#onCleanupError(error); } catch { /* Reporting cannot restore committed bindings. */ }
	}

	#reportProjectBindingCleanup(projectId: string, cause: unknown): void {
		const error = new LinkedVideoOriginalProjectBindingCleanupError(projectId, cause);
		try { this.#onCleanupError(error); } catch { /* Reporting cannot restore committed bindings. */ }
	}
}

function validateProjectSourceIds(projectId: string, sourceId: string): void {
	linkedVideoOriginalBindingKey(projectId, sourceId);
}

function normalizeProjectBindingPruneResult(
	value: LinkedVideoOriginalProjectBindingPruneResult | null,
): LinkedVideoOriginalProjectBindingPruneResult | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Array.isArray(value.durableVideoSourceIds)
		|| !Array.isArray(value.removedLocatorReferences)) {
		throw new TypeError('Linked-video project binding cleanup returned an invalid result.');
	}
	const durableVideoSourceIds = value.durableVideoSourceIds.map((sourceId) => {
		validateProjectSourceIds('save-project-validation-project', sourceId);
		return sourceId;
	});
	if (new Set(durableVideoSourceIds).size !== durableVideoSourceIds.length) {
		throw new Error('Linked-video project binding cleanup returned duplicate durable source IDs.');
	}
	return Object.freeze({
		durableVideoSourceIds: Object.freeze(durableVideoSourceIds),
		removedLocatorReferences: Object.freeze([...value.removedLocatorReferences]),
	});
}

export function admitLocalStoreClear(port: LocalStoreClearPort): LocalStoreClearAdmission {
	if (typeof port.admitClear === 'function') return port.admitClear();
	let pending = true;
	return Object.freeze({
		begin(): LocalStoreClearOperation {
			if (!pending) throw new Error('The local store clear admission is no longer current.');
			pending = false;
			return beginLocalStoreClear(port);
		},
		cancel(): void { pending = false; },
	});
}

function beginLocalStoreClear(port: LocalStoreClearPort): LocalStoreClearOperation {
	if (typeof port.beginClear === 'function') return port.beginClear();
	const completion = Promise.resolve().then(() => port.clear());
	return Object.freeze({
		localCommit: completion.then(() => true, () => false),
		completion,
	});
}

function reportCleanupError(): void {
	globalThis.console?.error?.('Committed linked-video cleanup remains pending.');
}
