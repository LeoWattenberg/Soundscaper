/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AssistanceDerivativeBatchEntryV1,
	AssistanceDerivativeBatchGuard,
	AssistanceDerivativeKind,
	AssistanceDerivativeKeyValuePort,
	AssistanceDerivativePayloadV1,
	AssistanceDerivativeRecordV1,
	AssistanceDerivativeRepositoryOptions,
} from './assistance-derivative-repository.ts';
import { createDeferredModuleFacade } from '../controller/deferred-module-facade.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface AssistanceDerivativeRepositoryPort {
	save(
		workflowValue: unknown,
		kindValue: unknown,
		payloadValue: AssistanceDerivativePayloadV1,
	): Promise<AssistanceDerivativeRecordV1>;
	saveBatch(
		workflowValue: unknown,
		entriesValue: readonly AssistanceDerivativeBatchEntryV1[],
		guardValue?: AssistanceDerivativeBatchGuard,
	): Promise<readonly AssistanceDerivativeRecordV1[]>;
	load(workflowValue: unknown, kindValue: unknown): Promise<AssistanceDerivativeRecordV1 | null>;
	listProject(
		projectIdValue: string,
		kindsValue?: readonly AssistanceDerivativeKind[],
	): Promise<readonly AssistanceDerivativeRecordV1[]>;
	purgeProject(projectIdValue: string): Promise<number>;
	purge(): Promise<number>;
}

export interface AssistanceDerivativeRepositoryConstructor {
	new (
		portOrValues: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
		options?: Readonly<AssistanceDerivativeRepositoryOptions>,
	): AssistanceDerivativeRepositoryPort;
}

export type AssistanceDerivativeRepositoryLoader = () => Promise<
	AssistanceDerivativeRepositoryConstructor
>;

const DEFAULT_LOADER: AssistanceDerivativeRepositoryLoader = () => (
	import('./assistance-derivative-repository.ts')
		.then((module) => module.AssistanceDerivativeRepository)
);

const DEFERRED_ASSISTANCE_DERIVATIVE_METHOD_NAMES = [
	'save',
	'saveBatch',
	'load',
	'listProject',
	'purgeProject',
	'purge',
] as const satisfies readonly (keyof AssistanceDerivativeRepositoryPort)[];

/** Keep reproducible assistance caches behind the menu-owned assistance boundary. */
export function createDeferredAssistanceDerivativeRepository(
	portOrValues: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
	loadConstructor: AssistanceDerivativeRepositoryLoader = DEFAULT_LOADER,
	options: Readonly<AssistanceDerivativeRepositoryOptions> = {},
): AssistanceDerivativeRepositoryPort {
	return createDeferredModuleFacade(
		async (): Promise<AssistanceDerivativeRepositoryPort> => {
			const Repository = await loadConstructor();
			if (typeof Repository !== 'function') {
				throw new TypeError('The assistance derivative repository implementation is unavailable.');
			}
			return new Repository(portOrValues, options);
		},
		DEFERRED_ASSISTANCE_DERIVATIVE_METHOD_NAMES,
	);
}
