/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import type {
	LinkedOriginalLocatorReference,
} from './linked-original-repository.ts';
import type {
	LinkedOriginalProjectBindingPruneResult,
	LinkedOriginalProjectSourceReference,
} from './linked-original-project-reachability-repository.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';
import {
	linkedOriginalTransientBindingReferenceFromBindResult,
	normalizeLinkedOriginalTransientBindingReference,
	type LinkedOriginalBindingPublicationResult,
	type LinkedOriginalTransientBindingReference,
} from './linked-original-transient-binding-reference.ts';

const MAXIMUM_PENDING_REFERENCES = 128;
const MAXIMUM_TRANSIENT_SOURCE_IDS = 100_000;

export type LinkedOriginalCleanupOperation = 'save-project' | 'open-project' | 'delete-project' | 'clear' | 'retry';
export type LinkedOriginalProjectBindingCleanupOperation = 'save-project' | 'open-project';

export type LinkedOriginalCleanupError =
	| LinkedOriginalLocatorCleanupError
	| LinkedOriginalProjectBindingCleanupError;

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

export interface LinkedOriginalLifecycleOptions {
	readonly onCleanupError?: (error: LinkedOriginalCleanupError) => void;
}

export interface LinkedOriginalLifecycleBindingPort {
	listLocatorReferences(): PromiseLike<readonly LinkedOriginalLocatorReference[]>;
}

export interface LinkedOriginalLifecycleResolverPort {
	canReleaseLocators(): boolean;
	validateLocatorReference(value: unknown): Readonly<LinkedOriginalLocatorReference>;
	release(reference: LinkedOriginalLocatorReference): PromiseLike<boolean>;
}

/** A local binding mutation committed, but exact platform-locator cleanup remains pending. */
export class LinkedOriginalLocatorCleanupError extends Error {
	readonly committed = true;
	readonly operation: LinkedOriginalCleanupOperation;
	readonly pendingCount: number;

	constructor(
		operation: LinkedOriginalCleanupOperation,
		pendingCount: number,
		cause: unknown,
	) {
		super('Committed linked-original binding cleanup could not release every platform locator.', { cause });
		this.name = 'LinkedOriginalLocatorCleanupError';
		this.operation = operation;
		this.pendingCount = pendingCount;
	}
}

/** A project commit or activation succeeded, but stale local binding retirement remains pending. */
export class LinkedOriginalProjectBindingCleanupError extends Error {
	readonly committed = true;
	readonly operation: LinkedOriginalProjectBindingCleanupOperation;
	readonly projectId: string;

