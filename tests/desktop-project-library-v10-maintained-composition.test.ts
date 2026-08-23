/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import {
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import { createHash as createSandboxHash } from '../desktop/project-library-v10-sandbox-crypto.ts';
import {
	createFramescaperDesktopProjectLibraryV18Handshake,
} from '../desktop/project-library-v18-contract.ts';
import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import {
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
} from '../desktop/soundscaper-project-library-v10-contract.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSITION = 'desktop/project-library-product-runtime.js';
const SOUNDSCAPER_SANDBOX_ENTRY = 'desktop/soundscaper-project-library-v10-sandbox-preload.ts';
const SOUNDSCAPER_SANDBOX_BUNDLE = 'soundscaper-project-library-v10-sandbox-preload.cjs';
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
const SOUNDSCAPER_CHANNELS = Object.freeze([
	'soundscaper:v10:projects:handshake',
	'soundscaper:v10:projects:bundle',
	'soundscaper:v10:projects:bodies:read',
	'soundscaper:v10:projects:list',
	'soundscaper:v10:projects:delete',
	'soundscaper:v10:projects:duplicate',
	'soundscaper:v10:projects:publication:begin',
	'soundscaper:v10:projects:publication:chunk',
	'soundscaper:v10:projects:publication:finish',
	'soundscaper:v10:projects:publication:abort',
]);

test('sandbox hash seam preserves the exact SHA-256 contract without Node authority', () => {
	assert.equal(
		createSandboxHash('sha256').update('abc').digest('hex'),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
	assert.throws(() => createSandboxHash('sha1'), /only SHA-256/iu);
});

test('maintained main selects Framescaper V18 and Soundscaper V10 with existing owner cleanup', async () => {
	const [main, composition, preload, soundscaperSandboxEntry] = await Promise.all([
		readFile(join(ROOT, 'desktop/main.mjs'), 'utf8'),
		readFile(join(ROOT, COMPOSITION), 'utf8'),
		readFile(join(ROOT, 'desktop/preload.mjs'), 'utf8'),
		readFile(join(ROOT, SOUNDSCAPER_SANDBOX_ENTRY), 'utf8'),
	]);
	assert.match(main, /startDesktopProjectLibraryProductRuntime\(\{[\s\S]*productId:\s*PRODUCT_ID/u);
	assert.match(main, /projectLibraryRuntime\.registerRendererBridge\(\{/u);
	assert.match(main, /projectLibraryIpc:\s*\(\)\s*=>\s*projectLibraryIpc/u);
	assert.match(main,
		/did-start-navigation[\s\S]*revokeRendererSaveOwner[\s\S]*did-frame-navigate[\s\S]*activateRendererSaveOwner/u);
	assert.match(main, /attachDesktopMainWindowRecovery\([\s\S]*rendererOwnershipCleanup\.drain/u);
	assert.match(composition, /productId\s*===\s*'framescaper'/u);
	assert.match(composition, /FramescaperDesktopProjectLibraryV18Main\.start/u);
	assert.match(composition, /SoundscaperDesktopProjectLibraryV10Main\.start/u);
	assert.match(composition, /DesktopProjectLibraryHost\.start/u);
	assert.match(composition, /registerPreloadScript/u);
	assert.match(composition, /bridge\.dispose\(\)[\s\S]*#host\.close\(\)/u);
	assert.match(soundscaperSandboxEntry, /createSoundscaperDesktopProjectLibraryV10MainPreloadBridge/u);
	assert.match(preload, /projectLibrary:\s*framescaperProjectLibrary/u);
	assert.match(preload, /exposeInMainWorld\('framescaperDesktop', framescaperBridge\)/u);
	assert.doesNotMatch(preload, /framescaperProjectLibraryDesktop/u);
	assert.ok(main.trimEnd().split('\n').length <= 600);
	assert.ok(composition.trimEnd().split('\n').length <= 600);
});

test('staged product selector isolates exact-generation handlers, preload, sessions, and close order', async (context) => {
	const fixture = await stagedFixture(context);
	const module = await import(`${pathToFileURL(join(fixture.applicationDesktopRoot, 'project-library-product-runtime.js')).href}?${Date.now()}`) as {
		startDesktopProjectLibraryProductRuntime(value: unknown): Promise<ProductRuntime>;
	};
	const removed: string[] = [];
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const preloadRegistrations: unknown[] = [];
	const preloadRemovals: string[] = [];
	const session = {
		registerPreloadScript(value: unknown) {
			preloadRegistrations.push(value);
			return `v10-preload-${String(preloadRegistrations.length)}`;
		},
		unregisterPreloadScript(id: string) { preloadRemovals.push(id); },
	};
	const runtime = await module.startDesktopProjectLibraryProductRuntime({
		productId: 'framescaper',
		appDataPath: fixture.appDataPath,
		processId: 812,
		instanceId: 'framescaper-maintained-runtime',
		onLeaseLost: () => {},
		leaseQualification: null,
	});
	context.after(() => runtime.close());
	const registration = runtime.registerRendererBridge({
		desktopRoot: fixture.applicationDesktopRoot,
		handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => {
			handlers.set(channel, handler);
		},
		ownerFor: (event: unknown) => (event as { owner: object }).owner,
		removeHandler: (channel: string) => { removed.push(channel); handlers.delete(channel); },
		session,
	});
	assert.deepEqual([...handlers.keys()], CHANNELS);
	assert.deepEqual(preloadRegistrations, []);
	const owner = {};
	const handshake = await handlers.get(CHANNELS[0])!({ owner }, exactHandshake());
	assert.deepEqual(handshake, exactHandshake());
	assert.equal(runtime.snapshot().activeSessions, 1);
	const project = createFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v27-package-witness',
		title: 'Framescaper V27 package witness',
		revision: 0,
		now: '2026-08-13T12:00:00.000Z',
	});
	const admission = await handlers.get(CHANNELS[6])!({ owner }, {
		publicationId: 'ab'.repeat(24),
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: [],
	}) as { publicationId: string };
	const bundle = await handlers.get(CHANNELS[8])!({ owner }, {
		publicationId: admission.publicationId,
	}) as {
		metadataRevision: number;
		project: {
			projectId: string;
			name: string;
			projectSchemaVersion: number;
			projectRevision: number;
			byteLength: number;
			sha256: string;
		};
		bodies: unknown[];
	};
	const evidence = await runtime.smokeEvidence(String(project.id));
	assert.deepEqual(evidence, {
		host: {
			product: 'framescaper',
			closed: false,
			fenced: false,
			activePublication: false,
		},
		project: {
			projectId: project.id,
			title: project.title,
			projectSchemaVersion: 27,
			projectRevision: project.revision,
			metadataRevision: bundle.metadataRevision,
			byteLength: bundle.project.byteLength,
			sha256: bundle.project.sha256,
			bodyCount: bundle.bodies.length,
		},
	});
	assert.doesNotMatch(JSON.stringify(evidence),
		/document|metadataFile|instanceId|processId|libraryRoot|databasePath|managedMediaRoot/iu);
	await registration.revokeOwner(owner);
	assert.equal(runtime.snapshot().activeSessions, 0);
	await registration.dispose();
	assert.deepEqual(preloadRemovals, []);
	assert.deepEqual(removed, [...CHANNELS].reverse());
	await runtime.close();
	assert.equal(runtime.snapshot().closed, true);

	const soundscaperHandlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const soundscaper = await module.startDesktopProjectLibraryProductRuntime({
		productId: 'soundscaper',
		appDataPath: join(fixture.appDataPath, 'soundscaper'),
		processId: 813,
		instanceId: 'soundscaper-maintained-runtime',
		onLeaseLost: () => {},
		leaseQualification: null,
	});
	context.after(() => soundscaper.close());
	const soundscaperRegistration = soundscaper.registerRendererBridge({
		desktopRoot: fixture.applicationDesktopRoot,
		handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => {
			soundscaperHandlers.set(channel, handler);
		},
		ownerFor: (event: unknown) => (event as { owner: object }).owner,
		removeHandler: () => {},
		session,
	});
	assert.equal(soundscaper.snapshot().owner.product, 'soundscaper');
	assert.deepEqual([...soundscaperHandlers.keys()], SOUNDSCAPER_CHANNELS);
	assert.deepEqual(preloadRegistrations[0], {
		type: 'frame',
		filePath: join(fixture.applicationDesktopRoot, SOUNDSCAPER_SANDBOX_BUNDLE),
	});
	const soundscaperOwner = {};
	assert.deepEqual(
		await soundscaperHandlers.get(SOUNDSCAPER_CHANNELS[0])!({ owner: soundscaperOwner }, exactSoundscaperHandshake()),
		exactSoundscaperHandshake(),
	);
	const soundscaperProject = createSoundscaperProjectV23({
		id: 'soundscaper-v23-package-witness',
		title: 'Soundscaper V23 package witness',
		revision: 0,
		now: '2026-08-14T12:00:00.000Z',
	});
	const soundscaperAdmission = await soundscaperHandlers.get(SOUNDSCAPER_CHANNELS[6])!({ owner: soundscaperOwner }, {
		publicationId: 'cd'.repeat(24),
		expectedMetadataRevision: 0,
		expectedProject: null,
		project: soundscaperProject,
		bodies: [],
	}) as { publicationId: string };
	await soundscaperHandlers.get(SOUNDSCAPER_CHANNELS[8])!({ owner: soundscaperOwner }, {
		publicationId: soundscaperAdmission.publicationId,
	});
	assert.deepEqual(await soundscaper.smokeEvidence(soundscaperProject.id), {
		host: {
			product: 'soundscaper', closed: false, fenced: false, activePublication: false,
		},
		project: {
			projectId: soundscaperProject.id,
			title: soundscaperProject.title,
			projectSchemaVersion: SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
			projectRevision: 0,
			metadataRevision: 1,
			byteLength: new TextEncoder().encode(JSON.stringify(soundscaperProject)).byteLength,
			sha256: createSandboxHash('sha256').update(JSON.stringify(soundscaperProject)).digest('hex'),
			bodyCount: 0,
		},
	});
	await soundscaperRegistration.dispose();
	assert.deepEqual(preloadRemovals, ['v10-preload-1']);
	await soundscaper.close();
});

test('Framescaper base preload exposes only the unversioned handshake-first public library path', async (context) => {
	const fixture = await stagedFixture(context);
	const source = await readFile(join(fixture.applicationDesktopRoot, 'preload.mjs'), 'utf8');
	const calls: Array<{ channel: string; value: unknown }> = [];
	const exposed = new Map<string, unknown>();
	vm.runInNewContext(source, {
		AggregateError, Array, ArrayBuffer, JSON, Number, Object, Promise, RangeError,
		String, TextDecoder, TextEncoder, TypeError, Uint8Array, URL, structuredClone,
		require(specifier: string) {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name: string, value: unknown) => exposed.set(name, value) },
				ipcRenderer: { invoke: (channel: string, value: unknown) => {
					calls.push({ channel, value });
					if (channel === CHANNELS[0]) return Promise.resolve(value);
					if (channel === CHANNELS[3]) return Promise.resolve(Object.assign(Object.create(null), {
						metadataRevision: 0,
						projects: [],
					}));
					throw new Error(`Unexpected sandbox invocation: ${channel}`);
				}, send() {}, on() {}, removeListener() {} },
			};
		},
	});
	assert.deepEqual([...exposed.keys()], ['scapeDesktop', 'soundscaperDesktop', 'framescaperDesktop']);
	const soundscaper = exposed.get('soundscaperDesktop') as { v1: Record<string, unknown> };
	const framescaper = exposed.get('framescaperDesktop') as { v1: Record<string, unknown> };
	assert.equal(Object.hasOwn(soundscaper.v1, 'projectLibrary'), false);
	assert.equal(Object.hasOwn(framescaper.v1, 'v12'), false);
	const bridge = framescaper.v1.projectLibrary as PreloadBridge;
	assert.deepEqual(Object.keys(bridge).sort(), [
		'abortPublication', 'beginPublication', 'connect', 'deleteProject', 'duplicateProject',
		'finishPublication', 'handshakeState', 'listProjects', 'readBodyChunk', 'readProjectBundle',
		'writePublicationChunk',
	]);
	await assert.rejects(() => bridge.readProjectBundle('project-before-handshake'), /handshake.*required/iu);
	await assert.rejects(() => bridge.listProjects(), /handshake.*required/iu);
	assert.equal(calls.length, 0);
	assert.deepEqual(JSON.parse(JSON.stringify(await bridge.connect())), exactHandshake());
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ channel: CHANNELS[0], value: exactHandshake() }]);
	assert.equal(bridge.handshakeState(), 'admitted');
	assert.doesNotMatch(JSON.stringify({ calls, keys: Object.keys(bridge) }),
		/libraryRoot|databasePath|managedMediaRoot|projectsRoot|lease|filePath/iu);
});

