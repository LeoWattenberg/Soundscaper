/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperDesktopProjectLibraryHandshake } from
	'../desktop/soundscaper-project-library-contract.ts';
import { createSoundscaperEditorProjectEnvironment } from
	'../src/soundscaper/editor-project-environment.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const GLOBAL_NAME = 'soundscaperProjectLibraryDesktop';

test('browser environment keeps the local project store as its controller authority', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	Reflect.deleteProperty(globalThis, GLOBAL_NAME);
	try {
		const environment = await createSoundscaperEditorProjectEnvironment({
			storeOptions: storeOptions(),
		});
		try {
			assert.equal(environment.desktopProjectLibrary, null);
			assert.equal(environment.controllerStore, environment.store);
			const project = createSoundscaperProject({ id: 'browser-environment', title: 'Browser' });
			assert.deepEqual(await environment.createProjectIfAbsent(project), project);
		} finally { await environment.close(); }
	} finally { restore(previous); }
});

test('a present malformed desktop bridge still fails closed without invoking its accessor', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	let accessed = false;
	Object.defineProperty(globalThis, GLOBAL_NAME, {
		configurable: true,
		enumerable: true,
		get() { accessed = true; throw new Error('desktop bridge accessor ran'); },
	});
	try {
		await assert.rejects(
			createSoundscaperEditorProjectEnvironment({ storeOptions: storeOptions() }),
			/own data property/u,
		);
		assert.equal(accessed, false);
	} finally { restore(previous); }
});

test('a present admitted desktop bridge loads the main-backed store overlay', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	let claims = 0;
	const api = Object.freeze({
		connect: async () => handshake,
		handshakeState: () => 'admitted',
		listProjects: async () => ({ metadataRevision: 0, projects: [] }),
		claimProjectWriteFence: async () => { claims += 1; return 'ab'.repeat(24); },
		checkProjectWriteFence: async () => false,
		readProjectBundle: async () => null,
		readBodyChunk: async () => new Uint8Array(),
		beginPublication: async () => ({}),
		writePublicationChunk: async () => ({}),
		finishPublication: async () => ({}),
		abortPublication: async () => false,
		deleteProject: async () => ({}),
		duplicateProject: async () => ({}),
		persistNativePluginState: async () => ({}),
		readNativePluginState: async () => null,
	});
	Object.defineProperty(globalThis, GLOBAL_NAME, {
		configurable: true, enumerable: true, value: Object.freeze({ v1: api }),
	});
	try {
		const environment = await createSoundscaperEditorProjectEnvironment({ storeOptions: storeOptions() });
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
		indexedDB: createInstrumentedIndexedDB(),
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