	constructor(operation: LinkedOriginalProjectBindingCleanupOperation, projectId: string, cause: unknown) {
		super(`Project ${projectId} ${operation === 'save-project' ? 'committed' : 'activated'}, but linked-original binding cleanup failed.`, { cause });
		this.name = 'LinkedOriginalProjectBindingCleanupError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

/** Serializes one store's binding mutations with alias-aware exact locator retirement. */
export class LinkedOriginalLifecycleCoordinator {
	readonly #bindings: LinkedOriginalLifecycleBindingPort | null;
	readonly #resolver: LinkedOriginalLifecycleResolverPort | null;
	readonly #onCleanupError: (error: LinkedOriginalCleanupError) => void;
	readonly #pending = new Map<string, Readonly<{
		kind: LinkedOriginalLocatorReference['kind'];
		locatorId: string;
		locatorRevision: string;
	}>>();
	readonly #transientSources = new Map<string, Map<string, LinkedOriginalTransientBindingReference>>();
	readonly #blockedTransientProjects = new Set<string>();
	#transientSourceCount = 0;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		bindings: LinkedOriginalLifecycleBindingPort | null,
		resolver: LinkedOriginalLifecycleResolverPort | null,
		options: LinkedOriginalLifecycleOptions = {},
	) {
		if (options.onCleanupError !== undefined && typeof options.onCleanupError !== 'function') {
			throw new TypeError('Linked-original locator cleanup reporting must be a function.');
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

	bind<Value extends LinkedOriginalBindingPublicationResult>(
		projectId: string,
		sourceReference: LinkedOriginalProjectSourceReference,
		operation: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		const source = normalizeProjectSourceReference(projectId, sourceReference);
		return this.#enqueue(async () => {
			try {
				const result = await operation();
				this.#rememberTransientSource(projectId, (
					linkedOriginalTransientBindingReferenceFromBindResult(projectId, source, result)
				));
				return result;
			} finally { await this.#drainPending('retry'); }
		});
	}

	unlink(
		projectId: string,
		sourceReference: LinkedOriginalTransientBindingReference,
		operation: () => PromiseLike<boolean> | boolean,
	): Promise<boolean> {
		const source = normalizeLinkedOriginalTransientBindingReference(sourceReference);
		linkedOriginalBindingKey(projectId, source.sourceId);
		return this.#enqueue(async () => {
			try {
				const removed = await operation();
				if (removed) this.#forgetTransientSource(projectId, source);
				return removed;
			} finally { await this.#drainPending('retry'); }
		});
	}

	saveProject<Value>(
		projectId: string,
		operation: (maintain: () => Promise<void>) => PromiseLike<Value> | Value,
		prune: (
			transientBindings: readonly LinkedOriginalTransientBindingReference[],
		) => PromiseLike<LinkedOriginalProjectBindingPruneResult | null>
			| LinkedOriginalProjectBindingPruneResult | null,
	): Promise<Value> {
		linkedOriginalBindingKey(projectId, 'save-project-validation-source');
		if (typeof operation !== 'function' || typeof prune !== 'function') {
			throw new TypeError('Linked-original project save lifecycle operations must be functions.');
		}
		return this.#enqueue(async () => {
			let maintenance: Promise<void> | null = null;
			const maintain = (): Promise<void> => {
				maintenance ??= this.#maintainProjectBindings(projectId, 'save-project', prune).then(() => undefined);
				return maintenance;
			};
			try {
				const result = await operation(maintain);
				await maintain();
				return result;
			} finally {
				await this.#drainPending('retry');
			}
		});
	}

	maintainOpenedProject(
		projectId: string,
		prune: (
			transientBindings: readonly LinkedOriginalTransientBindingReference[],
		) => PromiseLike<LinkedOriginalProjectBindingPruneResult | null>
			| LinkedOriginalProjectBindingPruneResult | null,
	): Promise<boolean> {
		linkedOriginalBindingKey(projectId, 'open-project-validation-source');
		if (typeof prune !== 'function') throw new TypeError('Linked-original open maintenance must be a function.');
		return this.#enqueue(async () => {
			await this.#drainPending('retry');
			const failedRetryKeys = new Set(this.#pending.keys());
			return this.#maintainProjectBindings(projectId, 'open-project', prune, failedRetryKeys);
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
		if (projectId) linkedOriginalBindingKey(projectId, 'delete-project-validation-source');
		if (typeof operation !== 'function') {
			throw new TypeError('A linked-original project deletion operation is required.');
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
		reference: LinkedOriginalLocatorReference,
	): Promise<boolean> {
		return this.#enqueue(async () => {
			const admitted = this.#resolver!.validateLocatorReference(reference);
			if (this.#canRelease()) {
				const live = await this.#bindings!.listLocatorReferences();
				if (live.some((candidate) => sameLocatorIdentity(candidate, admitted))) {
					await this.#drainPending('retry');
					return false;
				}
			}
			try {
				const released = await this.#resolver!.release(admitted);
				if (released === true || released === false) {
					const key = locatorReferenceKey(admitted);
					const pending = this.#pending.get(key);
					if (pending?.locatorRevision === admitted.locatorRevision) {
						this.#pending.delete(key);
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
		operation: LinkedOriginalProjectBindingCleanupOperation,
		prune: (
			transientBindings: readonly LinkedOriginalTransientBindingReference[],
		) => PromiseLike<LinkedOriginalProjectBindingPruneResult | null>
			| LinkedOriginalProjectBindingPruneResult | null,
		releaseExclusions?: ReadonlySet<string>,
	): Promise<boolean> {
		if (this.#blockedTransientProjects.has(projectId)) {
			return false;
		}
		const transientBindings = Object.freeze([
			...(this.#transientSources.get(projectId)?.values() ?? []),
		].sort(compareTransientBindings));
		let result: LinkedOriginalProjectBindingPruneResult | null;
		try {
			result = normalizeProjectBindingPruneResult(await prune(transientBindings));
		} catch (cause) {
			this.#reportProjectBindingCleanup(operation, projectId, cause);
			return false;
		}
		if (!result) {
			return false;
		}
		for (const source of result.settledTransientBindings) {
			this.#forgetTransientSource(projectId, source);
		}
		if (result.removedLocatorReferences.length) {
			await this.#drainPending(operation, result.removedLocatorReferences, releaseExclusions);
		}
		return true;
	}

	#rememberTransientSource(projectId: string, source: LinkedOriginalTransientBindingReference): void {
		const sources = this.#transientSources.get(projectId) ?? new Map();
		const key = sourceReferenceKey(source);
		if (!sources.has(key) && this.#transientSourceCount >= MAXIMUM_TRANSIENT_SOURCE_IDS) {
			this.#blockedTransientProjects.add(projectId);
			return;
		}
		if (!sources.has(key)) this.#transientSourceCount += 1;
		sources.set(key, source);
		this.#transientSources.set(projectId, sources);
	}

	#forgetTransientSource(projectId: string, source: LinkedOriginalTransientBindingReference): void {
		const sources = this.#transientSources.get(projectId);
		const key = sourceReferenceKey(source);
		if (sources?.get(key)?.bindingToken !== source.bindingToken || !sources.delete(key)) return;
		this.#transientSourceCount -= 1;
		if (!sources.size) this.#transientSources.delete(projectId);
	}

	#clearTransientSources(): void {
		this.#transientSources.clear();
		this.#blockedTransientProjects.clear();
		this.#transientSourceCount = 0;
	}

	#clearTransientProject(projectId: string): void {
		const sources = this.#transientSources.get(projectId);
		if (sources) this.#transientSourceCount -= sources.size;
		this.#transientSources.delete(projectId);
		this.#blockedTransientProjects.delete(projectId);
	}

	async #drainPending(
		operation: LinkedOriginalCleanupOperation,
		possible: readonly LinkedOriginalLocatorReference[] = [],
		releaseExclusions?: ReadonlySet<string>,
	): Promise<void> {
		if (!this.#canRelease() || (!possible.length && !this.#pending.size)) return;
		const admittedPossible: LinkedOriginalLocatorReference[] = [];
		const admissionFailures: unknown[] = [];
		for (const reference of possible) {
			try { admittedPossible.push(this.#resolver!.validateLocatorReference(reference)); }
			catch (error) { admissionFailures.push(error); }
		}
		if (admissionFailures.length) this.#report(operation, new AggregateError(
			admissionFailures,
			'One or more linked-original cleanup references were invalid.',
		));
		if (!admittedPossible.length && !this.#pending.size) return;
		let live: readonly LinkedOriginalLocatorReference[];
		try { live = await this.#bindings!.listLocatorReferences(); }
		catch (cause) {
			this.#rememberPossible(admittedPossible, operation);
			this.#report(operation, cause);
			return;
		}
		const liveIds = new Set(live.map(locatorReferenceKey));
		for (const key of liveIds) this.#pending.delete(key);
		this.#rememberPossible(
			admittedPossible.filter((reference) => !liveIds.has(locatorReferenceKey(reference))),
			operation,
		);
		const candidates = [...this.#pending.values()].filter((pending) => (
			!releaseExclusions?.has(locatorReferenceKey(pending))
		)).map((pending) => ({
			kind: pending.kind,
			locatorId: pending.locatorId,
			locatorRevision: pending.locatorRevision,
		}));
		const results = await Promise.allSettled(candidates.map((reference) => (
			this.#resolver!.release(reference)
		)));
		const failures: unknown[] = [];
		for (const [index, result] of results.entries()) {
			const reference = candidates[index];
			if (result.status === 'rejected') failures.push(result.reason);
			else if (this.#pending.get(locatorReferenceKey(reference))?.locatorRevision
				=== reference.locatorRevision) {
				this.#pending.delete(locatorReferenceKey(reference));
			}
		}
		if (failures.length) {
			this.#report(operation, new AggregateError(
				failures,
				'One or more exact linked-original locator releases failed.',
			));
		}
	}

	#rememberPossible(
		references: readonly LinkedOriginalLocatorReference[],
		operation: LinkedOriginalCleanupOperation,
	): void {
		let exceeded = false;
		for (const reference of references) {
			const key = locatorReferenceKey(reference);
			if (!this.#pending.has(key) && this.#pending.size >= MAXIMUM_PENDING_REFERENCES) {
				exceeded = true;
				continue;
			}
			this.#pending.set(key, Object.freeze({
				kind: reference.kind,
				locatorId: reference.locatorId,
				locatorRevision: reference.locatorRevision,
			}));
		}
		if (exceeded) this.#report(operation, new RangeError(
			'Linked-original locator cleanup pending references exceed their limit.',
		));
	}

	#report(operation: LinkedOriginalCleanupOperation, cause: unknown): void {
		const error = new LinkedOriginalLocatorCleanupError(operation, this.#pending.size, cause);
		try { this.#onCleanupError(error); } catch { /* Reporting cannot restore committed bindings. */ }
	}

	#reportProjectBindingCleanup(
		operation: LinkedOriginalProjectBindingCleanupOperation,
		projectId: string,
		cause: unknown,
	): void {
		const error = new LinkedOriginalProjectBindingCleanupError(operation, projectId, cause);
		try { this.#onCleanupError(error); } catch { /* Reporting cannot restore committed bindings. */ }
	}
}

