/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OpfsRepository } from '../common/editor/storage/opfs-repository.ts';
import { assertEditorProjectStoreProfile } from '../common/editor/storage/project-store-profile-binding.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createStorageRepositories,
	type StorageRepositories,
	type StorageRepositoryFactory,
} from '../common/editor/storage/repositories.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import { AudioEditorProjectStore, createProjectStore } from '../common/editor/storage.js';
import { FramescaperProjectRepositoryV20 } from './editor-project-repository-v20.ts';
import { FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v20.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';

const AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;
const PRODUCT_CREATED_STORES = new WeakSet<AudioEditorProjectStore>();
const PRODUCT_STORE_AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperProjectStoreAuthorityV20>();

export interface FramescaperProjectStoreAuthorityV20 {
	readonly port: StorageRepositoryPort;
	readonly opfs: OpfsRepository | null;
}

export interface FramescaperProjectStoreV20Options extends AudioEditorProjectStoreOptions {
	readonly store?: AudioEditorProjectStore;
}

/** Construct the isolated selected V20 store. */
export function createFramescaperProjectStoreV20(
	profile: FramescaperProjectV20Profile | unknown,
	options: FramescaperProjectStoreV20Options | unknown = {},
): AudioEditorProjectStore {
	assertFramescaperProjectV20Profile(profile);
	const projectStorageProfile = snapshotAuthority(options, 'projectStorageProfile');
	const databaseName = snapshotAuthority(options, 'databaseName');
	const injectedStore = snapshotAuthority(options, 'store');
	if (projectStorageProfile.present
		&& projectStorageProfile.value !== FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE) {
		throw new TypeError('The exact Framescaper V20 project storage profile is required.');
	}
	if (databaseName.present) {
		throw new TypeError('databaseName cannot be combined with the Framescaper V20 storage profile.');
	}
	if (injectedStore.present) {
		const store = injectedStore.value;
		if ((typeof store !== 'object' && typeof store !== 'function')
			|| store === null || !PRODUCT_CREATED_STORES.has(store as AudioEditorProjectStore)) {
			throw new TypeError('Only a product-created Framescaper V20 project store can be injected.');
		}
		assertEditorProjectStoreProfile(store, FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE);
		return store as AudioEditorProjectStore;
	}
	const desktopProjectBridge = snapshotAuthority(options, 'desktopProjectBridge');
	if (desktopProjectBridge.present) {
		throw new TypeError('A generic desktop project bridge cannot bypass the Framescaper V20 repository firewall.');
	}
	const repositoryFactory = snapshotAuthority(options, 'repositoryFactory');
	const delegateFactory = repositoryFactory.present ? repositoryFactory.value : createStorageRepositories;
	if (typeof delegateFactory !== 'function') {
		throw new TypeError('The V20 storage repository factory must be a function.');
	}
	let createdAuthority: FramescaperProjectStoreAuthorityV20 | null = null;
	const store = createProjectStore({
		...copyCreationOptions(options),
		projectStorageProfile: FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE,
		repositoryFactory: framescaperRepositoryFactory(
			profile,
			delegateFactory as StorageRepositoryFactory,
			(authority) => { createdAuthority = authority; },
		),
	});
	if (createdAuthority === null) {
		throw new Error('The V20 repository factory did not publish its exact store authority.');
	}
	PRODUCT_CREATED_STORES.add(store);
	PRODUCT_STORE_AUTHORITIES.set(store, createdAuthority);
	return store;
}

export function framescaperProjectStoreAuthorityV20(
	profile: FramescaperProjectV20Profile | unknown,
	store: unknown,
): Readonly<FramescaperProjectStoreAuthorityV20> {
	assertFramescaperProjectV20Profile(profile);
	if (!PRODUCT_STORE_AUTHORITIES.has(store as AudioEditorProjectStore)) {
		throw new TypeError('A product-created Framescaper V20 store authority is required.');
	}
	return PRODUCT_STORE_AUTHORITIES.get(store as AudioEditorProjectStore)!;
}

function framescaperRepositoryFactory(
	profile: FramescaperProjectV20Profile,
	delegateFactory: StorageRepositoryFactory,
	recordAuthority: (authority: Readonly<FramescaperProjectStoreAuthorityV20>) => void,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = delegateFactory(port, options);
		if (repositories === null || typeof repositories !== 'object') {
			throw new TypeError('The V20 storage repository factory returned an invalid repository set.');
		}
		const composed = Object.freeze({
			...repositories,
			projects: new FramescaperProjectRepositoryV20(profile, repositories.projects),
		}) as StorageRepositories;
		recordAuthority(Object.freeze({ port, opfs: repositories.opfs ?? null }));
		return composed;
	};
}

function copyCreationOptions(value: unknown): AudioEditorProjectStoreOptions {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return {};
	const output: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError('V20 store options cannot contain symbol properties.');
		if (AUTHORITY_FIELDS.includes(key as (typeof AUTHORITY_FIELDS)[number])) continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable) continue;
		if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be an own data property.`);
		output[key] = descriptor.value;
	}
	return output as AudioEditorProjectStoreOptions;
}

interface AuthorityValue {
	readonly present: boolean;
	readonly value: unknown;
}

function snapshotAuthority(
	value: unknown,
	field: (typeof AUTHORITY_FIELDS)[number],
): AuthorityValue {
	const candidate = value !== null && (typeof value === 'object' || typeof value === 'function')
		? value
		: {};
	const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
	if (descriptor && !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${field} must be an own data property.`);
	}
	return Object.freeze({ present: descriptor !== undefined, value: descriptor?.value });
}
