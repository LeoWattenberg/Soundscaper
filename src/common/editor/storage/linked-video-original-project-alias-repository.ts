/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	legacyLinkedVideoOriginalBindingFromLinkedOriginal,
	type LinkedOriginalBinding,
} from './linked-original-binding.ts';
import {
	LinkedOriginalProjectAliasRepository,
	type LinkedOriginalProjectAliasRepositoryOptions,
} from './linked-original-project-alias-repository.ts';
import type { LinkedVideoOriginalBinding } from './linked-video-original-binding.ts';
import type { LinkedVideoOriginalSource } from './linked-video-original-resolver.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

type LinkedVideoOriginalProjectAliasRepositoryOptions = Omit<
	LinkedOriginalProjectAliasRepositoryOptions,
	'managedKinds'
>;

/** Schema-v1 video-only facade over exact kindful project aliases. */
export class LinkedVideoOriginalProjectAliasRepository {
	readonly #repository: LinkedOriginalProjectAliasRepository;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalProjectAliasRepositoryOptions = {},
	) {
		this.#repository = new LinkedOriginalProjectAliasRepository(port, {
			...options,
			managedKinds: ['video'],
		});
	}

	async copyReachableAliases(
		sourceProjectId: string,
		destinationProjectId: string,
		sources: readonly LinkedVideoOriginalSource[],
	): Promise<readonly LinkedVideoOriginalBinding[]> {
		return Object.freeze((await this.#repository.copyReachableAliases(
			sourceProjectId,
			destinationProjectId,
			sources,
		)).map(legacyLinkedVideoOriginalBindingFromLinkedOriginal));
	}

	rollbackAliases(aliases: readonly LinkedVideoOriginalBinding[]): Promise<void> {
		return this.#repository.rollbackAliases(aliases as unknown as readonly LinkedOriginalBinding[]);
	}
}
