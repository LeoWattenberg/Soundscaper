/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-triggered semantic-search composition kept outside product startup chunks. */

import type { AssistanceSemanticSearchMenuSourceV1 } from
	'../assistance/semantic-search-runtime-v1.ts';
import type { AssistanceDerivativeRepositoryPort } from
	'../storage/deferred-assistance-derivative-repository.ts';

export interface LocalAssistanceLazySemanticSearchSourceOptionsV1 {
	readonly bridgeScope: unknown;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'listProject'> | null;
}

export function createLocalAssistanceLazySemanticSearchSourceV1(
	options: LocalAssistanceLazySemanticSearchSourceOptionsV1,
): AssistanceSemanticSearchMenuSourceV1 {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Reflect.ownKeys(options).length !== 2
		|| !Object.hasOwn(options, 'bridgeScope') || !Object.hasOwn(options, 'repository')) {
		throw new TypeError('Lazy semantic-search source options are invalid.');
	}
	let loaded: Promise<AssistanceSemanticSearchMenuSourceV1> | null = null;
	const resolve = (): Promise<AssistanceSemanticSearchMenuSourceV1> => {
		loaded ??= import('./local-assistance-semantic-search-source.ts').then((module) => (
			module.createLocalAssistanceSemanticSearchSourceV1(options)
		));
		return loaded;
	};
	return Object.freeze({ open: async (...args: Parameters<
		AssistanceSemanticSearchMenuSourceV1['open']
	>) => (await resolve()).open(...args) });
}
