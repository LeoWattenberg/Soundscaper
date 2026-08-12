/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from './key-value-repository.ts';
import {
	isTransientAnalysisCacheEntryNamespaceKey,
	type TransientAnalysisCacheRepository,
} from './transient-analysis-cache-repository.ts';
import { isTransientAnalysisCacheNamespaceKey } from './transient-analysis-cache.ts';

/** Keep generic analysis callers while applying lifecycle policy to one owned cache namespace. */
export class AnalysisCacheRoutingRepository {
	readonly #values: Pick<KeyValueRepository, 'put' | 'get' | 'delete'>;
	readonly #transients: Pick<TransientAnalysisCacheRepository, 'save' | 'load' | 'delete'>;

	constructor(
		values: Pick<KeyValueRepository, 'put' | 'get' | 'delete'>,
		transients: Pick<TransientAnalysisCacheRepository, 'save' | 'load' | 'delete'>,
	) {
		this.#values = values;
		this.#transients = transients;
	}

	put(key: string, value: unknown): Promise<unknown> {
		if (isTransientAnalysisCacheNamespaceKey(key)) return this.#transients.save(key, value);
		if (isTransientAnalysisCacheEntryNamespaceKey(key)) {
			return Promise.reject(new TypeError('Transient analysis cache lifecycle metadata is repository-owned.'));
		}
		return this.#values.put(key, value);
	}

	get(key: string): Promise<unknown> {
		if (isTransientAnalysisCacheNamespaceKey(key)) return this.#transients.load(key);
		if (isTransientAnalysisCacheEntryNamespaceKey(key)) return Promise.resolve(undefined);
		return this.#values.get(key);
	}

	delete(key: string): Promise<void> {
		if (isTransientAnalysisCacheNamespaceKey(key)) return this.#transients.delete(key);
		if (isTransientAnalysisCacheEntryNamespaceKey(key)) return Promise.resolve();
		return this.#values.delete(key);
	}
}
