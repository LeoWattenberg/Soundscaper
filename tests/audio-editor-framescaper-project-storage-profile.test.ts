/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { createEditorProjectStorageProfile, editorProjectStorageProfileNames,
	type EditorProjectStorageProfile, type EditorProjectStorageProfileNames,
} from '../src/common/editor/storage/project-storage-profile.ts';
import * as projectStorageProfileModule from '../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile-v18.ts';
import * as framescaperStorageProfileModule from '../src/framescaper/editor-project-storage-profile-v18.ts';
import { AudioEditorProjectStore, createProjectStore } from '../src/common/editor/storage.js';
import { acquireProjectLock } from '../src/common/editor/project-lock.js';
import { OpfsRepository, type OpfsRepositoryOptions } from '../src/common/editor/storage/opfs-repository.ts';
import { OpfsSyncWorkerClient, type OpfsSyncWorkerClientOptions,
	type OpfsWorkerLike } from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import type { StorageRepositories, StorageRepositoryFactory,
	StorageRepositoryOptions } from '../src/common/editor/storage/repositories.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const ROOT = resolve(import.meta.dirname, '..');
const PREREQUISITE_MODULE = 'src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
const PRODUCT_MODULE = 'src/framescaper/editor-project-storage-profile-v18.ts';
const PREREQUISITE_TEST_MODULE = 'tests/audio-editor-framescaper-project-runtime-profile-prerequisite.test.ts';
const TEST_MODULE = 'tests/audio-editor-framescaper-project-storage-profile.test.ts';
const PROFILE_EXPORT = 'FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE';
const FRAME_NAMES = Object.freeze({
	databaseName: 'kw-media-framescaper-editor-v18',
	opfsDirectoryName: 'framescaper-editor-v18-sources',
	opfsWorkerName: 'framescaper-editor-v18-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v18-lock:',
} as const satisfies EditorProjectStorageProfileNames);

interface ProfileRoutingNames { readonly opfsDirectoryName: string; readonly opfsWorkerName: string; }
type ProfiledRepositoryOptions = StorageRepositoryOptions & ProfileRoutingNames;
type ProfiledOpfsRepositoryOptions = OpfsRepositoryOptions & ProfileRoutingNames;
type ProfiledWorkerClientOptions = Omit<OpfsSyncWorkerClientOptions, 'workerFactory'> & {
	readonly workerName?: string;
	readonly workerFactory?: (name: string) => OpfsWorkerLike;
};
interface FinishedProjectLock { release(): void; readonly finished: Promise<unknown>; }