test('Soundscaper sandbox bundle exposes only its exact handshake-first V10 bridge', async (context) => {
	const fixture = await stagedFixture(context);
	const source = await readFile(join(fixture.applicationDesktopRoot, SOUNDSCAPER_SANDBOX_BUNDLE), 'utf8');
	const calls: Array<{ channel: string; value: unknown }> = [];
	const exposed = new Map<string, unknown>();
	vm.runInNewContext(source, {
		TextDecoder, TextEncoder, URL,
		require(specifier: string) {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name: string, value: unknown) => exposed.set(name, value) },
				ipcRenderer: { invoke: (channel: string, value: unknown) => {
					calls.push({ channel, value });
					if (channel === SOUNDSCAPER_CHANNELS[0]) return Promise.resolve(value);
					throw new Error(`Unexpected Soundscaper sandbox invocation: ${channel}`);
				} },
			};
		},
	});
	assert.deepEqual([...exposed.keys()], ['soundscaperProjectLibraryDesktop']);
	const bridge = (exposed.get('soundscaperProjectLibraryDesktop') as { v10: PreloadBridge }).v10;
	await assert.rejects(() => bridge.readProjectBundle('project-before-handshake'), /handshake.*required/iu);
	assert.equal(calls.length, 0);
	assert.deepEqual(JSON.parse(JSON.stringify(await bridge.connect())), exactSoundscaperHandshake());
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
		channel: SOUNDSCAPER_CHANNELS[0], value: exactSoundscaperHandshake(),
	}]);
	assert.equal(bridge.handshakeState(), 'admitted');
	assert.doesNotMatch(JSON.stringify({ calls, keys: Object.keys(bridge) }),
		/libraryRoot|databasePath|managedMediaRoot|projectsRoot|lease|filePath/iu);
});

