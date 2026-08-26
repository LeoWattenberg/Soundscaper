/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy semantic-search projection kept outside the product-ready graph. */

import type { AssistanceSemanticSearchSessionPortV1 } from
	'../assistance/semantic-search-runtime-v1.ts';

const METHODS = Object.freeze(['open', 'authorize', 'revoke', 'query', 'cancelQuery'] as const);

export function lazyLocalAssistanceSemanticSearchBridge(
	value: unknown,
): AssistanceSemanticSearchSessionPortV1 | null {
	if (!isRecord(value) || Reflect.ownKeys(value).length !== METHODS.length
		|| METHODS.some((method) => typeof value[method] !== 'function')) return null;
	let loaded: Promise<AssistanceSemanticSearchSessionPortV1> | null = null;
	const resolve = (): Promise<AssistanceSemanticSearchSessionPortV1> => {
		loaded ??= import('./local-assistance-semantic-search-bridge.ts').then((module) => {
			const bridge = module.resolveLocalAssistanceSemanticSearchBridge(value);
			if (!bridge) throw new TypeError('The assistance semantic-search bridge is invalid.');
			return bridge;
		});
		return loaded;
	};
	return Object.freeze({
		open: async (...args: Parameters<AssistanceSemanticSearchSessionPortV1['open']>) => (
			(await resolve()).open(...args)
		),
		authorize: async (...args: Parameters<AssistanceSemanticSearchSessionPortV1['authorize']>) => (
			(await resolve()).authorize(...args)
		),
		revoke: async (...args: Parameters<AssistanceSemanticSearchSessionPortV1['revoke']>) => (
			(await resolve()).revoke(...args)
		),
		embedInstalledQuery: async (...args: Parameters<
			AssistanceSemanticSearchSessionPortV1['embedInstalledQuery']
		>) => (await resolve()).embedInstalledQuery(...args),
	});
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& !ArrayBuffer.isView(value) && Object.getPrototypeOf(value) === Object.prototype);
}