test('owns only the opaque generic API and exact dormant Framescaper profile', () => {
	assert.deepEqual(Object.keys(projectStorageProfileModule).sort(), [
		'createEditorProjectStorageProfile',
		'editorProjectStorageProfileNames',
	]);
	assert.deepEqual(Object.keys(framescaperStorageProfileModule), [PROFILE_EXPORT]);
	assert.deepEqual(editorProjectStorageProfileNames(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE), FRAME_NAMES);
	assert.equal(Object.isFrozen(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE), true);
	assert.equal(Object.getPrototypeOf(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE), null);
	assert.deepEqual(Reflect.ownKeys(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE), []);
});
test('creates fresh opaque tokens over one detached frozen names snapshot', () => {
	const input = names();
	const first = createEditorProjectStorageProfile(input);
	const second = createEditorProjectStorageProfile(names());
	const snapshot = editorProjectStorageProfileNames(first);
	assert.notEqual(first, second);
	assert.deepEqual(snapshot, editorProjectStorageProfileNames(second));
	assert.equal(editorProjectStorageProfileNames(first), snapshot);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.notEqual(snapshot, input);
	(input as unknown as Record<string, unknown>).databaseName = 'mutated';
	assert.equal(snapshot.databaseName, FRAME_NAMES.databaseName);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.getPrototypeOf(first), null);
	assert.deepEqual(Reflect.ownKeys(first), []);

	const nullPrototype = Object.assign(Object.create(null) as Record<string, string>, names());
	assert.deepEqual(editorProjectStorageProfileNames(createEditorProjectStorageProfile(nullPrototype)), FRAME_NAMES);
});
test('snapshots closed name descriptors exactly once without ordinary gets', () => {
	const hits = { prototype: 0, keys: 0, descriptors: 0, gets: 0 };
	const target = names();
	const input = new Proxy(target, {
		getPrototypeOf(value) { hits.prototype += 1; return Reflect.getPrototypeOf(value); },
		ownKeys(value) { hits.keys += 1; return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) { hits.descriptors += 1;
			return Reflect.getOwnPropertyDescriptor(value, key); },
		get() { hits.gets += 1; throw new Error('ordinary get invoked'); },
	});
	const profile = createEditorProjectStorageProfile(input);
	assert.deepEqual(hits, { prototype: 1, keys: 1, descriptors: 4, gets: 0 });
	(target as unknown as Record<string, unknown>).databaseName = 'changed-after-capture';
	assert.deepEqual(editorProjectStorageProfileNames(profile), FRAME_NAMES);

	let getters = 0;
	const accessor = names() as unknown as Record<string, unknown>;
	Object.defineProperty(accessor, 'databaseName', { enumerable: true,
		get() { getters += 1; return FRAME_NAMES.databaseName; } });
	assert.throws(() => createEditorProjectStorageProfile(accessor), /enumerable.*data|accessor/iu);
	assert.equal(getters, 0);
	assert.throws(() => createEditorProjectStorageProfile(new Proxy(names(), {
		ownKeys() { throw new Error('own keys failed'); } })), /own keys failed/u);
	assert.throws(() => createEditorProjectStorageProfile(new Proxy(names(), {
		getOwnPropertyDescriptor(value, key) {
			if (key === 'databaseName') return { configurable: true, enumerable: true, get: () => 'a' };
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
	})), /enumerable.*data|accessor/iu);
	for (const handler of [
		{ getPrototypeOf() { throw new Error('prototype failed'); } },
		{ getOwnPropertyDescriptor() { throw new Error('descriptor failed'); } },
	] satisfies ProxyHandler<EditorProjectStorageProfileNames>[]) {
		assert.throws(() => createEditorProjectStorageProfile(new Proxy(names(), handler)), /failed/u);
	}
	for (const handler of [
		{ getPrototypeOf() { return Array.prototype; } },
		{ ownKeys() { return ['databaseName']; } },
		{ getOwnPropertyDescriptor() { return undefined; } },
	] satisfies ProxyHandler<EditorProjectStorageProfileNames>[]) {
		assert.throws(() => createEditorProjectStorageProfile(new Proxy(names(), handler)), TypeError);
	}
});
test('refuses open, inherited, exotic, and malformed name records', () => {
	class NamesClass { databaseName = FRAME_NAMES.databaseName; opfsDirectoryName = FRAME_NAMES.opfsDirectoryName;
		opfsWorkerName = FRAME_NAMES.opfsWorkerName; projectLockPrefix = FRAME_NAMES.projectLockPrefix; }
	const missing = names();
	delete (missing as unknown as Record<string, unknown>).databaseName;
	const extra = { ...names(), extra: 'value' };
	const symbol = names() as unknown as Record<PropertyKey, unknown>;
	symbol[Symbol('extra')] = true;
	const nonEnumerable = names();
	Object.defineProperty(nonEnumerable, 'databaseName', {
		value: FRAME_NAMES.databaseName,
		enumerable: false,
	});
	for (const value of [
		null, undefined, false, 1, 'profile', Symbol('profile'), () => undefined, [],
		new NamesClass(), missing, extra, symbol, nonEnumerable,
	]) assert.throws(() => createEditorProjectStorageProfile(value), TypeError);
});
test('enforces every storage name grammar at its exact boundaries', () => {
	const plainFields = ['databaseName', 'opfsDirectoryName', 'opfsWorkerName'] as const;
	for (const field of plainFields) {
		for (const valid of ['a', 'a'.repeat(128)]) {
			assert.doesNotThrow(() => createEditorProjectStorageProfile(names({ [field]: valid })));
		}
		for (const invalid of [
			'', 'a'.repeat(129), '-a', 'a-', 'A', 'a b', 'a/b', 'a\\b', 'a.b', 'a:b', 'a\0b', 'ä',
		]) assert.throws(() => createEditorProjectStorageProfile(names({ [field]: invalid })), TypeError);
	}
	for (const valid of ['a:', `${'a'.repeat(127)}:`]) {
		assert.doesNotThrow(() => createEditorProjectStorageProfile(names({ projectLockPrefix: valid })));
	}
	for (const invalid of [
		'', ':', 'a', `${'a'.repeat(128)}:`, '-a:', 'a-:', 'A:', 'a b:', 'a/:',
		'a\\:', 'a.:', 'a:b:', 'a\0b:', 'ä:', 'a::',
	]) assert.throws(() => createEditorProjectStorageProfile(names({ projectLockPrefix: invalid })), TypeError);
});
test('authenticates only exact creator-issued identities without inspecting forgeries', () => {
	const authentic = createEditorProjectStorageProfile(names());
	class ForgedProfile {}
	assert.throws(() => editorProjectStorageProfileNames(Symbol('profile')), /authentic.*profile/iu);
	for (const target of [
		{}, Object.create(null) as object, [], () => undefined, new ForgedProfile(),
		{ ...authentic }, structuredClone(authentic), authentic as object,
	]) {
		const { proxy, hits } = zeroTrapProxy(target);
		assert.throws(() => editorProjectStorageProfileNames(proxy), /authentic.*profile/iu);
		assert.deepEqual(hits, [0, 0, 0, 0]);
	}
});
test('project-store profile admission is synchronous and all-or-nothing', () => {
	for (const legacy of [false, 1, 'legacy', Symbol('legacy')]) {
		assert.doesNotThrow(() => createProjectStore(legacy as never));
	}
	for (const profile of [{}, FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE]) {
		let poisonReads = 0;
		const options = { projectStorageProfile: profile } as Record<string, unknown>;
		Object.defineProperties(options, {
			indexedDB: { enumerable: true, get() { poisonReads += 1; throw new Error('indexedDB read'); } },
			databaseName: { enumerable: true, get() { poisonReads += 1; throw new Error('databaseName read'); } },
		});
		assert.throws(
			() => createProjectStore(options),
			profile === FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE ? /databaseName.*profile/iu : /authentic.*profile/iu,
		);
		assert.equal(poisonReads, 0);
	}
	let profileGetterReads = 0;
	const accessorOptions = Object.defineProperty({}, 'projectStorageProfile', {
		enumerable: true,
		get() { profileGetterReads += 1; return FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE; },
	});
	assert.throws(() => createProjectStore(accessorOptions), /projectStorageProfile.*data property/iu);
	assert.equal(profileGetterReads, 0);
	for (const profile of [{}, names(), { ...FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE }]) {
		let repositoryCalls = 0;
		assert.throws(() => createProjectStore({
			indexedDB: null,
			projectStorageProfile: profile,
			repositoryFactory: () => { repositoryCalls += 1; return repositoryFixture(); },
		}), /authentic.*profile/iu);
		assert.equal(repositoryCalls, 0);
	}
	for (const databaseName of [undefined, 'split-database']) {
		let repositoryCalls = 0;
		assert.throws(() => createProjectStore({
			indexedDB: null,
			projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
			databaseName,
			repositoryFactory: () => { repositoryCalls += 1; return repositoryFixture(); },
		}), /databaseName.*profile|profile.*databaseName/iu);
		assert.equal(repositoryCalls, 0);
	}
});
test('project-store threading preserves defaults and forwards one resolved profile', () => {
	const observed: ProfiledRepositoryOptions[] = [];
	const factory: StorageRepositoryFactory = (_port, options) => {
		observed.push(options as ProfiledRepositoryOptions);
		return repositoryFixture();
	};
	const legacy = createProjectStore({
		indexedDB: null, projectStorageProfile: undefined, databaseName: 'legacy-explicit', repositoryFactory: factory,
	});
	const profiled = createProjectStore({
		indexedDB: null, projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE, repositoryFactory: factory,
	});
	const rawBypass = new AudioEditorProjectStore({
		indexedDB: null, opfsDirectoryName: 'bypass-sources', opfsWorkerName: 'bypass-worker', repositoryFactory: factory,
	} as never);
	const inherited = createProjectStore(Object.assign(Object.create({ databaseName: 'inherited-refused' }) as object, {
		indexedDB: null, preferOpfs: false, projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
	}));
	assert.equal(legacy.databaseName, 'legacy-explicit');
	assert.equal(profiled.databaseName, FRAME_NAMES.databaseName);
	assert.equal(rawBypass.databaseName, 'kw-media-audio-editor');
	assert.equal(inherited.databaseName, FRAME_NAMES.databaseName);
	assert.deepEqual(observed.map(({ opfsDirectoryName, opfsWorkerName }) => ({
		opfsDirectoryName, opfsWorkerName,
	})), [
		{ opfsDirectoryName: 'audio-editor-sources', opfsWorkerName: 'soundscaper-opfs-storage' },
		{ opfsDirectoryName: FRAME_NAMES.opfsDirectoryName, opfsWorkerName: FRAME_NAMES.opfsWorkerName },
		{ opfsDirectoryName: 'audio-editor-sources', opfsWorkerName: 'soundscaper-opfs-storage' },
	]);
});
test('database and degraded-memory records are physically profile-local', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const opened: string[] = [];
	const instrumented = {
		...indexedDB,
		open(name: string, version: number) { opened.push(name); return indexedDB.open(name, version); },
	} as unknown as IDBFactory;
	const alternate = createEditorProjectStorageProfile(alternateNames('alternate'));
	const stores = [
		createProjectStore({ indexedDB: instrumented, memoryFallback: false, preferOpfs: false }),
		createProjectStore({ indexedDB: instrumented, memoryFallback: false, preferOpfs: false, projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE }),
		createProjectStore({ indexedDB: instrumented, memoryFallback: false, preferOpfs: false, projectStorageProfile: alternate }),
	];
	context.after(async () => Promise.all(stores.map((store) => store.close())));
	await Promise.all(stores.map((store) => store.ready()));
	assert.deepEqual(opened, ['kw-media-audio-editor', FRAME_NAMES.databaseName, alternateNames('alternate').databaseName]);
	await Promise.all(stores.map((store, index) => store.saveSetting('identity', index)));
	assert.deepEqual(await Promise.all(stores.map((store) => store.loadSetting('identity'))), [0, 1, 2]);

	const memoryA = createProjectStore({ indexedDB: null, preferOpfs: false, projectStorageProfile: createEditorProjectStorageProfile(alternateNames('memory-a')) });
	const memoryB = createProjectStore({ indexedDB: null, preferOpfs: false, projectStorageProfile: createEditorProjectStorageProfile(alternateNames('memory-b')) });
	context.after(async () => Promise.all([memoryA.close(), memoryB.close()]));
	await memoryA.saveSetting('identity', 'a');
	await memoryB.saveSetting('identity', 'b');
	await memoryA.clear();
	assert.equal(await memoryA.loadSetting('identity'), null);
	assert.equal(await memoryB.loadSetting('identity'), 'b');
});

