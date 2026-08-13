/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createEditorProjectRuntimeProfile,
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
	type EditorProjectRuntimeProfileDefinition,
} from '../src/common/editor/project-runtime-profile.ts';
import * as runtimeProfileModule from '../src/common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import * as framescaperRuntimeProfileModule from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createEditorProjectRuntimeProfilePrerequisite,
	editorProjectRuntimeProfilePrerequisiteDefinition,
	type EditorProjectRuntimeProfilePrerequisite,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from '../src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
	type EditorProjectFeatureCapabilityProfile,
} from '../src/common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v18.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GENERIC_MODULE = 'src/common/editor/project-runtime-profile.ts';
const PRODUCT_MODULE = 'src/framescaper/editor-project-runtime-profile-v18.ts';
const TEST_MODULE = 'tests/audio-editor-framescaper-project-runtime-profile.test.ts';
const PRODUCT_EXPORT = 'FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE';
const PRODUCT_MODULE_STEM = 'editor-project-runtime-profile-v18.ts';
const GENERIC_MODULE_STEM = 'project-runtime-profile.ts';
const DEFINITION_FIELDS = ['prerequisite', 'capabilityProfile'] as const;

type Definition = EditorProjectRuntimeProfileDefinition;
type MutableRecord = Record<PropertyKey, unknown>;
type StructuralTokenIsAssignable = Readonly<Record<never, never>> extends
	EditorProjectRuntimeProfile ? true : false;
type AssertFalse<Value extends false> = Value;

