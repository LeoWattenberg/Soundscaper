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
	FramescaperProjectRepositoryV20,
} from '../src/framescaper/editor-project-repository-v20.ts';
import {
	createFramescaperProjectStoreV20,
	framescaperProjectStoreAuthorityV20,
} from '../src/framescaper/editor-project-store-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const FRAME_NAMES = Object.freeze({
	databaseName: 'kw-media-framescaper-editor-v20',
	opfsDirectoryName: 'framescaper-editor-v20-sources',
	opfsWorkerName: 'framescaper-editor-v20-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v20-lock:',
});

test('V20 store authenticates model authority before observing options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(() => createFramescaperProjectStoreV20({}, options), /exact Framescaper V20/iu);
	assert.equal(reads, 0);
});

test('V20 store binds a fresh namespace behind the V20 repository firewall', () => {
	let calls = 0;
	const repositoryFactory: StorageRepositoryFactory = () => {
		calls += 1;
		return repositoryFixture();
	};
	const store = createFramescaperProjectStoreV20(PROFILE, { indexedDB: null, repositoryFactory });
	const storageProfile = editorProjectStoreProfile(store);
	assert.ok(storageProfile);
	assert.deepEqual(editorProjectStorageProfileNames(storageProfile), FRAME_NAMES);
	assert.equal(store.databaseName, FRAME_NAMES.databaseName);
	assert.ok(store.projectRepository instanceof FramescaperProjectRepositoryV20);
	assert.equal(calls, 1);

	const authority = framescaperProjectStoreAuthorityV20(PROFILE, store);
	assert.equal(Object.isFrozen(authority), true);
	assert.equal(authority.port.memory, store.memory);
	assert.equal(authority.opfs, store.opfsRepository);
	assert.deepEqual(Object.keys(authority).sort(), ['opfs', 'port']);
});

test('V20 store rejects every storage override and foreign store injection', () => {
	const store = createFramescaperProjectStoreV20(PROFILE, {
		indexedDB: null,
		repositoryFactory: fixtureFactory(),
	});
	for (const [field, value] of [
		['projectStorageProfile', structuredClone(editorProjectStoreProfile(store))],
		['databaseName', FRAME_NAMES.databaseName],
		['desktopProjectBridge', {}],
	] as const) {
		assert.throws(
			() => createFramescaperProjectStoreV20(PROFILE, { [field]: value }),
			/exact.*storage profile|databaseName|repository firewall/iu,
		);
	}
	const foreign = createProjectStore({ indexedDB: null, repositoryFactory: fixtureFactory() });
	assert.throws(
		() => createFramescaperProjectStoreV20(PROFILE, { store: foreign }),
		/product-created.*V20 project store/iu,
	);
	assert.equal(createFramescaperProjectStoreV20(PROFILE, { store }), store);
	assert.throws(
		() => framescaperProjectStoreAuthorityV20(PROFILE, foreign),
		/product-created.*V20 store|store authority/iu,
	);
});

test('V20 store rejects authority accessors without invocation', () => {
	for (const field of ['projectStorageProfile', 'store', 'repositoryFactory'] as const) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; return null; },
		});
		assert.throws(() => createFramescaperProjectStoreV20(PROFILE, options), /own data property/iu);
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