test('OPFS directory and sync-worker names preserve defaults and accept explicit routing', async () => {
	const directories: string[] = [];
	const root = opfsRoot(directories);
	const legacy = new OpfsRepository({ preferOpfs: true, opfsRoot: root, syncWorkerClient: null });
	const profiled = new OpfsRepository({
		preferOpfs: true, opfsRoot: root, syncWorkerClient: null,
		opfsDirectoryName: FRAME_NAMES.opfsDirectoryName,
		opfsWorkerName: FRAME_NAMES.opfsWorkerName,
	} as ProfiledOpfsRepositoryOptions);
	await Promise.all([legacy.directory(), profiled.directory()]);
	assert.deepEqual(directories, ['audio-editor-sources', FRAME_NAMES.opfsDirectoryName]);

	const workers: string[] = [];
	for (const workerName of [undefined, FRAME_NAMES.opfsWorkerName]) {
		const options: ProfiledWorkerClientOptions = {
			...(workerName ? { workerName } : {}),
			workerFactory: (name: string) => { workers.push(name); return new HandshakeWorker(); },
		};
		const client = new OpfsSyncWorkerClient(options as unknown as OpfsSyncWorkerClientOptions);
		assert.equal(await client.initialize({} as FileSystemDirectoryHandle), false);
	}
	assert.deepEqual(workers, ['soundscaper-opfs-storage', FRAME_NAMES.opfsWorkerName]);
	legacy.close();
	profiled.close();
});