test('owns two type declarations, two runtime exports, and one exact product export', async () => {
	assert.deepEqual(Object.keys(runtimeProfileModule).sort(), [
		'createEditorProjectRuntimeProfile',
		'editorProjectRuntimeProfileDefinition',
	]);
	assert.deepEqual(Object.keys(framescaperRuntimeProfileModule), [PRODUCT_EXPORT]);
	const source = await readSource(GENERIC_MODULE);
	assert.deepEqual([...source.matchAll(
		/^export\s+(?:declare\s+)?(?:interface|type|function|class|const)\s+([A-Za-z0-9_]+)/gmu,
	)].map((match) => match[1]), [
		'EditorProjectRuntimeProfileDefinition',
		'EditorProjectRuntimeProfile',
		'createEditorProjectRuntimeProfile',
		'editorProjectRuntimeProfileDefinition',
	]);
	assert.doesNotMatch(source, /export\s+(?:type\s+)?\{/u);
});

test('the exact singleton retains both exact authenticated Framescaper children', () => {
	const profile: EditorProjectRuntimeProfile = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
	assert.equal(Object.isFrozen(profile), true);
	assert.equal(Object.getPrototypeOf(profile), null);
	assert.deepEqual(Reflect.ownKeys(profile), []);
	const snapshot = editorProjectRuntimeProfileDefinition(profile);
	assert.equal(snapshot.prerequisite, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE);
	assert.equal(snapshot.capabilityProfile, FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE);
	assert.equal(
		editorProjectRuntimeProfilePrerequisiteDefinition(snapshot.prerequisite).owner,
		'framescaper',
	);
	assert.equal(
		editorProjectFeatureCapabilityProfileDefinition(snapshot.capabilityProfile).owner,
		'framescaper',
	);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
	assert.deepEqual(Reflect.ownKeys(snapshot), DEFINITION_FIELDS);
	for (const field of DEFINITION_FIELDS) {
		assert.deepEqual(Object.getOwnPropertyDescriptor(snapshot, field), {
			value: snapshot[field], writable: false, enumerable: true, configurable: false,
		});
	}
});

test('creates fresh identities over one detached stable frozen pair', () => {
	const input = definition();
	const first = createEditorProjectRuntimeProfile(input);
	const second = createEditorProjectRuntimeProfile(definition());
	const snapshot = editorProjectRuntimeProfileDefinition(first);
	const secondSnapshot = editorProjectRuntimeProfileDefinition(second);
	assert.notEqual(first, second);
	assert.equal(editorProjectRuntimeProfileDefinition(first), snapshot);
	assert.notEqual(snapshot, secondSnapshot);
	assert.deepEqual(snapshot, secondSnapshot);
	assert.notEqual(snapshot, input);
	assert.equal(snapshot.prerequisite, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE);
	assert.equal(snapshot.capabilityProfile, FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE);
	(input as unknown as MutableRecord).prerequisite = {};
	assert.equal(snapshot.prerequisite, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.getPrototypeOf(first), null);
	assert.deepEqual(Reflect.ownKeys(first), []);
	const nullInput = Object.assign(Object.create(null) as MutableRecord, definition());
	assert.deepEqual(
		editorProjectRuntimeProfileDefinition(createEditorProjectRuntimeProfile(nullInput)),
		definition(),
	);
});

test('captures both descriptors in exact order without ordinary gets', () => {
	const events: string[] = [];
	const target = definition();
	const input = new Proxy(target, {
		getPrototypeOf(value) { events.push('prototype'); return Reflect.getPrototypeOf(value); },
		ownKeys(value) { events.push('keys'); return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) {
			events.push(`descriptor:${String(key)}`);
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
		get() { events.push('get'); throw new Error('ordinary get invoked'); },
	});
	const profile = createEditorProjectRuntimeProfile(input);
	assert.deepEqual(events, [
		'prototype', 'keys', 'descriptor:prerequisite', 'descriptor:capabilityProfile',
	]);
	(target as unknown as MutableRecord).capabilityProfile = {};
	assert.equal(
		editorProjectRuntimeProfileDefinition(profile).capabilityProfile,
		FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);

	let getterCalls = 0;
	const accessor = definition() as unknown as MutableRecord;
	Object.defineProperty(accessor, 'prerequisite', {
		enumerable: true,
		get() { getterCalls += 1; return FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE; },
	});
	assert.throws(() => createEditorProjectRuntimeProfile(accessor), TypeError);
	assert.equal(getterCalls, 0);
});

test('refuses every open, inherited, exotic, and malformed definition', () => {
	class DefinitionClass {
		prerequisite = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE;
		capabilityProfile = FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE;
	}
	const symbol = definition() as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const value of [
		null, undefined, false, 1, 'profile', Symbol('profile'), () => undefined, [],
		new DefinitionClass(), Object.create(definition()), { ...definition(), extra: true }, symbol,
	]) assert.throws(() => createEditorProjectRuntimeProfile(value), TypeError);
	for (const field of DEFINITION_FIELDS) {
		const missing = definition() as unknown as MutableRecord;
		delete missing[field];
		assert.throws(() => createEditorProjectRuntimeProfile(missing), TypeError);
		const hidden = definition() as unknown as MutableRecord;
		Object.defineProperty(hidden, field, { value: hidden[field], enumerable: false });
		assert.throws(() => createEditorProjectRuntimeProfile(hidden), TypeError);
		let calls = 0;
		const accessor = definition() as unknown as MutableRecord;
		Object.defineProperty(accessor, field, {
			enumerable: true, get() { calls += 1; return definition()[field]; },
		});
		assert.throws(() => createEditorProjectRuntimeProfile(accessor), TypeError);
		assert.equal(calls, 0);
	}
});

test('propagates definition traps and refuses nonconforming proxy results', () => {
	for (const trap of ['prototype', 'keys', 'descriptor'] as const) {
		const sentinel = new Error(`${trap} failed`);
		const handler: ProxyHandler<Definition> = trap === 'prototype'
			? { getPrototypeOf() { throw sentinel; } }
			: trap === 'keys'
				? { ownKeys() { throw sentinel; } }
				: { getOwnPropertyDescriptor() { throw sentinel; } };
		assert.throws(
			() => createEditorProjectRuntimeProfile(new Proxy(definition(), handler)),
			(error) => { assert.equal(error, sentinel); return true; },
		);
	}
	for (const handler of [
		{ getPrototypeOf() { return Array.prototype; } },
		{ ownKeys() { return ['prerequisite']; } },
		{ getOwnPropertyDescriptor() { return undefined; } },
	] satisfies ProxyHandler<Definition>[]) assert.throws(
		() => createEditorProjectRuntimeProfile(new Proxy(definition(), handler)), TypeError,
	);
});

test('authenticates children in order without observing forged identities', () => {
	const badPrerequisite = zeroTrapProxy({});
	const badCapability = zeroTrapProxy({});
	const events: string[] = [];
	const badDefinition = new Proxy(definition({
		prerequisite: badPrerequisite.proxy as EditorProjectRuntimeProfilePrerequisite,
		capabilityProfile: badCapability.proxy as EditorProjectFeatureCapabilityProfile,
	}), {
		getPrototypeOf(value) { events.push('prototype'); return Reflect.getPrototypeOf(value); },
		ownKeys(value) { events.push('keys'); return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) {
			events.push(`descriptor:${String(key)}`);
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
	});
	assert.throws(() => createEditorProjectRuntimeProfile(badDefinition), /prerequisite/iu);
	assert.deepEqual(events, [
		'prototype', 'keys', 'descriptor:prerequisite', 'descriptor:capabilityProfile',
	]);
	assert.deepEqual(badPrerequisite.hits, [0, 0, 0, 0]);
	assert.deepEqual(badCapability.hits, [0, 0, 0, 0]);

	const wrappedPrerequisite = zeroTrapProxy(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	);
	assert.throws(() => createEditorProjectRuntimeProfile(definition({
		prerequisite: wrappedPrerequisite.proxy,
	})), /prerequisite/iu);
	assert.deepEqual(wrappedPrerequisite.hits, [0, 0, 0, 0]);

	const wrappedCapability = zeroTrapProxy(
		FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	assert.throws(() => createEditorProjectRuntimeProfile(definition({
		capabilityProfile: wrappedCapability.proxy,
	})), /capability/iu);
	assert.deepEqual(wrappedCapability.hits, [0, 0, 0, 0]);

	for (const target of [
		{ ...FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE },
		structuredClone(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE),
	]) assert.throws(() => createEditorProjectRuntimeProfile(definition({
		prerequisite: target as EditorProjectRuntimeProfilePrerequisite,
	})), /prerequisite/iu);
	for (const target of [
		{ ...FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE },
		structuredClone(FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE),
	]) assert.throws(() => createEditorProjectRuntimeProfile(definition({
		capabilityProfile: target as EditorProjectFeatureCapabilityProfile,
	})), /capability/iu);
});

test('admits authentic same-owner children but owner and singleton authority stay exact', () => {
	const alternatePrerequisite = prerequisite('framescaper');
	const alternateCapability = capability('framescaper');
	const generic = createEditorProjectRuntimeProfile({
		prerequisite: alternatePrerequisite,
		capabilityProfile: alternateCapability,
	});
	assert.notEqual(generic, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	assert.equal(editorProjectRuntimeProfileDefinition(generic).prerequisite, alternatePrerequisite);
	assert.equal(editorProjectRuntimeProfileDefinition(generic).capabilityProfile, alternateCapability);
	const exactTupleAgain = createEditorProjectRuntimeProfile(definition());
	assert.notEqual(exactTupleAgain, FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	assert.throws(() => createEditorProjectRuntimeProfile({
		prerequisite: prerequisite('other'),
		capabilityProfile: FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
	}), /owner/iu);
	assert.doesNotThrow(() => createEditorProjectRuntimeProfile({
		prerequisite: prerequisite('other'),
		capabilityProfile: capability('other'),
	}));
});

test('authenticates only creator-issued final identities without candidate observation', () => {
	const authentic = createEditorProjectRuntimeProfile(definition());
	for (const target of [
		{}, [], () => undefined, Object.create(null) as object,
		{ ...authentic }, structuredClone(authentic), authentic as object,
	]) {
		const wrapped = zeroTrapProxy(target);
		assert.throws(() => editorProjectRuntimeProfileDefinition(wrapped.proxy), TypeError);
		assert.deepEqual(wrapped.hits, [0, 0, 0, 0]);
	}
	for (const value of [null, undefined, false, 1, 'profile', Symbol('profile')]) {
		assert.throws(() => editorProjectRuntimeProfileDefinition(value), TypeError);
	}
});

test('keeps final-profile consumption within the closed isolated V18 domain set', async () => {
	const files = await sourceFiles(['src', 'desktop', 'scripts', 'tests']);
	const exportReferences: string[] = [];
	const productPathReferences: string[] = [];
	const genericPathReferences: string[] = [];
	for (const file of files) {
		const source = await readSource(file);
		if (/\bFRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE\b/u.test(source)) {
			exportReferences.push(file);
		}
		if (source.includes(PRODUCT_MODULE_STEM)) productPathReferences.push(file);
		if (source.includes(GENERIC_MODULE_STEM)) genericPathReferences.push(file);
	}
	assert.deepEqual(exportReferences, [
		'desktop/project-library-v10-current-project.ts',
		'src/framescaper/editor-project-environment-v18.ts',
		PRODUCT_MODULE,
		'src/framescaper/editor-project-v18-profile.ts',
		'tests/audio-editor-framescaper-playback-project-v18.test.ts',
		'tests/audio-editor-framescaper-project-environment-v18.test.ts',
		'tests/audio-editor-framescaper-project-repository-v18.test.ts',
		TEST_MODULE,
		'tests/audio-editor-framescaper-project-runtime-v18-selection.test.ts',
		'tests/audio-editor-framescaper-project-store-v18.test.ts',
		'tests/audio-editor-framescaper-project-v18-claim-cleanup.test.ts',
		'tests/audio-editor-framescaper-project-v18-domain.test.ts',
		'tests/audio-editor-framescaper-project-v18-feature-requirements.test.ts',
		'tests/audio-editor-framescaper-project-v18-history.test.ts',
		'tests/audio-editor-framescaper-project-v18-preservation-repository.test.ts',
		'tests/audio-editor-framescaper-project-v18-retention.test.ts',
		'tests/audio-editor-framescaper-scape-bodies-v18.test.ts',
		'tests/audio-editor-framescaper-scape-envelope-v18.test.ts',
		'tests/audio-editor-framescaper-scape-file-v18.test.ts',
		'tests/audio-editor-framescaper-scape-preservation-v18.test.ts',
		'tests/desktop-project-library-v10-current-project.test.ts',
		'tests/desktop-project-library-v10-transport.test.ts',
		'tests/helpers/framescaper-v18-archive-fixture.ts',
	]);
	assert.deepEqual(productPathReferences, [
		'desktop/project-library-v10-current-project.ts',
		'src/framescaper/editor-project-environment-v18.ts',
		'src/framescaper/editor-project-v18-profile.ts',
		'tests/audio-editor-framescaper-playback-project-v18.test.ts',
		'tests/audio-editor-framescaper-project-environment-v18.test.ts',
		'tests/audio-editor-framescaper-project-repository-v18.test.ts',
		TEST_MODULE,
		'tests/audio-editor-framescaper-project-runtime-v18-selection.test.ts',
		'tests/audio-editor-framescaper-project-store-v18.test.ts',
		'tests/audio-editor-framescaper-project-v18-claim-cleanup.test.ts',
		'tests/audio-editor-framescaper-project-v18-domain.test.ts',
		'tests/audio-editor-framescaper-project-v18-feature-requirements.test.ts',
		'tests/audio-editor-framescaper-project-v18-history.test.ts',
		'tests/audio-editor-framescaper-project-v18-preservation-repository.test.ts',
		'tests/audio-editor-framescaper-project-v18-retention.test.ts',
		'tests/audio-editor-framescaper-scape-bodies-v18.test.ts',
		'tests/audio-editor-framescaper-scape-envelope-v18.test.ts',
		'tests/audio-editor-framescaper-scape-file-v18.test.ts',
		'tests/audio-editor-framescaper-scape-preservation-v18.test.ts',
		'tests/desktop-project-library-v10-current-project.test.ts',
		'tests/desktop-project-library-v10-transport.test.ts',
		'tests/helpers/framescaper-v18-archive-fixture.ts',
	]);
	assert.deepEqual(genericPathReferences, [
		'desktop/project-library-v10-current-project.ts',
		'src/framescaper/editor-project-feature-requirements-v18.ts',
		'src/framescaper/editor-project-playback-v18.ts',
		'src/framescaper/editor-project-repository-v18.ts',
		PRODUCT_MODULE,
		'src/framescaper/editor-project-runtime-v18-selection.ts',
		'src/framescaper/editor-project-store-v18.ts',
		'src/framescaper/editor-project-v18-archive-repository.ts',
		'src/framescaper/editor-project-v18-claim-cleanup-repository.ts',
		'src/framescaper/editor-project-v18-commands.ts',
		'src/framescaper/editor-project-v18-history.ts',
		'src/framescaper/editor-project-v18-migration.ts',
		'src/framescaper/editor-project-v18-preservation-repository.ts',
		'src/framescaper/editor-project-v18-profile.ts',
		'src/framescaper/editor-project-v18-retention.ts',
		'src/framescaper/editor-project-v18-runtime.ts',
		'src/framescaper/editor-project-v18-session.ts',
		'src/framescaper/editor-project-v18-validation.ts',
		'src/framescaper/editor-project-v18.ts',
		'src/framescaper/scape-project-envelope-v18.ts',
		'src/framescaper/scape-project-preservation-v18.ts',
		'tests/audio-editor-framescaper-project-feature-capability-profile.test.ts',
		TEST_MODULE,
		'tests/helpers/framescaper-v18-archive-fixture.ts',
	]);
	assert.deepEqual([...new Set(importSpecifiers(await readSource(GENERIC_MODULE)))].sort(), [
		'./project-feature-capability-profile.ts',
		'./project-runtime-profile-prerequisite.ts',
	]);
	assert.deepEqual([...new Set(importSpecifiers(await readSource(PRODUCT_MODULE)))].sort(), [
		'../common/editor/project-runtime-profile.ts',
		'./editor-project-feature-capability-profile-v18.ts',
		'./editor-project-runtime-profile-v18-prerequisite.ts',
	]);
	for (const file of files.filter((file) => file.startsWith('src/common/')
		|| file.startsWith('src/soundscaper/'))) {
		assert.doesNotMatch(await readSource(file), /editor-project-runtime-profile-v18\.ts/u, file);
	}
	const generic = await readSource(GENERIC_MODULE);
	assert.doesNotMatch(generic, /framescaper|soundscaper|productId|bootstrap|archive|controller|desktop|route/iu);
	const product = await readSource(PRODUCT_MODULE);
	assert.doesNotMatch(product,
		/productId|bootstrap|product\.js|project-feature-capabilities|storage-profile|archive|controller|desktop|route/iu);
});

function definition(overrides: Partial<Definition> = {}): Definition {
	return {
		prerequisite: FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
		capabilityProfile: FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
		...overrides,
	};
}

function prerequisite(owner: string): EditorProjectRuntimeProfilePrerequisite {
	const base = editorProjectRuntimeProfilePrerequisiteDefinition(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	);
	return createEditorProjectRuntimeProfilePrerequisite({
		...base,
		owner,
		scapeFormatVersions: [...base.scapeFormatVersions],
		desktopLibraryScope: [...base.desktopLibraryScope],
	});
}

function capability(owner: string): EditorProjectFeatureCapabilityProfile {
	const base = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	return createEditorProjectFeatureCapabilityProfile({
		owner,
		registrations: base.registrations.map((row) => ({ ...row })),
	});
}

function zeroTrapProxy<T extends object>(target: T): { readonly proxy: T; readonly hits: number[] } {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1] += 1; throw new Error('key trap'); },
		getOwnPropertyDescriptor() { hits[2] += 1; throw new Error('descriptor trap'); },
		get() { hits[3] += 1; throw new Error('get trap'); },
	}), hits };
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();
	async function visit(relative: string): Promise<void> {
		for (const entry of await readdir(resolve(ROOT, relative), { withFileTypes: true })) {
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
