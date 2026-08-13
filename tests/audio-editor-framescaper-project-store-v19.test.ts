/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStoreProfile } from '../src/common/editor/storage/project-store-profile-binding.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import type {
	StorageRepositories,
	StorageRepositoryFactory,
} from '../src/common/editor/storage/repositories.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	FramescaperProjectRepositoryV19,
} from '../src/framescaper/editor-project-repository-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	createFramescaperProjectStoreV19,
	framescaperProjectStoreAuthorityV19,
} from '../src/framescaper/editor-project-store-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;
const FRAME_NAMES = Object.freeze({
	databaseName: 'kw-media-framescaper-editor-v19',
	opfsDirectoryName: 'framescaper-editor-v19-sources',
	opfsWorkerName: 'framescaper-editor-v19-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v19-lock:',
});

test('V19 store authenticates the exact runtime before observing options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => createFramescaperProjectStoreV19({}, options), /exact Framescaper V19/iu);
	assert.equal(reads, 0);
});

test('V19 store creates the isolated namespace behind its repository firewall', () => {
	let calls = 0;
	const repositoryFactory: StorageRepositoryFactory = () => {
		calls += 1;
		return repositoryFixture();
	};
	const store = createFramescaperProjectStoreV19(PROFILE, {
		indexedDB: null,
		repositoryFactory,
	});
	const storageProfile = editorProjectStoreProfile(store);
	assert.ok(storageProfile);
	assert.deepEqual(editorProjectStorageProfileNames(storageProfile), FRAME_NAMES);
	assert.equal(store.databaseName, FRAME_NAMES.databaseName);
	assert.ok(store.projectRepository instanceof FramescaperProjectRepositoryV19);
	assert.equal(calls, 1);

	const authority = framescaperProjectStoreAuthorityV19(PROFILE, store);
	assert.equal(Object.isFrozen(authority), true);
	assert.equal(authority.port.memory, store.memory);
	assert.equal(authority.opfs, store.opfsRepository);
	assert.deepEqual(Object.keys(authority).sort(), ['opfs', 'port']);
});

test('V19 store rejects every storage authority override or foreign injection', () => {
	const store = createFramescaperProjectStoreV19(PROFILE, {
		indexedDB: null,
		repositoryFactory: fixtureFactory(),
	});
	for (const [field, value] of [
		['projectStorageProfile', structuredClone(editorProjectStoreProfile(store))],
		['databaseName', FRAME_NAMES.databaseName],
		['desktopProjectBridge', {}],
	] as const) {
		assert.throws(
			() => createFramescaperProjectStoreV19(PROFILE, { [field]: value }),
			/exact.*storage profile|databaseName|repository firewall/iu,
		);
	}
	const foreign = createProjectStore({ indexedDB: null, repositoryFactory: fixtureFactory() });
	assert.throws(
		() => createFramescaperProjectStoreV19(PROFILE, { store: foreign }),
		/product-created.*V19 project store/iu,
	);
	assert.equal(createFramescaperProjectStoreV19(PROFILE, { store }), store);
	assert.throws(
		() => framescaperProjectStoreAuthorityV19(PROFILE, foreign),
		/product-created.*V19 store|store authority/iu,
	);
});

test('V19 store refuses authority accessors without invoking them', () => {
	for (const field of ['projectStorageProfile', 'store', 'repositoryFactory'] as const) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; return null; },
		});
		assert.throws(
			() => createFramescaperProjectStoreV19(PROFILE, options),
			/own data property/iu,
		);
		assert.equal(reads, 0);
	}
});

function fixtureFactory(): StorageRepositoryFactory {
	return () => repositoryFixture();
}

function repositoryFixture(): StorageRepositories {
	return {
		projects: {
			async createIfAbsent(project: unknown) { return project; },
			async createForScapeImportIfAbsent(project: unknown) { return project; },
			async save(project: unknown) { return project; },
			async saveIfCurrent(_expected: unknown, project: unknown) { return project; },
			async load() { return null; },
			async list() { return []; },
			async listRevisions() { return []; },
			async delete() {},
		},
		settings: {}, analysis: {}, sources: {}, media: {}, retention: {},
	} as unknown as StorageRepositories;
}