test('the default worker factory forwards the resolved module-worker name', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	const observed: Array<Readonly<Record<string, unknown>>> = [];
	class CapturedWorker extends HandshakeWorker {
		constructor(_url: URL, options: Readonly<Record<string, unknown>>) { super(); observed.push(options); }
	}
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: CapturedWorker });
	try {
		for (const workerName of [undefined, FRAME_NAMES.opfsWorkerName]) {
			const options: ProfiledWorkerClientOptions = { ...(workerName ? { workerName } : {}) };
			const client = new OpfsSyncWorkerClient(options as OpfsSyncWorkerClientOptions);
			assert.equal(await client.initialize({} as FileSystemDirectoryHandle), false);
		}
		const repository = new OpfsRepository({
			preferOpfs: true,
			opfsRoot: opfsRoot([]),
			opfsWorkerName: FRAME_NAMES.opfsWorkerName,
		});
		await repository.planBinaryWriter('profile-route');
		repository.close();
	} finally {
		if (previous) Object.defineProperty(globalThis, 'Worker', previous);
		else Reflect.deleteProperty(globalThis, 'Worker');
	}
	assert.deepEqual(observed, [
		{ type: 'module', name: 'soundscaper-opfs-storage' },
		{ type: 'module', name: FRAME_NAMES.opfsWorkerName },
		{ type: 'module', name: FRAME_NAMES.opfsWorkerName },
	]);
});

