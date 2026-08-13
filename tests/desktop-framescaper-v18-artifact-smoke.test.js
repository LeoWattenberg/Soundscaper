/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

import { createDesktopSmokeProbe } from '../desktop/desktop-smoke.js';
import { runFramescaperV18ArtifactRendererSmoke } from '../desktop/framescaper-v18-artifact-smoke.js';

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

test('Framescaper artifact probe waits for renderer readiness and joins sanitized V18 main evidence', async () => {
	const renderer = rendererFixture().expected;
	const main = validMainEvidence(renderer.framescaperV18.project);
	const fixture = artifactProbeFixture(renderer, main);
	fixture.probe.attach(fixture.window);

	await fixture.window.webContents.emit('did-finish-load');
	assert.equal(fixture.window.webContents.executions.length, 0, 'load alone must not inspect an unready V18 UI');
	assert.deepEqual(fixture.exits, []);

	await fixture.probe.rendererReady();

	assert.equal(fixture.window.webContents.executions.length, 1);
	assert.deepEqual(fixture.evidenceCalls, [renderer.framescaperV18.project.projectId]);
	assert.deepEqual(fixture.exits, [0]);
	assert.equal(fixture.errors.length, 0);
	const payload = JSON.parse(fixture.logs[0].slice('SOUNDSCAPER_DESKTOP_SMOKE '.length));
	assert.deepEqual(payload, {
		...renderer,
		framescaperV18: { ...renderer.framescaperV18, main },
	});
	assert.doesNotMatch(JSON.stringify(payload), /metadataFile|instanceId|processId|libraryRoot|document/iu);
});

test('Framescaper artifact probe rejects renderer and main V18 readback disagreement', async () => {
	const renderer = rendererFixture().expected;
	const main = validMainEvidence(renderer.framescaperV18.project);
	const fixture = artifactProbeFixture(renderer, {
		...main,
		project: { ...main.project, sha256: 'cd'.repeat(32) },
	});
	fixture.probe.attach(fixture.window);

	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.equal(fixture.logs.length, 0);
	assert.equal(fixture.errors.length, 1);
	assert.match(fixture.errors[0], /SOUNDSCAPER_DESKTOP_SMOKE failed:.*V18.*match|readback/iu);
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
		finishPublication: async () => ({}),
		handshakeState: () => { calls.push('handshakeState'); return 'admitted'; },
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
					'abortPublication', 'beginPublication', 'connect', 'finishPublication', 'handshakeState',
					'readBodyChunk', 'readProjectBundle', 'writePublicationChunk',
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

function artifactProbeFixture(executionResult, evidence) {
	const logs = [];
	const errors = [];
	const exits = [];
	const evidenceCalls = [];
	const window = fakeWindow(executionResult);
	const probe = createDesktopSmokeProbe({
		argv: ['/opt/Framescaper', '--soundscaper-smoke'],
		appName: 'Framescaper',
		appOrigin: 'framescaper-app://bundle',
		productId: 'framescaper',
		exit: async (code) => { exits.push(code); },
		log: (value) => { logs.push(value); },
		reportError: (value) => { errors.push(value); },
		projectLibraryEvidence: async (projectId) => {
			evidenceCalls.push(projectId);
			return evidence;
		},
		setTimeout: () => 1,
		clearTimeout: () => undefined,
	});
	return { errors, evidenceCalls, exits, logs, probe, window };
}

function fakeWindow(executionResult) {
	const listeners = new Map();
	const webContents = {
		executions: [],
		once(name, listener) { listeners.set(name, listener); },
		async executeJavaScript(source) {
			this.executions.push(source);
			return structuredClone(executionResult);
		},
		async emit(name, ...args) {
			const listener = listeners.get(name);
			listeners.delete(name);
			return listener?.(...args);
		},
	};
	return { webContents };
}
