/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SourceChunkProviderDisposable {
	dispose(): PromiseLike<void> | void;
}

export interface SourceChunkProviderReplacement {
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

interface CleanupFailure {
	readonly error: unknown;
	readonly order: number;
}

interface ReplacementState<Key, Value> {
	readonly detached: Map<Key, Value>;
	finalized: boolean;
	settling: boolean;
}

interface RuntimeDisposable {
	dispose(): unknown;
}

export class SourceChunkProviderRegistry<Key, Value> extends Map<Key, Value> {
	readonly #cleanedProviders = new WeakSet<object>();
	readonly #cleanupFailures: CleanupFailure[] = [];
	readonly #pendingCleanups = new Set<Promise<void>>();
	#activeReplacement: ReplacementState<Key, Value> | null = null;
	#retirementOrder = 0;

	constructor(entries?: Iterable<readonly [Key, Value]> | null) {
		super();
		if (entries) {
			for (const [key, value] of entries) this.set(key, value);
		}
	}

	override set(key: Key, value: Value): this {
		this.#assertMutable();
		const hadPriorValue = super.has(key);
		const priorValue = super.get(key);
		super.set(key, value);
		if (hadPriorValue && priorValue !== value) this.#retireIfUnreferenced(priorValue as Value);
		return this;
	}

	override delete(key: Key): boolean {
		this.#assertMutable();
		if (!super.has(key)) return false;
		const priorValue = super.get(key) as Value;
		const deleted = super.delete(key);
		if (deleted) this.#retireIfUnreferenced(priorValue);
		return deleted;
	}

	override clear(): void {
		this.#assertMutable();
		const priorValues = new Set(super.values());
		super.clear();
		for (const value of priorValues) this.#retireIfUnreferenced(value);
	}

	async drain(): Promise<void> {
		while (this.#pendingCleanups.size > 0) {
			await Promise.all(this.#pendingCleanups);
		}
		const failures = this.#cleanupFailures
			.splice(0)
			.sort((left, right) => left.order - right.order)
			.map(({ error }) => error);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Multiple source chunk provider cleanup operations failed.');
		}
	}

	beginReplacement(): SourceChunkProviderReplacement {
		if (this.#activeReplacement) {
			throw new Error('A source chunk provider replacement is already active.');
		}
		const replacement: ReplacementState<Key, Value> = {
			detached: new Map(super.entries()),
			finalized: false,
			settling: false,
		};
		super.clear();
		this.#activeReplacement = replacement;
		return Object.freeze({
			commit: () => this.#finalizeReplacement(replacement, false),
			rollback: () => this.#finalizeReplacement(replacement, true),
		});
	}

	#retireIfUnreferenced(value: Value): void {
		if (!isDisposable(value) || this.#cleanedProviders.has(value)) return;
		for (const current of super.values()) {
			if (current === value) return;
		}
		this.#cleanedProviders.add(value);
		const order = this.#retirementOrder;
		this.#retirementOrder += 1;
		let cleanup: unknown;
		try {
			cleanup = value.dispose();
		} catch (error) {
			this.#cleanupFailures.push({ error, order });
			return;
		}
		const trackedCleanup = Promise.resolve(cleanup).then(
			() => {
				this.#pendingCleanups.delete(trackedCleanup);
			},
			(error: unknown) => {
				this.#cleanupFailures.push({ error, order });
				this.#pendingCleanups.delete(trackedCleanup);
			},
		);
		this.#pendingCleanups.add(trackedCleanup);
	}

	async #finalizeReplacement(
		replacement: ReplacementState<Key, Value>,
		rollback: boolean,
	): Promise<void> {
		if (replacement.finalized) {
			throw new Error('This source chunk provider replacement has already been finalized.');
		}
		if (this.#activeReplacement !== replacement) {
			throw new Error('This source chunk provider replacement is no longer active.');
		}
		replacement.finalized = true;
		replacement.settling = true;
		if (rollback) this.#retireStagedProviders(replacement.detached);
		else this.#retireDetachedProviders(replacement.detached);
		if (rollback) {
			for (const [key, value] of replacement.detached) super.set(key, value);
		}
		replacement.detached.clear();
		this.#activeReplacement = null;
		await this.drain();
	}

	#retireDetachedProviders(detached: ReadonlyMap<Key, Value>): void {
		for (const value of new Set(detached.values())) this.#retireIfUnreferenced(value);
	}

	#retireStagedProviders(detached: ReadonlyMap<Key, Value>): void {
		const retainedValues = new Set(detached.values());
		const stagedValues = new Set(super.values());
		super.clear();
		for (const value of stagedValues) {
			if (!retainedValues.has(value)) this.#retireIfUnreferenced(value);
		}
	}

	#assertMutable(): void {
		if (this.#activeReplacement?.settling) {
			throw new Error('Source chunk providers cannot change while a replacement is settling.');
		}
	}
}

function isDisposable(value: unknown): value is object & RuntimeDisposable {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
	return typeof (value as Partial<RuntimeDisposable>).dispose === 'function';
}