test('navigator and fallback locks use only the resolved profile prefix', async () => {
	const navigatorNames: string[] = [];
	const navigatorChannels: string[] = [];
	class NavigatorChannel {
		onmessage: ((event: { readonly data: Record<string, unknown> }) => void) | null = null;
		constructor(name: string) { navigatorChannels.push(name); }
		postMessage(): void {}
		close(): void {}
	}
	const locks = {
		request(name: string, options: Record<string, unknown>, callback: (lock: object | null) => unknown) {
			navigatorNames.push(name);
			if (options.ifAvailable && name.endsWith('queued')) return callback(null);
			if (options.steal && name.endsWith('forced-retry')) return callback(null);
			return callback({ name });
		},
	};
	const undefinedProfile = await acquireProjectLock('undefined-profile', {
		projectStorageProfile: undefined, navigator: { locks }, BroadcastChannel: null,
	}) as FinishedProjectLock;
	undefinedProfile.release();
	await undefinedProfile.finished;
	const legacy = await acquireProjectLock('legacy', {
		navigator: { locks }, BroadcastChannel: null,
	}) as FinishedProjectLock;
	legacy.release();
	await legacy.finished;
	const inherited = await acquireProjectLock('inherited-profile', Object.assign(
		Object.create({ projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE }) as object,
		{ navigator: { locks }, BroadcastChannel: null },
	)) as FinishedProjectLock;
	inherited.release();
	await inherited.finished;
	const queued = await acquireProjectLock('queued', {
		projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		navigator: { locks }, BroadcastChannel: NavigatorChannel, navigatorLockHandoffMs: 0,
	}) as FinishedProjectLock;
	queued.release();
	await queued.finished;
	const forced = await acquireProjectLock('forced', {
		projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		navigator: { locks }, BroadcastChannel: NavigatorChannel, force: true,
	}) as FinishedProjectLock;
	forced.release();
	await forced.finished;
	const forcedRetry = await acquireProjectLock('forced-retry', {
		projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		navigator: { locks }, BroadcastChannel: NavigatorChannel, force: true,
	}) as FinishedProjectLock;
	forcedRetry.release();
	await forcedRetry.finished;
	assert.deepEqual(navigatorNames, [
		'kw-media-audio-editor-lock:undefined-profile',
		'kw-media-audio-editor-lock:legacy',
		'kw-media-audio-editor-lock:inherited-profile',
		`${FRAME_NAMES.projectLockPrefix}queued`, `${FRAME_NAMES.projectLockPrefix}queued`,
		`${FRAME_NAMES.projectLockPrefix}forced`,
		`${FRAME_NAMES.projectLockPrefix}forced-retry`, `${FRAME_NAMES.projectLockPrefix}forced-retry`,
	]);
	assert.deepEqual(navigatorChannels, [
		`${FRAME_NAMES.projectLockPrefix}queued`,
		`${FRAME_NAMES.projectLockPrefix}forced`,
		`${FRAME_NAMES.projectLockPrefix}forced-retry`,
	]);

	const fallback = new FallbackLockFixture();
	const owner = await acquireProjectLock('lease', fallback.options(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE));
	const contender = await acquireProjectLock('lease', fallback.options(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE));
	assert.equal(owner.readOnly, false);
	assert.equal(contender.readOnly, true);
	const takeover = await acquireProjectLock('lease', {
		...fallback.options(FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE), force: true,
	});
	assert.equal(takeover.readOnly, false);
	fallback.pulse();
	assert.ok(fallback.storageKeys.every((key) => key === `${FRAME_NAMES.projectLockPrefix}lease`));
	assert.ok(fallback.channelNames.every((name) => name === `${FRAME_NAMES.projectLockPrefix}lease`));
	owner.release();
	takeover.release();
});

