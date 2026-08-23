/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	assertFramescaperEditorProjectEnvironmentV27,
	createFramescaperEditorProjectEnvironmentV27,
} from '../src/framescaper/editor-project-environment-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('selected V27 environment retains the local store when no desktop bridge exists', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV27({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.equal(environment.runtime.profile, FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
	assert.equal(environment.desktopProjectLibrary, null);
	assert.equal(environment.controllerStore, environment.store);
	assert.ok(environment.claimCleanup);
	assert.equal(environment.initialCleanup.status, 'settled');
	assert.equal(assertFramescaperEditorProjectEnvironmentV27(environment), environment);
});

test('selected V27 environment composes the authenticated desktop V18 renderer and adapter', async (context) => {
	installDesktopBridge(context);
	const environment = await createFramescaperEditorProjectEnvironmentV27({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.ok(environment.desktopProjectLibrary);
	assert.notEqual(environment.controllerStore, environment.store);
});

function installDesktopBridge(context: TestContext): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'framescaperDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	const unavailable = async (): Promise<never> => { throw new Error('not used'); };
	const projectLibrary = Object.freeze({
		connect: async () => Object.freeze({
			kind: 'framescaper-project-library-handshake', version: 1, owner: 'framescaper',
			projectSchemaVersion: 27, scapeFormatVersions: Object.freeze([1, 2]),
			attachedScapeFormatVersion: 2,
			storageDatabaseName: 'kw-media-framescaper-editor-v27',
			desktopLibrarySchemaVersion: 18, desktopDatabaseUserVersion: 20,
			desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v18']),
		}),
		handshakeState: () => 'admitted',
		listProjects: unavailable,
		readProjectBundle: unavailable,
		readBodyChunk: unavailable,
		beginPublication: unavailable,
		writePublicationChunk: unavailable,
		finishPublication: unavailable,
		abortPublication: unavailable,
		deleteProject: unavailable,
		duplicateProject: unavailable,
	});
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary }) }),
	});
}
