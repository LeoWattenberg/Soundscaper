/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createEditorProjectRuntimeProfilePrerequisite,
	editorProjectRuntimeProfilePrerequisiteDefinition,
	type EditorProjectRuntimeProfilePrerequisite,
	type EditorProjectRuntimeProfilePrerequisiteDefinition,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import * as prerequisiteModule from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from '../src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
import * as framescaperPrerequisiteModule from '../src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
import {
	FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
} from '../src/framescaper/editor-project-storage-profile-v18.ts';
import type { EditorProjectStorageProfile } from '../src/common/editor/storage/project-storage-profile.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GENERIC_MODULE = 'src/common/editor/project-runtime-profile-prerequisite.ts';
const PRODUCT_MODULE = 'src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
const FINAL_PRODUCT_MODULE = 'src/framescaper/editor-project-runtime-profile-' + 'v18.ts';
const TEST_MODULE = 'tests/audio-editor-framescaper-project-runtime-profile-prerequisite.test.ts';
const FINAL_TEST_MODULE = 'tests/audio-editor-framescaper-project-runtime-profile.test.ts';
const RUNTIME_EXPORT = 'FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE';
const STORAGE_EXPORT = 'FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE';
const DEFINITION_FIELDS = [
	'owner', 'projectSchemaVersion', 'storageProfile', 'priorSchemaPolicy',
	'futureSchemaPolicy', 'scapeFormatVersions', 'attachedScapeFormatVersion',
	'desktopLibrarySchemaVersion', 'desktopProjectSchemaVersion',
	'desktopDatabaseUserVersion', 'desktopLibraryScope',
] as const;

type Definition = EditorProjectRuntimeProfilePrerequisiteDefinition;
type MutableRecord = Record<PropertyKey, unknown>;
interface TrapHits { prototype: number; keys: number; descriptors: number; gets: number; }
type StructuralTokenIsAssignable = Readonly<Record<never, never>> extends
	EditorProjectRuntimeProfilePrerequisite ? true : false;
type AssertFalse<Value extends false> = Value;

test('owns exactly four TypeScript declarations, two runtime exports, and one product singleton', async () => {
	assert.deepEqual(Object.keys(prerequisiteModule).sort(), [
		'createEditorProjectRuntimeProfilePrerequisite',
		'editorProjectRuntimeProfilePrerequisiteDefinition',
	]);
	assert.deepEqual(Object.keys(framescaperPrerequisiteModule), [RUNTIME_EXPORT]);
	const source = await readSource(GENERIC_MODULE);
	const declarations = [...source.matchAll(
		/^export\s+(?:declare\s+)?(?:interface|type|function|class|const)\s+([A-Za-z0-9_]+)/gmu,
	)].map((match) => match[1]);
	assert.deepEqual(declarations, [
		'EditorProjectRuntimeProfilePrerequisiteDefinition',
		'EditorProjectRuntimeProfilePrerequisite',
		'createEditorProjectRuntimeProfilePrerequisite',
		'editorProjectRuntimeProfilePrerequisiteDefinition',
	]);
	assert.doesNotMatch(source, /export\s+(?:type\s+)?\{/u);
});

test('the exact Framescaper singleton owns all literals and the exact c-c0 identity', () => {
	const profile: EditorProjectRuntimeProfilePrerequisite = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE;
	assert.equal(Object.isFrozen(profile), true);
	assert.equal(Object.getPrototypeOf(profile), null);
	assert.deepEqual(Reflect.ownKeys(profile), []);
	const snapshot = editorProjectRuntimeProfilePrerequisiteDefinition(profile);
	assert.deepEqual(ordinaryDefinition(snapshot), definition());
	assert.equal(snapshot.storageProfile, FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE);
	const snapshotKeys = Reflect.ownKeys(snapshot);
	assert.ok(snapshotKeys.every((key) => typeof key === 'string'));
	assert.deepEqual((snapshotKeys as string[]).sort(), [...DEFINITION_FIELDS].sort());
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.scapeFormatVersions), true);
	assert.equal(Object.isFrozen(snapshot.desktopLibraryScope), true);
});

