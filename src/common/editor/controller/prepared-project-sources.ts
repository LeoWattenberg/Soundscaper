/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PreparedProjectSourceInputs {
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly chunkSources: ReadonlyMap<string, unknown>;
}

export interface PreparedRequiredProjectSources {
	commit<Result>(
		apply: (inputs: PreparedProjectSourceInputs) => PromiseLike<Result> | Result,
		options?: Readonly<{
			assertCurrent?: () => void;
			retireApplied?: () => PromiseLike<void> | void;
			transientBuffers?: ReadonlyMap<string, unknown>;
		}>,
	): Promise<Result>;
	discard(): PromiseLike<void> | void;
}

export interface PreparedProjectSourceEntry {
	readonly kind: 'buffer' | 'provider';
	readonly value: unknown;
}

interface SourceBufferCachePort extends Iterable<readonly [string, unknown]> {
	delete(sourceId: string): unknown;
}

interface SourceChunkProviderMap extends Iterable<readonly [string, unknown]> {
	delete(sourceId: string): unknown;
	drain?(): PromiseLike<void> | void;
	set(sourceId: string, provider: unknown): unknown;
}

export interface PreparedProjectSourcesOptions {
	readonly prepared: Map<string, PreparedProjectSourceEntry>;
	readonly signal?: AbortSignal;
	readonly sourceBuffers: SourceBufferCachePort;
	readonly sourceChunkProviders: SourceChunkProviderMap;
	readonly cacheSourceBuffer: (sourceId: string, buffer: unknown) => unknown;
	readonly throwIfAborted: (signal?: AbortSignal) => void;
}

/** Own staged source providers until one atomic engine/public-cache handoff. */
export function createPreparedProjectSources(
	options: PreparedProjectSourcesOptions,
): PreparedRequiredProjectSources {
	let state: 'prepared' | 'committing' | 'committed' | 'discarded' = 'prepared';
	let cleanupPromise: Promise<void> | null = null;
	return Object.freeze({ commit, discard });

	async function commit<Result>(
		apply: (inputs: PreparedProjectSourceInputs) => PromiseLike<Result> | Result,
		commitOptions: Readonly<{
			assertCurrent?: () => void;
			retireApplied?: () => PromiseLike<void> | void;
			transientBuffers?: ReadonlyMap<string, unknown>;
		}> = {},
	): Promise<Result> {
		if (state !== 'prepared') throw new Error(`The required source preparation is already ${state}.`);
		if (typeof apply !== 'function') {
			throw new TypeError('Required source preparation commit needs an apply callback.');
		}
		if (commitOptions.assertCurrent != null && typeof commitOptions.assertCurrent !== 'function') {
			throw new TypeError('Required source preparation currentness assertion must be a function.');
		}
		if (commitOptions.retireApplied != null && typeof commitOptions.retireApplied !== 'function') {
			throw new TypeError('Required source preparation retirement must be a function.');
		}
		state = 'committing';
		let result: Result;
		let applyStarted = false;
		try {
			options.throwIfAborted(options.signal);
			const preparedBuffers = new Map<string, unknown>(options.sourceBuffers);
			for (const [sourceId, buffer] of commitOptions.transientBuffers ?? []) {
				preparedBuffers.set(sourceId, buffer);
			}
			const preparedProviders = new Map<string, unknown>(options.sourceChunkProviders);
			for (const [sourceId, entry] of options.prepared) {
				preparedBuffers.delete(sourceId);
				preparedProviders.delete(sourceId);
				if (entry.kind === 'buffer') preparedBuffers.set(sourceId, entry.value);
				else preparedProviders.set(sourceId, entry.value);
			}
			applyStarted = true;
			result = await apply(Object.freeze({
				sourceBuffers: preparedBuffers,
				chunkSources: preparedProviders,
			}));
			options.throwIfAborted(options.signal);
			commitOptions.assertCurrent?.();
			for (const [sourceId, entry] of [...options.prepared]) {
				if (entry.kind === 'provider') {
					options.sourceChunkProviders.set(sourceId, entry.value);
					options.prepared.delete(sourceId);
					options.sourceBuffers.delete(sourceId);
					continue;
				}
				options.cacheSourceBuffer(sourceId, entry.value);
				options.sourceChunkProviders.delete(sourceId);
			}
			state = 'committed';
			options.prepared.clear();
		} catch (error) {
			let failure = error;
			if (applyStarted && commitOptions.retireApplied) {
				try {
					await commitOptions.retireApplied();
				} catch (retirementError) {
					failure = new AggregateError(
						[failure, retirementError],
						'Required source application and consumer retirement both failed.',
						{ cause: error },
					);
				}
			}
			state = 'discarded';
			cleanupPromise = disposePreparedProviders(options.prepared).finally(() => {
				options.prepared.clear();
			});
			try {
				await cleanupPromise;
			} catch (cleanupError) {
				throw new AggregateError(
					[failure, cleanupError],
					'Required source preparation and cleanup both failed.',
					{ cause: error },
				);
			}
			throw failure;
		}
		await options.sourceChunkProviders.drain?.();
		return result;
	}

	function discard(): Promise<void> {
		if (state === 'discarded') return cleanupPromise ?? Promise.resolve();
		if (state !== 'prepared') return Promise.resolve();
		state = 'discarded';
		cleanupPromise = disposePreparedProviders(options.prepared).finally(() => {
			options.prepared.clear();
		});
		return cleanupPromise;
	}
}

async function disposePreparedProviders(
	prepared: ReadonlyMap<string, PreparedProjectSourceEntry>,
): Promise<void> {
	const providers = new Set<Readonly<{ dispose(): PromiseLike<void> | void }>>();
	for (const entry of prepared.values()) {
		if (entry.kind === 'provider' && isDisposable(entry.value)) providers.add(entry.value);
	}
	const results = await Promise.allSettled([...providers].map(
		(provider) => Promise.resolve().then(() => provider.dispose()),
	));
	const failures = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map((result) => result.reason as unknown);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Required source provider cleanup failed.');
	}
}

function isDisposable(value: unknown): value is Readonly<{
	dispose(): PromiseLike<void> | void;
}> {
	return Boolean(value && typeof value === 'object'
		&& typeof (value as Readonly<{ dispose?: unknown }>).dispose === 'function');
}