test('lock profile forgeries fail before navigator, lease, or channel observation', async () => {
	let observations = 0;
	const poison = () => { observations += 1; throw new Error('side effect'); };
	const { proxy, hits } = zeroTrapProxy(names());
	await assert.rejects(acquireProjectLock('forged', {
		projectStorageProfile: proxy,
		navigator: { locks: { request: poison } },
		localStorage: { getItem: poison, setItem: poison, removeItem: poison },
		BroadcastChannel: class { constructor() { poison(); } },
	}), /authentic.*profile/iu);
	assert.equal(observations, 0);
	assert.deepEqual(hits, [0, 0, 0, 0]);
	let getterReads = 0;
	const accessor = Object.defineProperty({}, 'projectStorageProfile', {
		get() { getterReads += 1; return FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE; },
	});
	await assert.rejects(acquireProjectLock('accessor', accessor), /projectStorageProfile.*data property/iu);
	assert.equal(getterReads, 0);
});

test('the exact Framescaper selector remains isolated across maintained product owners', async () => {
	const files = await sourceFiles(['src', 'desktop', 'scripts', 'tests']);
	const references: string[] = [];
	const literalOwners = new Set<string>();
	for (const file of files) {
		const source = await readFile(resolve(ROOT, file), 'utf8');
		if (source.includes(PROFILE_EXPORT)) references.push(file);
		if ((Object.values(FRAME_NAMES) as string[]).some((value) => source.includes(value))) literalOwners.add(file);
	}
	assert.deepEqual(references, [
		PREREQUISITE_MODULE,
		'src/framescaper/editor-project-runtime-v18-selection.ts',
		PRODUCT_MODULE,
		'tests/audio-editor-framescaper-project-environment-v18.test.ts',
		PREREQUISITE_TEST_MODULE,
		TEST_MODULE,
	]);
	assert.deepEqual([...literalOwners], [
		'desktop/project-library-v10-contract.ts',
		PRODUCT_MODULE,
		TEST_MODULE,
		'tests/audio-editor-framescaper-project-store-v18.test.ts',
		'tests/browser/editor-products.spec.js',
		'tests/desktop-project-library-v10-contract.test.ts',
		'tests/desktop-project-library-v10-proxy-media-inventory.test.ts',
		'tests/helpers/framescaper-v18-archive-fixture.ts',
	]);
	const genericSource = await readFile(resolve(ROOT, 'src/common/editor/storage/project-storage-profile.ts'), 'utf8');
	assert.doesNotMatch(genericSource, /framescaper/iu);
});

test('statically threads the opt-in profile while retaining exact legacy identity owners', async () => {
	const [storage, repositories, opfs, bridge, worker, lock] = await Promise.all([
		'src/common/editor/storage.js', 'src/common/editor/storage/repositories.ts',
		'src/common/editor/storage/opfs-repository.ts', 'src/common/editor/storage/opfs-sync-repository-bridge.ts',
		'src/common/editor/storage/opfs-sync-worker-client.ts', 'src/common/editor/project-lock.js',
	].map(readSource));
	assert.match(storage, /projectStorageProfile/u);
	assert.match(storage, /bindEditorProjectStoreProfileFromOptions/u);
	assert.match(storage, /opfsDirectoryName/u);
	assert.match(storage, /opfsWorkerName/u);
	assert.match(repositories, /opfsDirectoryName/u);
	assert.match(repositories, /opfsWorkerName/u);
	assert.match(opfs, /opfsDirectoryName/u);
	assert.match(opfs, /opfsWorkerName/u);
	assert.match(bridge, /workerName/u);
	assert.match(worker, /workerName/u);
	assert.match(worker, /workerFactory\([^)]*workerName[^)]*\)/u);
	assert.match(lock, /projectStorageProfile/u);
	assert.match(lock, /editorProjectStorageProfileNames/u);
	assert.equal(occurrences(storage, 'kw-media-audio-editor'), 1);
	assert.equal(occurrences(opfs, 'audio-editor-sources'), 1);
	assert.equal(occurrences(worker, 'soundscaper-opfs-storage'), 1);
	assert.equal(occurrences(lock, 'kw-media-audio-editor-lock:'), 1);
});