test('creates fresh opaque identities over detached deeply frozen definitions', () => {
	const input = definition();
	const inputFormats = input.scapeFormatVersions as number[];
	const inputScope = input.desktopLibraryScope as string[];
	const first = createEditorProjectRuntimeProfilePrerequisite(input);
	const second = createEditorProjectRuntimeProfilePrerequisite(definition());
	const snapshot = editorProjectRuntimeProfilePrerequisiteDefinition(first);
	assert.notEqual(first, second);
	assert.equal(editorProjectRuntimeProfilePrerequisiteDefinition(first), snapshot);
	assert.deepEqual(snapshot, editorProjectRuntimeProfilePrerequisiteDefinition(second));
	assert.notEqual(snapshot, input);
	assert.notEqual(snapshot.scapeFormatVersions, inputFormats);
	assert.notEqual(snapshot.desktopLibraryScope, inputScope);
	assert.equal(snapshot.storageProfile, FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE);
	(input as unknown as MutableRecord).owner = 'changed';
	inputFormats[0] = 9;
	inputScope[0] = 'changed';
	assert.equal(snapshot.owner, 'framescaper');
	assert.deepEqual(snapshot.scapeFormatVersions, [1, 2]);
	assert.deepEqual(snapshot.desktopLibraryScope, ['kw.media', 'scape-project-library', 'v10']);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.getPrototypeOf(first), null);
	assert.deepEqual(Reflect.ownKeys(first), []);

	const nullPrototype = Object.assign(Object.create(null) as MutableRecord, definition());
	assert.deepEqual(
		ordinaryDefinition(editorProjectRuntimeProfilePrerequisiteDefinition(
			createEditorProjectRuntimeProfilePrerequisite(nullPrototype),
		)),
		definition(),
	);
});

test('descriptor-snapshots the closed top level and nested arrays without ordinary gets', () => {
	const topHits = zeroHits();
	const formatProbe = descriptorProbe([1, 2]);
	const scopeProbe = descriptorProbe(['kw.media', 'scape-project-library', 'v10']);
	const target = definition({
		scapeFormatVersions: formatProbe.proxy,
		desktopLibraryScope: scopeProbe.proxy,
	});
	const input = new Proxy(target, descriptorHandler(topHits));
	const profile = createEditorProjectRuntimeProfilePrerequisite(input);
	assert.deepEqual(topHits, { prototype: 1, keys: 1, descriptors: 11, gets: 0 });
	assert.deepEqual(formatProbe.hits, { prototype: 1, keys: 1, descriptors: 3, gets: 0 });
	assert.deepEqual(scopeProbe.hits, { prototype: 1, keys: 1, descriptors: 4, gets: 0 });
	(target as unknown as MutableRecord).owner = 'mutated';
	formatProbe.target[0] = 9;
	scopeProbe.target[0] = 'mutated';
	assert.deepEqual(ordinaryDefinition(editorProjectRuntimeProfilePrerequisiteDefinition(profile)), definition());

	let getters = 0;
	const accessor = definition() as unknown as MutableRecord;
	Object.defineProperty(accessor, 'owner', {
		enumerable: true,
		get() { getters += 1; return 'framescaper'; },
	});
	assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(accessor), TypeError);
	assert.equal(getters, 0);
});

test('authenticates storage before any nested-array trap or candidate observation', () => {
	for (const storageTarget of [
		{},
		FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
	]) {
		const storage = zeroTrapProxy(storageTarget);
		const formats = poisonArray();
		const scope = poisonArray();
		const topHits = zeroHits();
		const input = new Proxy(definition({
			storageProfile: storage.proxy as unknown as EditorProjectStorageProfile,
			scapeFormatVersions: formats.proxy as unknown as readonly number[],
			desktopLibraryScope: scope.proxy as unknown as readonly string[],
		}), descriptorHandler(topHits));
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(input), TypeError);
		assert.deepEqual(topHits, { prototype: 1, keys: 1, descriptors: 11, gets: 0 });
		assert.deepEqual(storage.hits, [0, 0, 0, 0]);
		assert.deepEqual(formats.hits, [0, 0, 0, 0]);
		assert.deepEqual(scope.hits, [0, 0, 0, 0]);
	}
});

test('refuses open, inherited, exotic, accessor, and malformed definitions', () => {
	class DefinitionClass { owner = 'framescaper'; }
	const symbol = definition() as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const value of [
		null, undefined, false, 1, 'profile', Symbol('profile'), () => undefined, [],
		new DefinitionClass(), Object.create(definition()), { ...definition(), extra: true }, symbol,
	]) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(value), TypeError);
	let getters = 0;
	for (const field of DEFINITION_FIELDS) {
		const missing = definition() as unknown as MutableRecord;
		delete missing[field];
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(missing), TypeError);
		const nonEnumerable = definition() as unknown as MutableRecord;
		Object.defineProperty(nonEnumerable, field, {
			value: nonEnumerable[field], enumerable: false,
		});
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(nonEnumerable), TypeError);
		const accessor = definition() as unknown as MutableRecord;
		Object.defineProperty(accessor, field, {
			enumerable: true,
			get() { getters += 1; return definition()[field]; },
		});
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(accessor), TypeError);
	}
	assert.equal(getters, 0);
});

