/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	LinkedVideoOriginalLocatorReference,
	LinkedVideoOriginalRepository,
} from './linked-video-original-repository.ts';
import type { LinkedVideoOriginalResolver } from './linked-video-original-resolver.ts';

const MAXIMUM_PENDING_REFERENCES = 128;

export type LinkedVideoOriginalCleanupOperation = 'delete-project' | 'clear' | 'retry';

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
	readonly onCleanupError?: (error: LinkedVideoOriginalLocatorCleanupError) => void;
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

/** Serializes one store's binding mutations with alias-aware exact locator retirement. */
export class LinkedVideoOriginalLifecycleCoordinator {
	readonly #bindings: LinkedVideoOriginalRepository | null;
	readonly #resolver: LinkedVideoOriginalResolver | null;
	readonly #onCleanupError: (error: LinkedVideoOriginalLocatorCleanupError) => void;
	readonly #pending = new Map<string, Readonly<{
		locatorRevision: string;
	}>>();
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

	deleteProject<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		return this.#enqueue(async () => {
			if (!this.#canRelease()) return operation();
			const before = await this.#bindings!.listLocatorReferences();
			try {
				const result = await operation();
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
				if (!this.#canRelease()) return admission.begin().completion;
				const before = await this.#bindings!.listLocatorReferences();
				const operation = admission.begin();
				const committed = await operation.localCommit;
				if (!committed) {
					try { return await operation.completion; }
					finally { await this.#drainPending('retry'); }
				}
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
	globalThis.console?.error?.('Committed linked-video locator cleanup remains pending.');
}
