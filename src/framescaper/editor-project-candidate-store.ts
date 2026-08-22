/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OpfsRepository } from '../common/editor/storage/opfs-repository.ts';
import { assertEditorProjectStoreProfile } from '../common/editor/storage/project-store-profile-binding.ts';
import type { EditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createStorageRepositories,
	type StorageRepositories,
	type StorageRepositoryFactory,
} from '../common/editor/storage/repositories.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import type { ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore, createProjectStore } from '../common/editor/storage.js';

const AUTHORITY_FIELDS = Object.freeze([
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const);
const STORE_GENERATIONS = new WeakMap<AudioEditorProjectStore, object>();
const STORE_AUTHORITIES = new WeakMap<AudioEditorProjectStore, FramescaperCandidateProjectStoreAuthority>();

export interface FramescaperCandidateProjectStoreAuthority {
	readonly port: StorageRepositoryPort;
	readonly opfs: OpfsRepository | null;
}

export interface FramescaperCandidateProjectStoreOptions extends AudioEditorProjectStoreOptions {
	readonly store?: AudioEditorProjectStore;
}

export interface FramescaperCandidateProjectStoreDefinition {
	readonly generation: string;
	readonly token: object;
	readonly profile: unknown;
	readonly authenticate: (profile: unknown) => void;
	readonly storageProfile: EditorProjectStorageProfile;
	readonly repository: (
		profile: unknown,
		delegate: ProjectRepositoryPort,
	) => ProjectRepositoryPort;
}

/** Construct one isolated dormant candidate store from an exact generation definition. */
export function createFramescaperCandidateProjectStore(
	definition: FramescaperCandidateProjectStoreDefinition,
	optionsValue: FramescaperCandidateProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	definition.authenticate(definition.profile);
	const projectStorageProfile = snapshotAuthority(optionsValue, 'projectStorageProfile');
	const databaseName = snapshotAuthority(optionsValue, 'databaseName');
	const injectedStore = snapshotAuthority(optionsValue, 'store');
	if (projectStorageProfile.present && projectStorageProfile.value !== definition.storageProfile) {
		throw new TypeError(`The exact Framescaper ${definition.generation} storage profile is required.`);
	}
	if (databaseName.present) {
		throw new TypeError(`databaseName cannot bypass the ${definition.generation} storage profile.`);
	}
	if (injectedStore.present) {
		const store = injectedStore.value;
		if (!(store instanceof AudioEditorProjectStore)
			|| STORE_GENERATIONS.get(store) !== definition.token) {
			throw new TypeError(
				`Only a product-created Framescaper ${definition.generation} project store can be injected.`,
			);
		}
		assertEditorProjectStoreProfile(store, definition.storageProfile);
		return store;
	}
	if (snapshotAuthority(optionsValue, 'desktopProjectBridge').present) {
		throw new TypeError(
			`A generic desktop bridge cannot bypass the ${definition.generation} repository firewall.`,
		);
	}
	const repositoryFactory = snapshotAuthority(optionsValue, 'repositoryFactory');
	const delegateFactory = repositoryFactory.present
		? repositoryFactory.value : createStorageRepositories;
	if (typeof delegateFactory !== 'function') {
		throw new TypeError(`The ${definition.generation} repository factory must be a function.`);
	}
	let authority: FramescaperCandidateProjectStoreAuthority | null = null;
	const store = createProjectStore({
		...copyCreationOptions(optionsValue),
		projectStorageProfile: definition.storageProfile,
		repositoryFactory: candidateRepositoryFactory(
			definition,
			delegateFactory as StorageRepositoryFactory,
			(value) => { authority = value; },
		),
	});
	if (authority === null) {
		throw new Error(`${definition.generation} repository creation did not publish store authority.`);
	}
	STORE_GENERATIONS.set(store, definition.token);
	STORE_AUTHORITIES.set(store, authority);
	return store;
}

export function framescaperCandidateProjectStoreAuthority(
	definition: FramescaperCandidateProjectStoreDefinition,
	store: unknown,
): Readonly<FramescaperCandidateProjectStoreAuthority> {
	definition.authenticate(definition.profile);
	if (!(store instanceof AudioEditorProjectStore)
		|| STORE_GENERATIONS.get(store) !== definition.token
		|| !STORE_AUTHORITIES.has(store)) {
		throw new TypeError(`An exact Framescaper ${definition.generation} store authority is required.`);
	}
	return STORE_AUTHORITIES.get(store)!;
}

function candidateRepositoryFactory(
	definition: FramescaperCandidateProjectStoreDefinition,
	delegateFactory: StorageRepositoryFactory,
	recordAuthority: (authority: FramescaperCandidateProjectStoreAuthority) => void,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = delegateFactory(port, options);
		if (repositories === null || typeof repositories !== 'object') {
			throw new TypeError(`${definition.generation} repository factory returned an invalid set.`);
		}
		const composed = Object.freeze({
			...repositories,
			projects: definition.repository(definition.profile, repositories.projects),
		}) as StorageRepositories;
		recordAuthority(Object.freeze({ port, opfs: repositories.opfs ?? null }));
		return composed;
	};
}

function copyCreationOptions(value: unknown): AudioEditorProjectStoreOptions {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return {};
	const output: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError('Candidate store options cannot contain symbols.');
		if (AUTHORITY_FIELDS.includes(key as (typeof AUTHORITY_FIELDS)[number])) continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable) continue;
		if (!Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	return output as AudioEditorProjectStoreOptions;
}

function snapshotAuthority(
	value: unknown,
	field: (typeof AUTHORITY_FIELDS)[number],
): Readonly<{ present: boolean; value: unknown }> {
	const candidate = value !== null && (typeof value === 'object' || typeof value === 'function')
		? value : {};
	const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
	if (descriptor && !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${field} must be an own data property.`);
	}
	return Object.freeze({ present: descriptor !== undefined, value: descriptor?.value });
}