test('propagates descriptor traps and refuses nonconforming top-level proxy results', () => {
	for (const [handler, pattern] of [
		[{ getPrototypeOf() { throw new Error('prototype failed'); } }, /prototype failed/u],
		[{ ownKeys() { throw new Error('keys failed'); } }, /keys failed/u],
		[{ getOwnPropertyDescriptor() { throw new Error('descriptor failed'); } }, /descriptor failed/u],
	] as const) {
		assert.throws(
			() => createEditorProjectRuntimeProfilePrerequisite(new Proxy(definition(), handler)),
			pattern,
		);
	}
	for (const handler of [
		{ getPrototypeOf() { return Array.prototype; } },
		{ ownKeys() { return ['owner']; } },
		{ getOwnPropertyDescriptor() { return undefined; } },
	] satisfies ProxyHandler<Definition>[]) {
		assert.throws(
			() => createEditorProjectRuntimeProfilePrerequisite(new Proxy(definition(), handler)),
			TypeError,
		);
	}
});

test('enforces owner, policy, and positive-safe-version laws', () => {
	for (const owner of ['a', 'a-', 'a-1', 'a'.repeat(64)]) {
		assert.doesNotThrow(() => createEditorProjectRuntimeProfilePrerequisite(definition({ owner })));
	}
	for (const owner of ['', 'a'.repeat(65), '1a', 'A', 'a_b', 'a.b', 'a b', 'ä']) {
		assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({ owner })), TypeError);
	}
	for (const [field, value] of [
		['priorSchemaPolicy', 'migrate'],
		['futureSchemaPolicy', 'writable'],
	] as const) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(
		definition({ [field]: value } as unknown as Partial<Definition>),
	), TypeError);

	const versionFields = [
		'projectSchemaVersion', 'attachedScapeFormatVersion', 'desktopLibrarySchemaVersion',
		'desktopProjectSchemaVersion', 'desktopDatabaseUserVersion',
	] as const;
	for (const field of versionFields) {
		for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '18', null]) {
			assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
				[field]: invalid,
			} as unknown as Partial<Definition>)), TypeError);
		}
	}
	assert.doesNotThrow(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		projectSchemaVersion: 1, desktopProjectSchemaVersion: 1,
	})));
	assert.doesNotThrow(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		projectSchemaVersion: Number.MAX_SAFE_INTEGER,
		desktopProjectSchemaVersion: Number.MAX_SAFE_INTEGER,
		desktopLibrarySchemaVersion: Number.MAX_SAFE_INTEGER,
		desktopDatabaseUserVersion: Number.MAX_SAFE_INTEGER,
		scapeFormatVersions: [Number.MAX_SAFE_INTEGER],
		attachedScapeFormatVersion: Number.MAX_SAFE_INTEGER,
	})));
	assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		projectSchemaVersion: 19,
	})), TypeError);
});

test('enforces Scape format density, order, uniqueness, bounds, and attachment membership', () => {
	for (const [formats, attached] of [
		[[1], 1],
		[[1, 3], 3],
		[Array.from({ length: 16 }, (_, index) => index + 1), 16],
	] as const) assert.doesNotThrow(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		scapeFormatVersions: formats, attachedScapeFormatVersion: attached,
	})));
	for (const [formats, attached] of [
		[[], 1], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 17],
		[[1, 1], 1], [[2, 1], 1], [[0, 1], 1], [[-1, 1], 1], [[1.5, 2], 2],
		[[1, Number.MAX_SAFE_INTEGER + 1], 1], [[1, 2], 3], [['1', 2], 2],
	] as const) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		scapeFormatVersions: formats as unknown as readonly number[],
		attachedScapeFormatVersion: attached,
	})), TypeError);
});

test('enforces desktop scope grammar and exact boundaries', () => {
	for (const scope of [
		['a'], ['a'.repeat(128)], ['kw.media', 'scape-project-library', 'v10'],
		['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
	]) assert.doesNotThrow(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		desktopLibraryScope: scope,
	})));
	for (const scope of [
		[], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], [''], ['a'.repeat(129)],
		['A'], ['-a'], ['a-'], ['.a'], ['a.'], ['a b'], ['a/b'], ['a_b'], ['a:b'],
		['a\0b'], ['ä'], [1],
	]) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
		desktopLibraryScope: scope as unknown as readonly string[],
	})), TypeError);
});

