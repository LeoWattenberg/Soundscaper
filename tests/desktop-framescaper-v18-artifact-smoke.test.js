/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

import {
	joinFramescaperV18ArtifactEvidence,
	runFramescaperV18ArtifactRendererSmoke,
} from '../desktop/framescaper-v18-artifact-smoke.js';

test('Framescaper artifact renderer witnesses the exact ready UI, V10 preload, handshake, and V18 bundle', async () => {
	const fixture = rendererFixture();
	const injectedSmoke = vm.runInNewContext(`(${runFramescaperV18ArtifactRendererSmoke.toString()})`);
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
		() => runFramescaperV18ArtifactRendererSmoke(missingMethod.scope, {
			appName: 'Framescaper', appOrigin: 'framescaper-app://bundle',
		}),
		/exact V10 preload bridge/iu,
	);

	const driftedUi = rendererFixture({ uiTitle: 'Drifted title' });
	await assert.rejects(
		() => runFramescaperV18ArtifactRendererSmoke(driftedUi.scope, {
			appName: 'Framescaper', appOrigin: 'framescaper-app://bundle',
		}),
		/UI.*V18 bundle|title.*match/iu,
	);
});

test('the historical V18 boundary joins only sanitized renderer and main evidence', () => {
	const renderer = rendererFixture().expected.framescaperV18;
	const main = validMainEvidence(renderer.project);
	const result = joinFramescaperV18ArtifactEvidence(renderer, main);
	assert.deepEqual(result, { ...renderer, main });
	assert.doesNotMatch(JSON.stringify(result), /metadataFile|instanceId|processId|libraryRoot|"document"/iu);
});

test('the historical V18 boundary rejects renderer and main readback disagreement', () => {
	const renderer = rendererFixture().expected.framescaperV18;
	const main = validMainEvidence(renderer.project);
	assert.throws(() => joinFramescaperV18ArtifactEvidence(renderer, {
		...main, project: { ...main.project, sha256: 'cd'.repeat(32) },
	}), /V18.*match|readback/iu);
});

function rendererFixture({ omitPreloadMethod = null, uiTitle = 'Untitled project' } = {}) {
	const projectDocument = {
		schemaVersion: 18,
		id: 'framescaper-artifact-v18',
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
		projectSchemaVersion: 18,
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
					projectSchemaVersion: 18,
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
		framescaperProjectLibraryDesktop: { v10: api },
	};
	return {
		calls,
		scope,
		expected: {
			url: 'framescaper-app://bundle/',
			title: 'Framescaper',
			bridge: ['beginWrite', 'chooseFiles', 'getEnvironment', 'respondToClose'],
			environment: { platform: 'linux', arch: 'x64' },
			hasEditor: true,
			nodeExposed: false,
			saveOwnerReady: true,
			framescaperV18: {
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
		projectSchemaVersion: 18,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v18',
		desktopLibrarySchemaVersion: 10,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
	};
}

function validMainEvidence(project) {
	return {
		host: {
			product: 'framescaper',
			closed: false,
			fenced: false,
			activePublication: false,
		},
		project: { ...project },
	};
}
