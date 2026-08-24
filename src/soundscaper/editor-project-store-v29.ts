/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts'
import type { OpfsRepository } from '../common/editor/storage/opfs-repository.ts'
import { LinkedOriginalProjectReachabilityRepository } from '../common/editor/storage/linked-original-project-reachability-repository.ts'
import { LinkedOriginalStartupReconciliationRepository } from '../common/editor/storage/linked-original-startup-reconciliation-repository.ts'
import {
	createStorageRepositories,
	type StorageRepositories,
	type StorageRepositoryFactory,
} from '../common/editor/storage/repositories.ts'
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts'
import { createProjectStore, type AudioEditorProjectStore } from '../common/editor/storage.js'
import { SoundscaperProjectRepositoryV29 } from './editor-project-repository-v29.ts'
import { assertSoundscaperProjectV29Profile } from './editor-project-v29-profile.ts'
import { validateSoundscaperProjectV29 } from './editor-project-v29-validation.ts'
import { SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v29.ts'

const AUTHORITY_FIELDS = new Set([
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
])
const PRODUCT_CREATED_STORES = new WeakSet<AudioEditorProjectStore>()
const PRODUCT_STORE_AUTHORITIES = new WeakMap<AudioEditorProjectStore, SoundscaperProjectStoreAuthorityV29>()

export interface SoundscaperProjectStoreAuthorityV29 {
	readonly port: StorageRepositoryPort
	readonly opfs: OpfsRepository | null
}

/** Construct the isolated selected store with exact V29 validation on every project operation. */
export function createSoundscaperProjectStoreV29(
	optionsValue: AudioEditorProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	const options = copyCreationOptions(optionsValue)
	let authority: SoundscaperProjectStoreAuthorityV29 | null = null
	const store = createProjectStore({
		...options,
		projectStorageProfile: SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
		repositoryFactory: soundscaperRepositoryFactoryV29(
			createStorageRepositories,
			(value) => { authority = value },
		),
	})
	if (authority === null) throw new Error('The V29 repository factory did not publish its store authority.')
	PRODUCT_CREATED_STORES.add(store)
	PRODUCT_STORE_AUTHORITIES.set(store, authority)
	return store
}

/** Resolve backend identities only for the exact selected product-created store. */
export function soundscaperProjectStoreAuthorityV29(
	profile: unknown,
	store: unknown,
): Readonly<SoundscaperProjectStoreAuthorityV29> {
	assertSoundscaperProjectV29Profile(profile)
	if (!PRODUCT_CREATED_STORES.has(store as AudioEditorProjectStore)) {
		throw new TypeError('A product-created Soundscaper V29 store authority is required.')
	}
	return PRODUCT_STORE_AUTHORITIES.get(store as AudioEditorProjectStore)!
}

function soundscaperRepositoryFactoryV29(
	delegateFactory: StorageRepositoryFactory,
	recordAuthority: (authority: Readonly<SoundscaperProjectStoreAuthorityV29>) => void,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = delegateFactory(port, options)
		recordAuthority(Object.freeze({ port, opfs: repositories.opfs ?? null }))
		return Object.freeze({
			...repositories,
			projects: new SoundscaperProjectRepositoryV29(repositories.projects),
			linkedOriginalProjectReachability: new LinkedOriginalProjectReachabilityRepository(port, {
				validateProject: validateSoundscaperProjectV29,
			}),
			linkedOriginalStartupReconciliation: new LinkedOriginalStartupReconciliationRepository(port, {
				validateProject: validateSoundscaperProjectV29,
			}),
		}) as StorageRepositories
	}
}

function copyCreationOptions(value: unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V29 store options must be a plain record.')
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper V29 store options must be a plain record.')
	}
	const output: Record<string, unknown> = {}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError('Soundscaper V29 store options cannot contain symbols.')
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper V29 store option ${key} must be an own data property.`)
		}
		if (AUTHORITY_FIELDS.has(key)) {
			throw new TypeError(`The selected V29 store rejects the ${key} authority override.`)
		}
		output[key] = descriptor.value
	}
	return output as AudioEditorProjectStoreOptions
}
