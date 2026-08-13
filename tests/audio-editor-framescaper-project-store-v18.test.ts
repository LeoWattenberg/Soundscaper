/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertEditorProjectStoreProfile,
	bindEditorProjectStoreProfile,
	editorProjectStoreProfile,
} from '../src/common/editor/storage/project-store-profile-binding.ts';
import * as bindingModule from '../src/common/editor/storage/project-store-profile-binding.ts';
import {
	createEditorProjectStorageProfile,
	editorProjectStorageProfileNames,
	type EditorProjectStorageProfile,
} from '../src/common/editor/storage/project-storage-profile.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createFramescaperProjectStoreV18,
} from '../src/framescaper/editor-project-store-v18.ts';
import * as framescaperStoreModule from '../src/framescaper/editor-project-store-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type {
	StorageRepositories,
	StorageRepositoryFactory,
} from '../src/common/editor/storage/repositories.ts';

const FRAME_NAMES = Object.freeze({
	databaseName: 'kw-media-framescaper-editor-v18',
	opfsDirectoryName: 'framescaper-editor-v18-sources',
	opfsWorkerName: 'framescaper-editor-v18-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v18-lock:',
});

test('owns one generic opaque binding boundary and one dormant product factory', () => {
	assert.deepEqual(Object.keys(bindingModule).sort(), [
		'assertEditorProjectStoreProfile',
		'bindEditorProjectStoreProfile',
		'editorProjectStoreProfile',
	]);
	assert.deepEqual(Object.keys(framescaperStoreModule), [
		'createFramescaperProjectStoreV18',
	]);
});

test('binds exact profiles out of band without changing legacy store objects', () => {
	const factory = fixtureFactory();
	const omitted = createProjectStore({ indexedDB: null, repositoryFactory: factory });
	const explicit = createProjectStore({
		indexedDB: null,
		projectStorageProfile: undefined,
		repositoryFactory: factory,
	});
	const alternate = storageProfile('alternate');
	const profiled = createProjectStore({
		indexedDB: null,
		projectStorageProfile: alternate,
		repositoryFactory: factory,
	});

	assert.equal(editorProjectStoreProfile(omitted), undefined);
	assert.equal(editorProjectStoreProfile(explicit), undefined);
	assert.equal(editorProjectStoreProfile(profiled), alternate);
	assert.deepEqual(Reflect.ownKeys(omitted), Reflect.ownKeys(explicit));
	assert.equal(Reflect.ownKeys(profiled).some((key) => typeof key === 'symbol'), false);
	assert.doesNotThrow(() => assertEditorProjectStoreProfile(profiled, alternate));
	assert.throws(
		() => assertEditorProjectStoreProfile(omitted, alternate),
		/exact.*storage profile|bound.*profile/iu,
	);
	assert.throws(() => editorProjectStoreProfile({}), /authentic.*project store/iu);
});

test('generic binding authenticates the profile first and permanently refuses rebinding', () => {
	const first = storageProfile('first');
	const second = storageProfile('second');
	const store = createProjectStore({
		indexedDB: null,
		projectStorageProfile: first,
		repositoryFactory: fixtureFactory(),
	});
	assert.doesNotThrow(() => bindEditorProjectStoreProfile(store, first));
	assert.throws(() => bindEditorProjectStoreProfile(store, second), /rebind|already.*profile/iu);
	assert.equal(editorProjectStoreProfile(store), first);

	const hostileStore = zeroTrapProxy(store);
	const clonedProfile = structuredClone(first);
	assert.throws(
		() => assertEditorProjectStoreProfile(hostileStore.proxy, clonedProfile),
		/authentic.*storage profile/iu,
	);
	assert.deepEqual(hostileStore.hits, [0, 0, 0, 0]);
	assert.throws(
		() => editorProjectStoreProfile(hostileStore.proxy),
		/authentic.*project store/iu,
	);
	assert.deepEqual(hostileStore.hits, [0, 0, 0, 0]);
});

test('generic store admission binds before repository construction and candidate getters', () => {
	let sideEffects = 0;
	const options = { projectStorageProfile: structuredClone(storageProfile('clone')) };
	Object.defineProperties(options, {
		indexedDB: { enumerable: true, get() { sideEffects += 1; throw new Error('indexedDB get'); } },
		repositoryFactory: { enumerable: true, get() { sideEffects += 1; throw new Error('factory get'); } },
	});
	assert.throws(() => createProjectStore(options), /authentic.*storage profile/iu);
	assert.equal(sideEffects, 0);
});

test('product factory authenticates the exact runtime before observing options or stores', () => {
	for (const candidate of [
		{},
		structuredClone(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE),
	]) {
		const runtime = zeroTrapProxy(candidate);
		const options = zeroTrapProxy({});
		assert.throws(
			() => createFramescaperProjectStoreV18(runtime.proxy, options.proxy),
			/exact.*Framescaper V18 runtime profile/iu,
		);
		assert.deepEqual(runtime.hits, [0, 0, 0, 0]);
		assert.deepEqual(options.hits, [0, 0, 0, 0]);
	}
});