function names(overrides: Partial<EditorProjectStorageProfileNames> = {}): EditorProjectStorageProfileNames {
	return { ...FRAME_NAMES, ...overrides };
}

function alternateNames(identity: string): EditorProjectStorageProfileNames {
	return {
		databaseName: `${identity}-database`, opfsDirectoryName: `${identity}-sources`,
		opfsWorkerName: `${identity}-worker`, projectLockPrefix: `${identity}-lock:`,
	};
}

function repositoryFixture(): StorageRepositories {
	return {
		projects: {}, settings: {}, analysis: {}, sources: {}, media: {}, retention: {},
	} as unknown as StorageRepositories;
}

function opfsRoot(observed: string[]): FileSystemDirectoryHandle {
	const directory = { getFileHandle() {}, removeEntry() {} } as unknown as FileSystemDirectoryHandle;
	return {
		async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
			assert.deepEqual(options, { create: true });
			observed.push(name);
			return directory;
		},
	} as unknown as FileSystemDirectoryHandle;
}

class HandshakeWorker implements OpfsWorkerLike {
	#message: ((event: MessageEvent) => void) | null = null;
	postMessage(message: unknown): void {
		const request = message as { readonly id: string };
		queueMicrotask(() => this.#message?.({ data: {
			id: request.id, type: 'result', result: { supported: false },
		} } as MessageEvent));
	}
	addEventListener(type: string, listener: (event: MessageEvent) => void): void {
		if (type === 'message') this.#message = listener;
	}
	terminate(): void {}
}

class FallbackLockFixture {
	readonly values = new Map<string, string>();
	readonly storageKeys: string[] = [];
	readonly channelNames: string[] = [];
	readonly peers = new Map<string, Set<FakeChannel>>();
	readonly intervals: Array<() => void> = [];

	options(projectStorageProfile: EditorProjectStorageProfile) {
		return {
			projectStorageProfile,
			navigator: {},
			localStorage: {
				getItem: (key: string) => { this.storageKeys.push(key); return this.values.get(key) ?? null; },
				setItem: (key: string, value: string) => { this.storageKeys.push(key); this.values.set(key, value); },
				removeItem: (key: string) => { this.storageKeys.push(key); this.values.delete(key); },
			},
			BroadcastChannel: fakeBroadcastChannelClass(this),
			now: () => 100,
			setTimeout: (callback: () => void) => { callback(); return 1; },
			setInterval: (callback: () => void) => { this.intervals.push(callback); return 1; },
			clearInterval: () => undefined,
		};
	}

	pulse(): void { for (const callback of this.intervals) callback(); }
}

function fakeBroadcastChannelClass(fixture: FallbackLockFixture): typeof FakeChannel {
	return class extends FakeChannel {
		constructor(name: string) { super(name, fixture); }
	};
}

class FakeChannel {
	onmessage: ((event: { readonly data: Record<string, unknown> }) => void) | null = null;
	constructor(readonly name: string, readonly fixture: FallbackLockFixture) {
		fixture.channelNames.push(name);
		const peers = fixture.peers.get(name) ?? new Set<FakeChannel>();
		peers.add(this);
		fixture.peers.set(name, peers);
	}
	postMessage(data: Record<string, unknown>): void {
		for (const peer of this.fixture.peers.get(this.name) ?? []) {
			if (peer !== this) peer.onmessage?.({ data });
		}
	}
	close(): void { this.fixture.peers.get(this.name)?.delete(this); }
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();

	async function visit(relative: string): Promise<void> {
		for (const entry of await readdir(resolve(ROOT, relative), { withFileTypes: true })) {
			const child = `${relative}/${entry.name}`;
			if (entry.isDirectory()) await visit(child);
			else if (/\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(entry.name)) output.push(child);
		}
	}
}

async function readSource(relative: string): Promise<string> { return readFile(resolve(ROOT, relative), 'utf8'); }
function occurrences(source: string, value: string): number { return source.split(value).length - 1; }

function zeroTrapProxy<T extends object>(target: T): { readonly proxy: T; readonly hits: number[] } {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0]! += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1]! += 1; throw new Error('keys trap'); },
		getOwnPropertyDescriptor() { hits[2]! += 1; throw new Error('descriptor trap'); },
		get() { hits[3]! += 1; throw new Error('get trap'); },
	}), hits };
}
