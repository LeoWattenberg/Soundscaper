/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SourceChunkProviderRegistryPort<Key, Provider> extends Map<Key, Provider> {
	drain?(): PromiseLike<void> | void;
}

export interface SourceChunkProviderRegistrationSource {
	readonly id: string;
}

export interface SourceChunkProviderRegistrationEngine<Provider> {
	setChunkSources?(providers: ReadonlyMap<string, Provider>): unknown;
}

export interface SourceChunkProviderRegistrationRuntime<
	Source extends SourceChunkProviderRegistrationSource = SourceChunkProviderRegistrationSource,
	Metadata = unknown,
	RegistryProvider = unknown,
	Provider extends RegistryProvider = RegistryProvider,
> {
	/** Validate the stored record and build its provider, or reject it as non-streamable. */
	readonly createStoredChunkProviderCandidate: (source: Source, metadata: Metadata) => Provider | null;
	readonly engine: SourceChunkProviderRegistrationEngine<RegistryProvider>;
	readonly sourceChunkProviders: SourceChunkProviderRegistryPort<string, RegistryProvider>;
}

/** Own the registry side of stored chunk providers: candidacy, publication, retirement. */
export function createSourceChunkProviderRegistration<
	Source extends SourceChunkProviderRegistrationSource,
	Metadata,
	RegistryProvider,
	Provider extends RegistryProvider,
>(
	runtime: SourceChunkProviderRegistrationRuntime<Source, Metadata, RegistryProvider, Provider>,
) {
	const {
		createStoredChunkProviderCandidate: buildStoredChunkProviderCandidate,
		engine,
		sourceChunkProviders,
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
	function createStoredChunkProviderCandidate(source: Source, metadata: Metadata): Provider | null {
		return buildStoredChunkProviderCandidate(source, metadata);
	}

	function registerStoredChunkProvider(source: Source, metadata: Metadata): Provider | null {
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
