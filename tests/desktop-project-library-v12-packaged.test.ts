/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import {
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import {
	createFramescaperDesktopProjectLibraryV18Handshake,
} from '../desktop/project-library-v18-contract.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = Object.freeze([
	'framescaper:v18:projects:handshake',
	'framescaper:v18:projects:bundle',
	'framescaper:v18:projects:bodies:read',
	'framescaper:v18:projects:list',
	'framescaper:v18:projects:delete',
	'framescaper:v18:projects:duplicate',
	'framescaper:v18:projects:publication:begin',
	'framescaper:v18:projects:publication:chunk',
	'framescaper:v18:projects:publication:finish',
	'framescaper:v18:projects:publication:abort',
]);

test('packaged Framescaper selects V18 while preserving the public framescaperDesktop.v1 bridge', async (context) => {
	const fixture = await stagedFixture(context);
	await assert.rejects(
		() => access(join(fixture.applicationDesktopRoot, 'project-library-v10-sandbox-preload.cjs')),
		/ENOENT/u,
		'the selected V18 application must not stage the historical Framescaper V10 preload',
	);
	const basePreload = await readFile(join(fixture.applicationDesktopRoot, 'preload.mjs'), 'utf8');
	assert.match(basePreload, /projectLibrary/u);
	assert.match(basePreload, /contextBridge\.exposeInMainWorld\('framescaperDesktop'/u);
	assert.doesNotMatch(basePreload, /framescaperProjectLibraryDesktop/u);

	const module = await import(`${pathToFileURL(join(
		fixture.applicationDesktopRoot,
		'project-library-product-runtime.js',
	)).href}?${Date.now()}`) as {
		startDesktopProjectLibraryProductRuntime(value: unknown): Promise<ProductRuntime>;
	};
	const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<unknown> | unknown>();
	const removed: string[] = [];
	const preloads: unknown[] = [];
	const preloadRemovals: string[] = [];
	const runtime = await module.startDesktopProjectLibraryProductRuntime({
		productId: 'framescaper',
		appDataPath: fixture.appDataPath,
		processId: 8120,
		instanceId: 'framescaper-v18-packaged',
		onLeaseLost: () => {},
		leaseQualification: null,
	});
	context.after(() => runtime.close());
	const registration = runtime.registerRendererBridge({
		desktopRoot: fixture.applicationDesktopRoot,
		handle: (channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown> | unknown) => {
			handlers.set(channel, handler);
		},
		ownerFor: (event: unknown) => (event as { owner: object }).owner,
		removeHandler: (channel: string) => { removed.push(channel); handlers.delete(channel); },
		session: {
			registerPreloadScript(value: unknown) { preloads.push(value); return 'framescaper-v18-preload'; },
			unregisterPreloadScript(id: string) { preloadRemovals.push(id); },
		},
	});
	assert.deepEqual([...handlers.keys()], CHANNELS);
	assert.deepEqual(preloads, [], 'the selected base preload owns the public Framescaper bridge');
	const owner = {};
	const handshake = createFramescaperDesktopProjectLibraryV18Handshake();
	assert.deepEqual(await handlers.get(CHANNELS[0])!({ owner }, handshake), handshake);
	const project = createFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v18-packaged-project',
		title: 'Framescaper V18 packaged project',
		revision: 0,
		now: '2026-08-22T12:00:00.000Z',
	});
	const admission = await handlers.get(CHANNELS[6])!({ owner }, {
		publicationId: 'ab'.repeat(24),
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: [],
	}) as { publicationId: string };
	await handlers.get(CHANNELS[8])!({ owner }, { publicationId: admission.publicationId });
	const evidence = await runtime.smokeEvidence(String(project.id)) as {
		project: { sha256: string };
	};
	assert.deepEqual(evidence, {
		host: { product: 'framescaper', closed: false, fenced: false, activePublication: false },
		project: {
			projectId: project.id,
			title: project.title,
			projectSchemaVersion: 27,
			projectRevision: 0,
			metadataRevision: 1,
			byteLength: new TextEncoder().encode(JSON.stringify(project)).byteLength,
			sha256: evidence.project.sha256,
			bodyCount: 0,
		},
	}, 'packaged smoke evidence is pathless');
	assert.match(evidence.project.sha256, /^[a-f0-9]{64}$/u);
	assert.doesNotMatch(JSON.stringify(evidence), /libraryRoot|databasePath|managedMediaRoot|instanceId|processId/iu);
	await registration.revokeOwner(owner);
	await registration.dispose();
	assert.deepEqual(preloadRemovals, []);
	assert.deepEqual(removed, [...CHANNELS].reverse());
	await runtime.close();
});

test('packaged base preload exposes one unversioned pathless handshake-first Framescaper API', async (context) => {
	const fixture = await stagedFixture(context);
	const source = await readFile(join(fixture.applicationDesktopRoot, 'preload.mjs'), 'utf8');
	const exposed = new Map<string, unknown>();
	const calls: Array<Readonly<{ channel: string; value: unknown }>> = [];
	vm.runInNewContext(source, {
		AggregateError,
		Array,
		AbortController,
		ArrayBuffer,
		DataView,
		JSON,
		Number,
		Object,
		Promise,
		RangeError,
		String,
		TextDecoder,
		TextEncoder,
		TypeError,
		URL,
		Uint8Array,
		structuredClone,
		require(specifier: string) {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name: string, value: unknown) => exposed.set(name, value) },
				ipcRenderer: { invoke: (channel: string, value: unknown) => {
					calls.push({ channel, value });
					if (channel === CHANNELS[0]) return Promise.resolve(value);
					throw new Error(`Unexpected V18 invocation: ${channel}`);
				}, send() {}, on() {}, removeListener() {} },
			};
		},
	});
	assert.deepEqual([...exposed.keys()], ['scapeDesktop', 'soundscaperDesktop', 'framescaperDesktop']);
	const soundscaper = exposed.get('soundscaperDesktop') as { v1: Record<string, unknown> };
	const framescaper = exposed.get('framescaperDesktop') as { v1: Record<string, unknown> };
	assert.equal(Object.hasOwn(soundscaper.v1, 'projectLibrary'), false);
	assert.equal(Object.hasOwn(framescaper.v1, 'v12'), false);
	const bridge = framescaper.v1.projectLibrary as {
		connect(): Promise<unknown>; handshakeState(): string; listProjects(): Promise<unknown>;
	};
	await assert.rejects(() => bridge.listProjects(), /handshake.*required/iu);
	assert.deepEqual(JSON.parse(JSON.stringify(await bridge.connect())), createFramescaperDesktopProjectLibraryV18Handshake());
	assert.equal(bridge.handshakeState(), 'admitted');
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ channel: CHANNELS[0], value: createFramescaperDesktopProjectLibraryV18Handshake() }]);
	assert.doesNotMatch(JSON.stringify({ calls, keys: Object.keys(bridge) }), /libraryRoot|databasePath|managedMediaRoot|projectsRoot|filePath/iu);
});

async function stagedFixture(context: TestContext): Promise<Readonly<{
	applicationDesktopRoot: string;
	appDataPath: string;
}>> {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v12-packaged-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, 'runtime');
	const applicationDesktopRoot = join(root, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'),
		applicationDesktopRoot,
		runtimeRoot,
	});
	return Object.freeze({ applicationDesktopRoot, appDataPath: join(root, 'app-data') });
}

interface ProductRuntime {
	registerRendererBridge(value: unknown): {
		dispose(): Promise<void>;
		revokeOwner(owner: object): Promise<void>;
	};
	smokeEvidence(projectId: string): Promise<unknown>;
	close(): Promise<void>;
}