function normalizeProjectSourceReference(
	projectId: string,
	value: unknown,
): LinkedOriginalProjectSourceReference {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original project source reference is required.');
	}
	const fields = ['kind', 'sourceId'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('A linked original project source reference contains an unsupported field.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original project source ${field} must be an enumerable data field.`);
		}
	}
	if (record.kind !== 'audio' && record.kind !== 'video') {
		throw new TypeError('Linked original project source kind must be audio or video.');
	}
	linkedOriginalBindingKey(projectId, record.sourceId);
	return Object.freeze({ kind: record.kind, sourceId: record.sourceId as string });
}

function sourceReferenceKey(reference: LinkedOriginalProjectSourceReference): string {
	return JSON.stringify([reference.kind, reference.sourceId]);
}

function locatorReferenceKey(reference: LinkedOriginalLocatorReference): string {
	return JSON.stringify([reference.kind, reference.locatorId]);
}

function sameLocatorIdentity(
	left: LinkedOriginalLocatorReference,
	right: LinkedOriginalLocatorReference,
): boolean {
	return left.kind === right.kind && left.locatorId === right.locatorId;
}

function compareTransientBindings(
	left: LinkedOriginalTransientBindingReference,
	right: LinkedOriginalTransientBindingReference,
): number {
	return compareCodeUnits(left.kind, right.kind) || compareCodeUnits(left.sourceId, right.sourceId);
}

