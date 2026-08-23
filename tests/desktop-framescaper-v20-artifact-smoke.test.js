/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

import { runFramescaperV20ArtifactRendererSmoke } from '../desktop/framescaper-v20-artifact-smoke.js';

test('Framescaper artifact renderer witnesses the exact ready UI, V12 preload, handshake, and V20 bundle', async () => {
	const fixture = rendererFixture();
	const injectedSmoke = vm.runInNewContext(`(${runFramescaperV20ArtifactRendererSmoke.toString()})`);
	const result = await injectedSmoke(fixture.scope, {
		appName: 'Framescaper',
		appOrigin: 'framescaper-app://bundle',
	});

	assert.deepEqual(JSON.parse(JSON.stringify(result)), fixture.expected);
	assert.deepEqual(fixture.calls, ['handshakeState', 'connect', 'handshakeState', 'readProjectBundle']);
	assert.doesNotMatch(JSON.stringify(result), /document|metadataFile|instanceId|processId|libraryRoot/iu);
});

test('Framescaper artifact renderer refuses preload drift and UI/bundle disagreement', async () => {
	const missingMethod = rendererFixture({ omitPreloadMethod: 'readBodyChunk' });
	await assert.rejects(
		() => runFramescaperV20ArtifactRendererSmoke(missingMethod.scope, {
			appName: 'Framescaper', appOrigin: 'framescaper-app://bundle',
		}),
		/exact V12 preload bridge/iu,
	);

	const driftedUi = rendererFixture({ uiTitle: 'Drifted title' });
	await assert.rejects(
		() => runFramescaperV20ArtifactRendererSmoke(driftedUi.scope, {
			appName: 'Framescaper', appOrigin: 'framescaper-app://bundle',
		}),
		/UI.*V20 bundle|title.*match/iu,
	);
});

function rendererFixture({ omitPreloadMethod = null, uiTitle = 'Untitled project' } = {}) {
	const projectDocument = {
		schemaVersion: 20,
		id: 'framescaper-artifact-v20',
		title: 'Untitled project',
		revision: 0,
		tracks: [{ id: 'track-1' }],
		clips: [],
	};
	const documentText = JSON.stringify(projectDocument);
	const bytes = new TextEncoder().encode(documentText);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const project = {
		projectId: projectDocument.id,
		title: projectDocument.title,
		projectSchemaVersion: 20,
		projectRevision: 0,
		metadataRevision: 1,
		byteLength: bytes.byteLength,
		sha256,
		bodyCount: 0,
	};
	const handshake = exactHandshake();
	const calls = [];
	const api = {
		abortPublication: async () => false,
		beginPublication: async () => ({}),
		connect: async () => { calls.push('connect'); return handshake; },
		deleteProject: async () => ({}),
		duplicateProject: async () => ({}),
		finishPublication: async () => ({}),
		handshakeState: () => { calls.push('handshakeState'); return 'admitted'; },
		listProjects: async () => ({ metadataRevision: 1, projects: [] }),
		readBodyChunk: async () => new Uint8Array(),
		readProjectBundle: async () => {
			calls.push('readProjectBundle');
			return {
				metadataRevision: 1,
				project: {
					id: 'opaque-entry-id',
					projectId: projectDocument.id,
					name: projectDocument.title,
					metadataFile: `opaque-entry-id/0-${sha256}.json`,
					preferredProduct: 'framescaper',
					updatedAtMs: 1,
					projectSchemaVersion: 20,
					projectRevision: 0,
					byteLength: bytes.byteLength,
					sha256,
				},
				document: documentText,
				bodies: [],
			};
		},
		writePublicationChunk: async () => ({}),
	};
	if (omitPreloadMethod) delete api[omitPreloadMethod];
	const editor = {
		dataset: {
			product: 'framescaper',
			projectId: projectDocument.id,
			trackCount: '1',
			clipCount: '0',
		},
		querySelector(selector) {
			assert.equal(selector, '.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]');
			return { textContent: uiTitle };
		},
	};
	const genericBridge = {
		beginWrite: async () => { throw new Error('Save target expired or was already used'); },
		chooseFiles: async () => [],
		getEnvironment: async () => ({ platform: 'linux', arch: 'x64' }),
		projectLibrary: api,
		respondToClose: async () => undefined,
	};
	const scope = {
		crypto: globalThis.crypto,
		TextEncoder,
		location: { href: 'framescaper-app://bundle/' },
		document: {
			title: 'Framescaper',
			querySelector: (selector) => selector === 'main' ? {} : null,
			querySelectorAll: (selector) => {
				assert.equal(selector, '[data-audio-editor][data-audio-editor-bound="true"]');
				return [editor];
			},
		},
		framescaperDesktop: { v1: genericBridge },
	};
	return {
		calls,
		scope,
		expected: {
			url: 'framescaper-app://bundle/',
			title: 'Framescaper',
			bridge: ['beginWrite', 'chooseFiles', 'getEnvironment', 'projectLibrary', 'respondToClose'],
			environment: { platform: 'linux', arch: 'x64' },
			hasEditor: true,
			nodeExposed: false,
			saveOwnerReady: true,
			framescaperV20: {
				preloadBridge: [
					'abortPublication', 'beginPublication', 'connect', 'deleteProject', 'duplicateProject',
					'finishPublication', 'handshakeState', 'listProjects', 'readBodyChunk', 'readProjectBundle',
					'writePublicationChunk',
				],
				handshake,
				ui: { projectId: project.projectId, title: project.title, trackCount: 1, clipCount: 0 },
				project,
			},
		},
	};
}

function exactHandshake() {
	return {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 20,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v20',
		desktopLibrarySchemaVersion: 12,
		desktopDatabaseUserVersion: 14,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v12'],
	};
}
