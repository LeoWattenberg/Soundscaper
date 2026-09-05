/* SPDX-License-Identifier: AGPL-3.0-only */

/** Desktop-only semantic-search composition over renderer custody and main authority. */

import {
	AssistanceSemanticSearchUnavailableError,
	createAssistanceSemanticSearchMenuSourceV1,
	type AssistanceSemanticSearchMenuSourceV1,
} from '../assistance/semantic-search-runtime-v1.ts';
import { createLocalAssistanceSemanticIndexCustodyV1 } from
	'../controller/local-assistance-semantic-index-custody.ts';
import type { AssistanceDerivativeRepositoryPort } from
	'../storage/deferred-assistance-derivative-repository.ts';
import { resolveLocalAssistanceBridge } from '../assistance/local-assistance-bridge.ts';

export function createLocalAssistanceSemanticSearchSourceV1(options: Readonly<{
	readonly bridgeScope: unknown;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'listProject'> | null;
}>): AssistanceSemanticSearchMenuSourceV1 {
	const bridge = resolveLocalAssistanceBridge(options?.bridgeScope);
	if (!bridge?.semanticSearch) return unavailable('desktop-unavailable',
		'Indexed search is available only through an authenticated desktop bridge.');
	if (!options.repository) return unavailable('index-unavailable',
		'Indexed search is unavailable until disposable project custody is available.');
	return createAssistanceSemanticSearchMenuSourceV1({
		sessions: bridge.semanticSearch,
		custody: createLocalAssistanceSemanticIndexCustodyV1(options.repository),
	});
}

function unavailable(
	reason: 'desktop-unavailable' | 'index-unavailable',
	message: string,
): AssistanceSemanticSearchMenuSourceV1 {
	return Object.freeze({ async open() {
		throw new AssistanceSemanticSearchUnavailableError(reason, message);
	} });
}
