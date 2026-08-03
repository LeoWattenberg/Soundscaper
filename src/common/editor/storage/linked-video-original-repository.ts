/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	legacyLinkedVideoOriginalBindingFromLinkedOriginal,
	type LinkedOriginalBinding,
} from './linked-original-binding.ts';
import {
	MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS,
	MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
	LinkedOriginalRepository,
	type LinkedOriginalLocatorReference,
	type LinkedOriginalRepositoryOptions,
} from './linked-original-repository.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import type {
	LinkedVideoOriginalBinding,
	LinkedVideoOriginalBindingInput,
} from './linked-video-original-binding.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export type { LinkedVideoOriginalBindingInput } from './linked-video-original-binding.ts';

type LinkedVideoOriginalRepositoryOptions = LinkedOriginalRepositoryOptions;

export interface LinkedVideoOriginalLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export const MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS = MAX_LINKED_ORIGINAL_INVENTORY_RECORDS;
export const MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES = MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES;
export const MAX_LINKED_VIDEO_ORIGINAL_CANONICAL_PROJECTS = MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS;

/** Schema-v1 linked-video facade over the discriminated linked-original repository. */
export class LinkedVideoOriginalRepository {
	readonly #repository: LinkedOriginalRepository;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalRepositoryOptions = {},
	) {
		this.#repository = new LinkedOriginalRepository(port, options);
	}

	async get(projectId: string, sourceId: string): Promise<LinkedVideoOriginalBinding | null> {
		return legacyVideoBinding(await this.#repository.get(projectId, sourceId));
	}

	async listLocatorReferences(): Promise<readonly LinkedVideoOriginalLocatorReference[]> {
		try {
			return videoLocatorReferences(await this.#repository.listVideoLocatorReferences());
		} catch (cause) {
			const detail = cause instanceof Error ? `: ${cause.message}` : '';
			throw new Error(`Linked video original binding inventory is invalid${detail}`, { cause });
		}
	}

	reconcileDurableLocatorReferences(
		canonicalProjectIds: readonly string[],
	): Promise<readonly LinkedVideoOriginalLocatorReference[] | null> {
		return this.#repository.reconcileDurableVideoLocatorReferences(canonicalProjectIds)
			.then((references) => references && videoLocatorReferences(references));
	}

	async putIfCurrent(
		value: LinkedVideoOriginalBindingInput,
		expectedBindingToken: string | null,
		assertCanPublish?: () => void,
	): Promise<LinkedVideoOriginalBinding | null> {
		return legacyVideoBinding(await this.#repository.putLegacyVideoIfCurrent(
			value,
			expectedBindingToken,
			assertCanPublish,
		));
	}

	deleteIfCurrent(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		return this.#repository.deleteIfCurrent(projectId, sourceId, expectedBindingToken);
	}
}

/** Validate one complete schema-v1 video inventory row against its primary key. */
export function validateLinkedVideoOriginalInventoryBinding(
	value: unknown,
	primaryKey: IDBValidKey,
): LinkedVideoOriginalBinding {
	return legacyLinkedVideoOriginalBindingFromLinkedOriginal(
		validateLinkedOriginalInventoryBinding(value, primaryKey),
	);
}

function legacyVideoBinding(
	binding: LinkedOriginalBinding | null,
): LinkedVideoOriginalBinding | null {
	return binding ? legacyLinkedVideoOriginalBindingFromLinkedOriginal(binding) : null;
}

function videoLocatorReferences(
	references: readonly LinkedOriginalLocatorReference[],
): readonly LinkedVideoOriginalLocatorReference[] {
	return Object.freeze(references
		.filter(({ kind }) => kind === 'video')
		.map(({ locatorId, locatorRevision }) => Object.freeze({ locatorId, locatorRevision })));
}