function normalizeProjectBindingPruneResult(
	value: LinkedOriginalProjectBindingPruneResult | null,
): LinkedOriginalProjectBindingPruneResult | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Array.isArray(value.durableSourceReferences)
		|| !Array.isArray(value.removedLocatorReferences)
		|| !Array.isArray(value.settledTransientBindings)) {
		throw new TypeError('Linked-original project binding cleanup returned an invalid result.');
	}
	const durableSourceReferences = value.durableSourceReferences.map((source) => (
		normalizeProjectSourceReference('save-project-validation-project', source)
	));
	if (new Set(durableSourceReferences.map(sourceReferenceKey)).size
		!== durableSourceReferences.length) {
		throw new Error('Linked-original project binding cleanup returned duplicate durable sources.');
	}
	const settledTransientBindings = value.settledTransientBindings.map((reference) => (
		normalizeLinkedOriginalTransientBindingReference(reference)
	));
	if (new Set(settledTransientBindings.map(sourceReferenceKey)).size
		!== settledTransientBindings.length) {
		throw new Error('Linked-original project binding cleanup returned duplicate transient bindings.');
	}
	return Object.freeze({
		durableSourceReferences: Object.freeze(durableSourceReferences),
		removedLocatorReferences: Object.freeze([...value.removedLocatorReferences]),
		settledTransientBindings: Object.freeze(settledTransientBindings),
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
	globalThis.console?.error?.('Committed linked-original cleanup remains pending.');
}