test('refuses non-plain, sparse, accessor, extra-key, symbol, and trapping nested arrays', () => {
	for (const field of ['scapeFormatVersions', 'desktopLibraryScope'] as const) {
		const base = field === 'scapeFormatVersions' ? [1, 2] : ['kw.media', 'v10'];
		const hole = Array(2) as unknown[];
		hole[0] = base[0];
		const extra = [...base] as unknown[] & { extra?: boolean };
		extra.extra = true;
		const symbol = [...base] as unknown[];
		(symbol as unknown as MutableRecord)[Symbol('extra')] = true;
		const nonEnumerable = [...base] as unknown[];
		Object.defineProperty(nonEnumerable, '0', { value: base[0], enumerable: false });
		const foreignPrototype = [...base] as unknown[];
		Object.setPrototypeOf(foreignPrototype, null);
		let getters = 0;
		const accessor = [...base] as unknown[];
		Object.defineProperty(accessor, '0', {
			enumerable: true,
			get() { getters += 1; return base[0]; },
		});
		for (const value of [
			{}, { 0: base[0], length: 1 }, hole, extra, symbol, nonEnumerable,
			foreignPrototype, accessor,
		]) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
			[field]: value,
		} as unknown as Partial<Definition>)), TypeError);
		assert.equal(getters, 0);
		for (const [handler, pattern] of [
			[{ getPrototypeOf() { throw new Error('array prototype failed'); } }, /array prototype failed/u],
			[{ ownKeys() { throw new Error('array keys failed'); } }, /array keys failed/u],
			[{ getOwnPropertyDescriptor() { throw new Error('array descriptor failed'); } }, /array descriptor failed/u],
		] as const) assert.throws(() => createEditorProjectRuntimeProfilePrerequisite(definition({
			[field]: new Proxy([...base], handler),
		} as unknown as Partial<Definition>)), pattern);
		for (const handler of [
			{ getPrototypeOf() { return Object.prototype; } },
			{ ownKeys(target) { return Reflect.ownKeys(target).filter((key) => key !== '0'); } },
			{ getOwnPropertyDescriptor(target, key) {
				const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
				return key === 'length' && descriptor ? { ...descriptor, value: 99 } : descriptor;
			} },
			{ getOwnPropertyDescriptor(target, key) {
				return key === '0' ? undefined : Reflect.getOwnPropertyDescriptor(target, key);
			} },
		] satisfies ProxyHandler<unknown[]>[]) assert.throws(
			() => createEditorProjectRuntimeProfilePrerequisite(definition({
				[field]: new Proxy([...base] as unknown[], handler),
			} as unknown as Partial<Definition>)),
			TypeError,
		);
	}
});

test('authenticates only creator-issued prerequisite identities without observing forgeries', () => {
	const authentic = createEditorProjectRuntimeProfilePrerequisite(definition());
	const structured = structuredClone(authentic);
	for (const target of [
		{}, [], () => undefined, Object.create(null) as object, { ...authentic }, structured,
	]) {
		const { proxy, hits } = zeroTrapProxy(target);
		assert.throws(() => editorProjectRuntimeProfilePrerequisiteDefinition(proxy), TypeError);
		assert.deepEqual(hits, [0, 0, 0, 0]);
	}
	const wrapped = zeroTrapProxy(authentic);
	assert.throws(() => editorProjectRuntimeProfilePrerequisiteDefinition(wrapped.proxy), TypeError);
	assert.deepEqual(wrapped.hits, [0, 0, 0, 0]);
	for (const primitive of [null, undefined, false, 1, 'profile', Symbol('profile')]) {
		assert.throws(() => editorProjectRuntimeProfilePrerequisiteDefinition(primitive), TypeError);
	}
	assert.notEqual(
		createEditorProjectRuntimeProfilePrerequisite(definition()),
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	);
});

