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

/** Keep reproducible assistance caches behind the menu-owned assistance boundary. */
export function createDeferredAssistanceDerivativeRepository(
	portOrValues: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
	loadConstructor: AssistanceDerivativeRepositoryLoader = DEFAULT_LOADER,
	options: Readonly<AssistanceDerivativeRepositoryOptions> = {},
): AssistanceDerivativeRepositoryPort {
	let repositoryPromise: Promise<AssistanceDerivativeRepositoryPort> | null = null;
	const loadRepository = (): Promise<AssistanceDerivativeRepositoryPort> => {
		repositoryPromise ??= Promise.resolve()
			.then(loadConstructor)
			.then((Repository) => {
				if (typeof Repository !== 'function') {
					throw new TypeError('The assistance derivative repository implementation is unavailable.');
				}
				return new Repository(portOrValues, options);
			})
			.catch((error: unknown) => {
				repositoryPromise = null;
				throw error;
			});
		return repositoryPromise;
	};
	return Object.freeze({
		save: async (
			workflowValue: unknown,
			kindValue: unknown,
			payloadValue: AssistanceDerivativePayloadV1,
		): Promise<AssistanceDerivativeRecordV1> => {
			const repository = await loadRepository();
			return await repository.save(workflowValue, kindValue, payloadValue);
		},
		saveBatch: async (
			workflowValue: unknown,
			entriesValue: readonly AssistanceDerivativeBatchEntryV1[],
			guardValue?: AssistanceDerivativeBatchGuard,
		): Promise<readonly AssistanceDerivativeRecordV1[]> => {
			const repository = await loadRepository();
			return await repository.saveBatch(workflowValue, entriesValue, guardValue);
		},
		load: async (
			workflowValue: unknown,
			kindValue: unknown,
		): Promise<AssistanceDerivativeRecordV1 | null> => {
			const repository = await loadRepository();
			return await repository.load(workflowValue, kindValue);
		},
		listProject: async (
			projectIdValue: string,
			kindsValue?: readonly AssistanceDerivativeKind[],
		): Promise<readonly AssistanceDerivativeRecordV1[]> => {
			const repository = await loadRepository();
			return await repository.listProject(projectIdValue, kindsValue);
		},
		purgeProject: async (projectIdValue: string): Promise<number> => {
			const repository = await loadRepository();
			return await repository.purgeProject(projectIdValue);
		},
		purge: async (): Promise<number> => {
			const repository = await loadRepository();
			return await repository.purge();
		},
	});
}