test('product factory rejects every explicit storage or database mismatch before side effects', () => {
	const exactStore = createFramescaperProjectStoreV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ indexedDB: null, repositoryFactory: fixtureFactory() },
	);
	for (const projectStorageProfile of [
		{},
		structuredClone(editorProjectStoreProfile(exactStore)),
		storageProfile('other-authentic'),
	]) {
		const probe = hostileCreationOptions({ projectStorageProfile });
		assert.throws(
			() => createFramescaperProjectStoreV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				probe.options,
			),
			/exact.*storage profile/iu,
		);
		assert.equal(probe.sideEffects(), 0);
	}
	for (const databaseName of [undefined, FRAME_NAMES.databaseName, 'split-database']) {
		const probe = hostileCreationOptions({ databaseName });
		assert.throws(
			() => createFramescaperProjectStoreV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				probe.options,
			),
			/databaseName.*storage profile|storage profile.*databaseName/iu,
		);
		assert.equal(probe.sideEffects(), 0);
	}
});

test('product factory rejects accessor authorities without invoking them', () => {
	for (const field of ['projectStorageProfile', 'store'] as const) {
		let getterCalls = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { getterCalls += 1; return null; },
		});
		assert.throws(
			() => createFramescaperProjectStoreV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				options,
			),
			/own data property/iu,
		);
		assert.equal(getterCalls, 0);
	}
});

test('product factory creates the exact isolated store and authenticates injection', () => {
	let repositoryCalls = 0;
	let repositoryOptions: Record<string, unknown> | null = null;
	const repositoryFactory: StorageRepositoryFactory = (_port, options) => {
		repositoryCalls += 1;
		repositoryOptions = options as unknown as Record<string, unknown>;
		return repositoryFixture();
	};
	const store = createFramescaperProjectStoreV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{ indexedDB: null, repositoryFactory },
	);
	const storageProfile = editorProjectStoreProfile(store);
	assert.ok(storageProfile);
	assert.deepEqual(editorProjectStorageProfileNames(storageProfile), FRAME_NAMES);
	assert.equal(store.databaseName, FRAME_NAMES.databaseName);
	assert.equal(repositoryCalls, 1);
	assert.deepEqual({
		opfsDirectoryName: repositoryOptions?.opfsDirectoryName,
		opfsWorkerName: repositoryOptions?.opfsWorkerName,
	}, {
		opfsDirectoryName: FRAME_NAMES.opfsDirectoryName,
		opfsWorkerName: FRAME_NAMES.opfsWorkerName,
	});

	let ignoredGets = 0;
	const injection = { store } as Record<string, unknown>;
	Object.defineProperties(injection, {
		indexedDB: { enumerable: true, get() { ignoredGets += 1; throw new Error('indexedDB get'); } },
		repositoryFactory: { enumerable: true, get() { ignoredGets += 1; throw new Error('factory get'); } },
	});
	assert.equal(createFramescaperProjectStoreV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		injection,
	), store);
	assert.equal(ignoredGets, 0);
});

test('product store injection accepts only the exact out-of-band binding without traps', () => {
	for (const store of [
		{},
		createProjectStore({ indexedDB: null, repositoryFactory: fixtureFactory() }),
		createProjectStore({
			indexedDB: null,
			projectStorageProfile: storageProfile('alternate-store'),
			repositoryFactory: fixtureFactory(),
		}),
		createFramescaperProjectStoreV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			{ indexedDB: null, repositoryFactory: fixtureFactory() },
		),
	]) {
		const hostileStore = zeroTrapProxy(store);
		const probe = hostileCreationOptions({ store: hostileStore.proxy });
		assert.throws(
			() => createFramescaperProjectStoreV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				probe.options,
			),
			/authentic.*project store|exact.*storage profile|bound.*profile/iu,
		);
		assert.deepEqual(hostileStore.hits, [0, 0, 0, 0]);
		assert.equal(probe.sideEffects(), 0);
	}
});

function hostileCreationOptions(
	authority: Readonly<Record<string, unknown>>,
): { readonly options: Record<string, unknown>; readonly sideEffects: () => number } {
	let count = 0;
	const options = { ...authority };
	Object.defineProperties(options, {
		indexedDB: { enumerable: true, get() { count += 1; throw new Error('indexedDB get'); } },
		repositoryFactory: { enumerable: true, get() { count += 1; throw new Error('factory get'); } },
	});
	return { options, sideEffects: () => count };
}

function storageProfile(identity: string): EditorProjectStorageProfile {
	return createEditorProjectStorageProfile({
		databaseName: `${identity}-database`,
		opfsDirectoryName: `${identity}-sources`,
		opfsWorkerName: `${identity}-worker`,
		projectLockPrefix: `${identity}-lock:`,
	});
}

function fixtureFactory(): StorageRepositoryFactory {
	return () => repositoryFixture();
}

function repositoryFixture(): StorageRepositories {
	return {
		projects: {}, settings: {}, analysis: {}, sources: {}, media: {}, retention: {},
	} as unknown as StorageRepositories;
}

function zeroTrapProxy<T extends object>(
	target: T,
): { readonly proxy: T; readonly hits: number[] } {
	const hits = [0, 0, 0, 0];
	return {
		proxy: new Proxy(target, {
			getPrototypeOf() { hits[0]! += 1; throw new Error('prototype trap'); },
			ownKeys() { hits[1]! += 1; throw new Error('keys trap'); },
			getOwnPropertyDescriptor() { hits[2]! += 1; throw new Error('descriptor trap'); },
			get() { hits[3]! += 1; throw new Error('get trap'); },
		}),
		hits,
	};
}
