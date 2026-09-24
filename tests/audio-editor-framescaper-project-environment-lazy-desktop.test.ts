/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } from
	'../src/framescaper/desktop-project-library-renderer-contract.ts';
import { createFramescaperEditorProjectEnvironment } from
	'../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const GLOBAL_NAME = 'framescaperDesktop';

test('browser Framescaper environment uses its local store without a desktop bridge', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	Reflect.deleteProperty(globalThis, GLOBAL_NAME);
	try {
		const environment = await createFramescaperEditorProjectEnvironment({
			storeOptions: storeOptions(),
		});
		try {
			assert.equal(environment.desktopProjectLibrary, null);
			assert.equal(environment.controllerStore, environment.store);
		} finally { await environment.close(); }
	} finally { restore(previous); }
});

test('present malformed Framescaper bridge is rejected without evaluating its accessor', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	let accessed = false;
	Object.defineProperty(globalThis, GLOBAL_NAME, {
		configurable: true,
		enumerable: true,
		get() { accessed = true; throw new Error('desktop bridge accessor ran'); },
	});
	try {
		await assert.rejects(
			createFramescaperEditorProjectEnvironment({ storeOptions: storeOptions() }),
			/own data property/u,
		);
		assert.equal(accessed, false);
	} finally { restore(previous); }
});

test('present admitted Framescaper bridge loads the main-backed store overlay', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	let claims = 0;
	const projectLibrary = Object.freeze({
		connect: async () => FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE,
		handshakeState: () => 'admitted',
		listProjects: async () => ({ metadataRevision: 0, projects: [] }),
		readProjectBundle: async () => null,
		readBodyChunk: async () => new Uint8Array(),
		beginPublication: async () => ({}),
		writePublicationChunk: async () => ({}),
		finishPublication: async () => ({}),
		abortPublication: async () => false,
		deleteProject: async () => ({}),
		duplicateProject: async () => ({}),
		claimProjectWriteFence: async () => { claims += 1; return 'ab'.repeat(24); },
		checkProjectWriteFence: async () => false,
	});
	Object.defineProperty(globalThis, GLOBAL_NAME, {
		configurable: true,
		enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary }) }),
	});
	try {
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: storeOptions() });
		try {
			assert.ok(environment.desktopProjectLibrary);
			assert.notEqual(environment.controllerStore, environment.store);
			assert.equal(await environment.controllerStore.claimProjectWriteFence('desktop-environment'),
				'ab'.repeat(24));
			assert.equal(claims, 1);
		} finally { await environment.close(); }
	} finally { restore(previous); }
});

function storeOptions() {
	return {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
		storageManager: {
			estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
			persisted: async () => true,
			persist: async () => true,
		} as unknown as StorageManager,
	};
}

function restore(previous: PropertyDescriptor | undefined): void {
	if (previous) Object.defineProperty(globalThis, GLOBAL_NAME, previous);
	else Reflect.deleteProperty(globalThis, GLOBAL_NAME);
}
