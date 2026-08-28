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
import { SoundscaperProjectRepository } from './editor-project-repository.ts'
import { assertSoundscaperProjectProfile } from './editor-project-profile.ts'
import { validateSoundscaperProject } from './editor-project-validation.ts'
import { SOUNDSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts'

const AUTHORITY_FIELDS = new Set([
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
])
const PRODUCT_CREATED_STORES = new WeakSet<AudioEditorProjectStore>()
const PRODUCT_STORE_AUTHORITIES = new WeakMap<AudioEditorProjectStore, SoundscaperProjectStoreAuthority>()

export interface SoundscaperProjectStoreAuthority {
	readonly port: StorageRepositoryPort
	readonly opfs: OpfsRepository | null
}

/** Construct the isolated selected store with exact V30 validation on every project operation. */
export function createSoundscaperProjectStore(
	optionsValue: AudioEditorProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	const options = copyCreationOptions(optionsValue)
	let authority: SoundscaperProjectStoreAuthority | null = null
	const store = createProjectStore({
		...options,
		projectStorageProfile: SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
		repositoryFactory: soundscaperRepositoryFactory(
			createStorageRepositories,
			(value) => { authority = value },
		),
	})
	if (authority === null) throw new Error('The baseline repository factory did not publish its store authority.')
	PRODUCT_CREATED_STORES.add(store)
	PRODUCT_STORE_AUTHORITIES.set(store, authority)
	return store
}

/** Resolve backend identities only for the exact selected product-created store. */
export function soundscaperProjectStoreAuthority(
	profile: unknown,
	store: unknown,
): Readonly<SoundscaperProjectStoreAuthority> {
	assertSoundscaperProjectProfile(profile)
	if (!PRODUCT_CREATED_STORES.has(store as AudioEditorProjectStore)) {
		throw new TypeError('A product-created Soundscaper baseline store authority is required.')
	}
	return PRODUCT_STORE_AUTHORITIES.get(store as AudioEditorProjectStore)!
}

function soundscaperRepositoryFactory(
	delegateFactory: StorageRepositoryFactory,
	recordAuthority: (authority: Readonly<SoundscaperProjectStoreAuthority>) => void,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = delegateFactory(port, options)
		recordAuthority(Object.freeze({ port, opfs: repositories.opfs ?? null }))
		return Object.freeze({
			...repositories,
			projects: new SoundscaperProjectRepository(repositories.projects),
			linkedOriginalProjectReachability: new LinkedOriginalProjectReachabilityRepository(port, {
				validateProject: validateSoundscaperProject,
			}),
			linkedOriginalStartupReconciliation: new LinkedOriginalStartupReconciliationRepository(port, {
				validateProject: validateSoundscaperProject,
			}),
		}) as StorageRepositories
	}
}

function copyCreationOptions(value: unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper baseline store options must be a plain record.')
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper baseline store options must be a plain record.')
	}
	const output: Record<string, unknown> = {}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError('Soundscaper baseline store options cannot contain symbols.')
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper baseline store option ${key} must be an own data property.`)
		}
		if (AUTHORITY_FIELDS.has(key)) {
			throw new TypeError(`The baseline store rejects the ${key} authority override.`)
		}
		output[key] = descriptor.value
	}
	return output as AudioEditorProjectStoreOptions
}
