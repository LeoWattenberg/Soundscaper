/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { acceptsFile, validateFileChoice } from '../desktop/validation.js';

const SESSION_ID = 'a'.repeat(64);
const ROOT_ID = 'b'.repeat(48);

test('the desktop project picker admits SESX without changing project associations', async () => {
	const choice = validateFileChoice({ purpose: 'project' });
	assert.equal(choice.extensions.includes('sesx'), true);
	assert.equal(acceptsFile('project', '/session/song.sesx'), true);
	assert.equal(acceptsFile('media', '/session/song.sesx'), false);
	const { OPENABLE_PROJECT_EXTENSIONS } = await import('../desktop/file-associations.js');
	assert.equal(OPENABLE_PROJECT_EXTENSIONS.includes('.sesx'), false);
});

test('selected SESX file creates a separate owner-scoped session grant', async () => {
	const calls = [];
	const handlers = new Map();
	const owner = {};
	const descriptor = { id: SESSION_ID, name: 'song.sesx' };
	registerFileCapabilityIpc({
		channels: {
			chooseFiles: 'choose', releaseRead: 'read-release', sesxResolveMedia: 'sesx-resolve',
			sesxChooseFolder: 'sesx-folder', sesxReleaseSession: 'sesx-release',
			chooseSaveTarget: 'save', beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort',
		},
		desktopSmokeProbe: { resolveOpenPaths: () => ['/session/song.sesx'], resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
		handle: (channel, listener) => handlers.set(channel, listener),
		opaqueId: (value, length) => {
			if (typeof value !== 'string' || value.length !== length) throw new TypeError('Invalid ID');
			return value;
		},
		ownerFor: () => owner,
		pendingOpenProjects: new Map(),
		readCapabilities: {
			registerMaterializedPath: async (filePath, options) => { calls.push(['read-register', filePath, options]); return descriptor; },
			release: async (id, options) => { calls.push(['read-release', id, options]); return true; },
		},
		sesxMediaSessions: {
			registerSelection: (id, filePath, options) => calls.push(['session-register', id, filePath, options]),
			resolve: async (value) => { calls.push(['resolve', value]); return { status: 'missing' }; },
			chooseFolder: async (value) => { calls.push(['folder', value]); return { status: 'selected', mediaRootId: ROOT_ID }; },
			release: (id, options) => { calls.push(['session-release', id, options]); return true; },
		},
		saves: {}, saveTargets: {}, windowFor: () => null,
	});
	assert.deepEqual(await handlers.get('choose')({}, { purpose: 'project' }), [descriptor]);
	assert.deepEqual(calls[1], ['session-register', SESSION_ID, '/session/song.sesx', { owner }]);
	assert.deepEqual(await handlers.get('sesx-folder')({}, { sessionReadId: SESSION_ID }), { status: 'selected', mediaRootId: ROOT_ID });
	assert.deepEqual(await handlers.get('sesx-resolve')({}, { sessionReadId: SESSION_ID, relativePath: 'Audio/take.wav', mediaRootId: ROOT_ID }), { status: 'missing' });
	assert.deepEqual(calls.at(-1), ['resolve', { owner, sessionReadId: SESSION_ID, relativePath: 'Audio/take.wav', mediaRootId: ROOT_ID }]);
	assert.equal(await handlers.get('sesx-release')({}, SESSION_ID), true);
});