async function stagedFixture(context: TestContext): Promise<Readonly<{
	applicationDesktopRoot: string;
	appDataPath: string;
}>> {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-v12-maintained-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, 'runtime');
	const applicationDesktopRoot = join(root, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'), applicationDesktopRoot, runtimeRoot,
	});
	return Object.freeze({ applicationDesktopRoot, appDataPath: join(root, 'app-data') });
}

function exactHandshake(): Readonly<Record<string, unknown>> {
	return createFramescaperDesktopProjectLibraryV18Handshake() as unknown as
		Readonly<Record<string, unknown>>;
}

function exactSoundscaperHandshake(): Readonly<Record<string, unknown>> {
	return createSoundscaperDesktopProjectLibraryV10Handshake() as unknown as
		Readonly<Record<string, unknown>>;
}

interface ProductRuntime {
	registerRendererBridge(value: unknown): {
		dispose(): Promise<void>;
		revokeOwner(owner: object): Promise<void>;
	};
	snapshot(): {
		readonly activeSessions: number;
		readonly closed: boolean;
		readonly owner: { readonly product: string };
	};
	smokeEvidence(projectId: string): Promise<unknown>;
	close(): Promise<void>;
}

interface PreloadBridge {
	connect(): Promise<Readonly<Record<string, unknown>>>;
	handshakeState(): string;
	listProjects(): Promise<unknown>;
	readProjectBundle(projectId: string): Promise<unknown>;
	deleteProject(value: unknown): Promise<unknown>;
	duplicateProject(value: unknown): Promise<unknown>;
}
