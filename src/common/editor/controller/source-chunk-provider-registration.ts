/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit legacy ports keep this migration seam typo-safe while source records are narrowed. */

interface SourceChunkProviderRegistryPort extends Map<string, any> {
	drain?(): PromiseLike<void> | void;
}

export interface SourceChunkProviderRegistrationRuntime {
	readonly createStoredChunkProvider: (store: any, source: any, metadata: any) => any;
	readonly engine: any;
	readonly isStreamableStoredSource: (source: any, metadata: any) => boolean;
	readonly sourceChunkProviders: SourceChunkProviderRegistryPort;
	readonly store: any;
}

/** Own the registry side of stored chunk providers: candidacy, publication, retirement. */
export function createSourceChunkProviderRegistration(
	runtime: SourceChunkProviderRegistrationRuntime,
) {
	const {
		createStoredChunkProvider, engine, isStreamableStoredSource, sourceChunkProviders, store,
	} = runtime;

	/**
	 * Build the provider that should serve one stored source.
	 *
	 * Every registration builds a fresh provider even when the stored record is
	 * unchanged. Reusing the live one looks tempting — it would spare the read
	 * session an in-flight render is streaming through — but retirement is also
	 * how the previous provider's exclusive OPFS access handle is released, and
	 * holding it made a later read of the same payload fail as a missing source.
	 */
	function createStoredChunkProviderCandidate(source: any, metadata: any) {
		if (typeof store.readSourceChunk !== 'function' || !isStreamableStoredSource(source, metadata)) return null;
		return createStoredChunkProvider(store, source, metadata);
	}

	function registerStoredChunkProvider(source: any, metadata: any) {
		const provider = createStoredChunkProviderCandidate(source, metadata);
		if (!provider) return null;
		sourceChunkProviders.set(source.id, provider);
		// Project application is intentionally asynchronous. Publish the provider
		// immediately so cache eviction cannot create a transient unplayable source.
		engine.setChunkSources?.(sourceChunkProviders);
		return provider;
	}

	function forgetChunkProvider(sourceId: string) {
		if (!sourceChunkProviders.delete(sourceId)) return;
		engine.setChunkSources?.(sourceChunkProviders);
	}

	async function retireSourceChunkProvider(sourceId: string): Promise<void> {
		const failures: unknown[] = [];
		try { forgetChunkProvider(sourceId); }
		catch (error) { failures.push(error); }
		try { await sourceChunkProviders.drain?.(); }
		catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Source chunk provider retirement failed.');
		}
	}

	return Object.freeze({
		createStoredChunkProviderCandidate,
		forgetChunkProvider,
		registerStoredChunkProvider,
		retireSourceChunkProvider,
	});
}