test('keeps the product prerequisite within maintained Framescaper and packaging owners', async () => {
	const files = await sourceFiles(['src', 'desktop', 'scripts', 'tests']);
	const runtimeReferences: string[] = [];
	const runtimeModulePathReferences: string[] = [];
	const storageReferences: string[] = [];
	for (const file of files) {
		const source = await readSource(file);
		if (source.includes(RUNTIME_EXPORT)) runtimeReferences.push(file);
		if (source.includes('editor-project-runtime-profile-v18-prerequisite')) {
			runtimeModulePathReferences.push(file);
		}
		if (source.includes(STORAGE_EXPORT)) storageReferences.push(file);
	}
	assert.deepEqual(runtimeReferences, [
		PRODUCT_MODULE, FINAL_PRODUCT_MODULE, TEST_MODULE, FINAL_TEST_MODULE,
	]);
	assert.deepEqual(runtimeModulePathReferences, [
		'scripts/lib/desktop-project-library-runtime.mjs',
		FINAL_PRODUCT_MODULE,
		'tests/audio-editor-framescaper-project-feature-' + 'capability-profile.test.ts',
		TEST_MODULE,
		FINAL_TEST_MODULE,
		'tests/audio-editor-framescaper-project-storage-profile.test.ts',
		'tests/desktop-project-library-packaging.test.js',
	]);
	assert.deepEqual(storageReferences, [
		PRODUCT_MODULE,
		'src/framescaper/editor-project-runtime-v18-selection.ts',
		'src/framescaper/editor-project-storage-profile-v18.ts',
		'tests/audio-editor-framescaper-project-environment-v18.test.ts',
		TEST_MODULE,
		'tests/audio-editor-framescaper-project-storage-profile.test.ts',
		// The timing-probe smoke test reads the storage profile now rather than
		// repeating the database and OPFS names it needs.
		'tests/desktop-video-timing-probe-smoke.test.js',
	]);
	const genericSource = await readSource(GENERIC_MODULE);
	assert.deepEqual([...new Set(importSpecifiers(genericSource))], ['./storage/project-storage-profile.ts']);
	assert.doesNotMatch(genericSource, /framescaper|capabilityProfile|project-feature|productId/iu);
	for (const file of files.filter((file) => file.startsWith('src/common/') || file.startsWith('src/soundscaper/'))) {
		assert.doesNotMatch(await readSource(file), /editor-project-runtime-profile-v18-prerequisite/u, file);
	}
	const productSource = await readSource(PRODUCT_MODULE);
	assert.deepEqual([...new Set(importSpecifiers(productSource))].sort(), [
		'../common/editor/project-runtime-profile-prerequisite.ts',
		'./editor-project-storage-profile-v18.ts',
	]);
	assert.doesNotMatch(
		productSource,
		/productId|bootstrap|createProjectStore|acquireProjectLock|controller|archive|capabilityProfile/iu,
	);
});

function definition(overrides: Partial<Definition> = {}): Definition {
	return {
		owner: 'framescaper',
		projectSchemaVersion: 18,
		storageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 10,
		desktopProjectSchemaVersion: 18,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
		...overrides,
	};
}

function ordinaryDefinition(value: Definition): Definition {
	return { ...value };
}

function zeroHits(): TrapHits {
	return { prototype: 0, keys: 0, descriptors: 0, gets: 0 };
}

function descriptorHandler<T extends object>(hits: TrapHits): ProxyHandler<T> {
	return {
		getPrototypeOf(target) { hits.prototype += 1; return Reflect.getPrototypeOf(target); },
		ownKeys(target) { hits.keys += 1; return Reflect.ownKeys(target); },
		getOwnPropertyDescriptor(target, key) {
			hits.descriptors += 1;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
		get() { hits.gets += 1; throw new Error('ordinary get invoked'); },
	};
}

function descriptorProbe<T>(target: T[]): { readonly target: T[]; readonly proxy: T[]; readonly hits: TrapHits } {
	const hits = zeroHits();
	return { target, proxy: new Proxy(target, descriptorHandler(hits)), hits };
}

function zeroTrapProxy<T extends object>(target: T): { readonly proxy: T; readonly hits: number[] } {
	const hits = [0, 0, 0, 0];
	return {
		proxy: new Proxy(target, {
			getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
			ownKeys() { hits[1] += 1; throw new Error('key trap'); },
			getOwnPropertyDescriptor() { hits[2] += 1; throw new Error('descriptor trap'); },
			get() { hits[3] += 1; throw new Error('get trap'); },
		}),
		hits,
	};
}

function poisonArray(): { readonly proxy: unknown[]; readonly hits: number[] } {
	return zeroTrapProxy([]);
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();

	async function visit(relative: string): Promise<void> {
		const entries = await readdir(resolve(ROOT, relative), { withFileTypes: true });
		for (const entry of entries) {
			const child = `${relative}/${entry.name}`;
			if (entry.isDirectory()) await visit(child);
			else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) output.push(child);
		}
	}
}

async function readSource(relative: string): Promise<string> {
	return readFile(resolve(ROOT, relative), 'utf8');
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}

void (null as AssertFalse<StructuralTokenIsAssignable> | null);
