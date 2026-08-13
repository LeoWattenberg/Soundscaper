/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
	type EditorProjectFeatureCapabilityProfile,
	type EditorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import * as capabilityProfileModule from '../src/common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v18.ts';
import * as framescaperCapabilityProfileModule from '../src/framescaper/editor-project-feature-capability-profile-v18.ts';
import { FRAMESCAPER_PROFILE } from '../src/framescaper/product.js';
import { SOUNDSCAPER_PROFILE } from '../src/soundscaper/product.js';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
	isProjectFeatureAudioCapabilityId,
	isProjectFeatureCapabilityId,
	isProjectFeatureVideoCapabilityId,
	snapshotProjectFeatureCapabilities,
} from '../src/common/editor/project-feature-capabilities.ts';
import {
	createProjectFeatureCompatibilityService,
} from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GENERIC_MODULE = 'src/common/editor/project-feature-capability-profile.ts';
const PRODUCT_MODULE = 'src/framescaper/editor-project-feature-capability-profile-v18.ts';
const FINAL_GENERIC_MODULE = 'src/common/editor/project-runtime-profile.ts';
const FINAL_PRODUCT_MODULE = 'src/framescaper/editor-project-runtime-profile-' + 'v18.ts';
const TEST_MODULE = 'tests/audio-editor-framescaper-project-feature-capability-profile.test.ts';
const FINAL_TEST_MODULE = 'tests/audio-editor-framescaper-project-runtime-profile.test.ts';
const FEATURE_OWNER_MODULE = 'src/framescaper/editor-project-feature-requirements-v18.ts';
const FEATURE_TEST_MODULE = 'tests/audio-editor-framescaper-project-v18-feature-requirements.test.ts';
const PREREQUISITE_MODULE = 'src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts';
const PRODUCT_EXPORT = 'FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE';
const PRODUCT_MODULE_STEM = 'editor-project-feature-capability-profile-v18';
const GENERIC_MODULE_STEM = 'project-feature-capability-profile';
const VIDEO_PROXY_ID = 'org.soundscaper.capability.video-proxy';

type Definition = EditorProjectFeatureCapabilityProfileDefinition;
type Registration = Definition['registrations'][number];
type MutableRecord = Record<PropertyKey, unknown>;
type StructuralTokenIsAssignable = Readonly<Record<never, never>> extends
	EditorProjectFeatureCapabilityProfile ? true : false;
type AssertFalse<Value extends false> = Value;

const EXPECTED = Object.freeze([
	registration('audioAnalysis', 'org.soundscaper.capability.audio-analysis', false),
	registration('audioEffects', 'org.soundscaper.capability.audio-effects', false),
	registration('audioGenerators', 'org.soundscaper.capability.audio-generators', false),
	registration('audioImport', 'org.soundscaper.capability.audio-import', true),
	registration('audioMacros', 'org.soundscaper.capability.audio-macros', false),
	registration('audioMixing', 'org.soundscaper.capability.audio-mixing', true),
	registration('audioPlayback', 'org.soundscaper.capability.audio-playback', true),
	registration('audioRecording', 'org.soundscaper.capability.audio-recording', false),
	registration('audioSampleEditing', 'org.soundscaper.capability.audio-sample-editing', false),
	registration('audioSpectralEditing', 'org.soundscaper.capability.audio-spectral-editing', false),
	registration('audioTimelineEditing', 'org.soundscaper.capability.audio-timeline-editing', true),
	registration('audioWarp', 'org.soundscaper.capability.audio-warp', false),
	registration('musicalTimeline', 'org.soundscaper.capability.musical-timeline', false),
	registration('project', 'org.soundscaper.capability.project', true),
	registration('projectBin', 'org.soundscaper.capability.project-bin', true),
	registration('sequenceTiming', 'org.soundscaper.capability.sequence-timing', true),
	registration('sourceCharacteristics', 'org.soundscaper.capability.source-characteristics', true),
	registration('takeComp', 'org.soundscaper.capability.take-comp', false),
	registration('timelineAnnotations', 'org.soundscaper.capability.timeline-annotations', false),
	registration('trackFolders', 'org.soundscaper.capability.track-folders', false),
	registration('videoCompositing', 'org.soundscaper.capability.video-compositing', true),
	registration('videoEffects', 'org.soundscaper.capability.video-effects', true),
	registration('videoExport', 'org.soundscaper.capability.video-export', true),
	registration('videoImport', 'org.soundscaper.capability.video-import', true),
	registration('videoPlayback', 'org.soundscaper.capability.video-playback', true),
	registration('videoProxy', VIDEO_PROXY_ID, false),
	registration('videoRetime', 'org.soundscaper.capability.video-retime', false),
	registration('videoTimelineEditing', 'org.soundscaper.capability.video-timeline-editing', true),
	registration('videoTimingAssets', 'org.soundscaper.capability.video-timing-assets', true),
] as const);

test('owns two type declarations, two runtime exports, and one exact product export', async () => {
	assert.deepEqual(Object.keys(capabilityProfileModule).sort(), [
		'createEditorProjectFeatureCapabilityProfile',
		'editorProjectFeatureCapabilityProfileDefinition',
	]);
	assert.deepEqual(Object.keys(framescaperCapabilityProfileModule), [PRODUCT_EXPORT]);
	const source = await readSource(GENERIC_MODULE);
	assert.deepEqual([...source.matchAll(
		/^export\s+(?:declare\s+)?(?:interface|type|function|class|const)\s+([A-Za-z0-9_]+)/gmu,
	)].map((match) => match[1]), [
		'EditorProjectFeatureCapabilityProfileDefinition',
		'EditorProjectFeatureCapabilityProfile',
		'createEditorProjectFeatureCapabilityProfile',
		'editorProjectFeatureCapabilityProfileDefinition',
	]);
	assert.doesNotMatch(source, /export\s+(?:type\s+)?\{/u);
});

test('the exact Framescaper singleton owns 29 sorted registrations with 15 available', () => {
	const token: EditorProjectFeatureCapabilityProfile =
		FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE;
	assert.equal(Object.isFrozen(token), true);
	assert.equal(Object.getPrototypeOf(token), null);
	assert.deepEqual(Reflect.ownKeys(token), []);
	const snapshot = editorProjectFeatureCapabilityProfileDefinition(token);
	assert.equal(snapshot.owner, 'framescaper');
	assert.deepEqual(snapshot.registrations, EXPECTED);
	assert.equal(snapshot.registrations.length, 29);
	assert.equal(snapshot.registrations.filter((item: Registration) => item.available).length, 15);
	assert.deepEqual(snapshot.registrations.find((item: Registration) => item.key === 'videoProxy'),
		registration('videoProxy', VIDEO_PROXY_ID, false));
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.registrations), true);
	assert.ok(snapshot.registrations.every((item: Registration) => Object.isFrozen(item)));
});

test('test-only parity exactly matches all 28 global IDs and strict Framescaper booleans', () => {
	const parity = EXPECTED.filter(({ key }) => key !== 'videoProxy');
	const ids = PROJECT_FEATURE_CAPABILITY_IDS as Readonly<Record<string, string>>;
	const availability = FRAMESCAPER_PROFILE.capabilities as Readonly<Record<string, unknown>>;
	assert.equal(parity.length, 28);
	assert.deepEqual(parity.map(({ key }) => key).sort(), Object.keys(ids).sort());
	assert.deepEqual(parity.map(({ key }) => key).sort(), Object.keys(availability).sort());
	for (const row of parity) {
		assert.equal(ids[row.key], row.featureId, row.key);
		assert.equal(typeof availability[row.key], 'boolean', row.key);
		assert.equal(availability[row.key], row.available, row.key);
	}
});

test('videoProxy remains absent and unknown to both products and every current V17 global path', () => {
	assert.equal(Object.hasOwn(PROJECT_FEATURE_CAPABILITY_IDS, 'videoProxy'), false);
	assert.equal(Object.values(PROJECT_FEATURE_CAPABILITY_IDS).includes(VIDEO_PROXY_ID as never), false);
	assert.equal(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS.includes(VIDEO_PROXY_ID as never), false);
	assert.equal(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(VIDEO_PROXY_ID as never), false);
	for (const product of [FRAMESCAPER_PROFILE, SOUNDSCAPER_PROFILE]) {
		assert.equal(Object.hasOwn(product.capabilities, 'videoProxy'), false, product.id);
		const snapshot = snapshotProjectFeatureCapabilities(product.capabilities);
		assert.equal(snapshot.knownFeatureIds.includes(VIDEO_PROXY_ID), false, product.id);
		assert.equal(snapshot.availableFeatureIds.includes(VIDEO_PROXY_ID), false, product.id);
		const report = createProjectFeatureCompatibilityService(product.capabilities).evaluate(
			featureProject(VIDEO_PROXY_ID),
		);
		assert.equal(report?.compatible, false, product.id);
		assert.equal(report?.items[0]?.availability, 'unknown', product.id);
		assert.equal(report?.items[0]?.disposition, 'bypassed', product.id);
	}
	assert.equal(isProjectFeatureCapabilityId(VIDEO_PROXY_ID), false);
	assert.equal(isProjectFeatureAudioCapabilityId(VIDEO_PROXY_ID), false);
	assert.equal(isProjectFeatureVideoCapabilityId(VIDEO_PROXY_ID), false);
});

test('creates fresh opaque identities over detached deeply frozen snapshots', () => {
	const input = definition(EXPECTED.map((item) => ({ ...item })));
	const inputRows = input.registrations as unknown as MutableRecord[];
	const first = createEditorProjectFeatureCapabilityProfile(input);
	const second = createEditorProjectFeatureCapabilityProfile(definition());
	const snapshot = editorProjectFeatureCapabilityProfileDefinition(first);
	assert.notEqual(first, second);
	assert.equal(editorProjectFeatureCapabilityProfileDefinition(first), snapshot);
	assert.deepEqual(snapshot, editorProjectFeatureCapabilityProfileDefinition(second));
	assert.notEqual(snapshot, input);
	assert.notEqual(snapshot.registrations, input.registrations);
	for (let index = 0; index < inputRows.length; index += 1) {
		assert.notEqual(snapshot.registrations[index], inputRows[index]);
	}
	(input as unknown as MutableRecord).owner = 'mutated';
	inputRows[0].key = 'mutated';
	inputRows.push(registration('z', 'z.z', false) as unknown as MutableRecord);
	assert.equal(snapshot.owner, 'framescaper');
	assert.deepEqual(snapshot.registrations, EXPECTED);
	const nullDefinition = Object.assign(Object.create(null) as MutableRecord, definition([
		nullRegistration('a', 'a.a', true),
	]));
	assert.deepEqual(ordinaryDefinition(editorProjectFeatureCapabilityProfileDefinition(
		createEditorProjectFeatureCapabilityProfile(nullDefinition),
	)), definition([registration('a', 'a.a', true)]));
});

test('snapshots top, array, then entry descriptors in exact order with zero ordinary gets', () => {
	const events: string[] = [];
	const rows = [
		descriptorProxy(registration('a', 'a.a', true), 'entry0', events),
		descriptorProxy(registration('b', 'b.b', false), 'entry1', events),
	];
	const array = descriptorProxy(rows.map(({ proxy }) => proxy), 'array', events);
	const top = descriptorProxy(definition(array.proxy), 'top', events);
	const token = createEditorProjectFeatureCapabilityProfile(top.proxy);
	assert.deepEqual(events, [
		'top:prototype', 'top:keys', 'top:descriptor:owner', 'top:descriptor:registrations',
		'array:prototype', 'array:keys', 'array:descriptor:length',
		'array:descriptor:0', 'array:descriptor:1',
		'entry0:prototype', 'entry0:keys', 'entry0:descriptor:key',
		'entry0:descriptor:featureId', 'entry0:descriptor:available',
		'entry1:prototype', 'entry1:keys', 'entry1:descriptor:key',
		'entry1:descriptor:featureId', 'entry1:descriptor:available',
	]);
	assert.deepEqual(editorProjectFeatureCapabilityProfileDefinition(token).registrations, [
		registration('a', 'a.a', true), registration('b', 'b.b', false),
	]);
	assert.equal(top.gets + array.gets + rows.reduce((sum, row) => sum + row.gets, 0), 0);
});

test('refuses malformed top records and every top-level descriptor trap outcome', () => {
	class DefinitionClass { owner = 'framescaper'; registrations = [registration('a', 'a.a', true)]; }
	const symbol = definition() as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const value of [
		null, undefined, false, 1, 'profile', Symbol('profile'), () => undefined, [],
		new DefinitionClass(), Object.create(definition()), { ...definition(), extra: true }, symbol,
	]) assert.throws(() => createEditorProjectFeatureCapabilityProfile(value), TypeError);
	for (const field of ['owner', 'registrations'] as const) assertFieldShapeRefusal(
		definition(), field, (value) => createEditorProjectFeatureCapabilityProfile(value),
	);
	assertProxyMatrix(definition(), (value) => createEditorProjectFeatureCapabilityProfile(value), 'top');
});

test('enforces owner and registration-array prototype, density, descriptors, and 1..128 bound', () => {
	for (const owner of ['a', 'a-', 'a-1', 'a'.repeat(64)]) {
		assert.doesNotThrow(() => createEditorProjectFeatureCapabilityProfile(definition(undefined, owner)));
	}
	for (const owner of ['', 'a'.repeat(65), '1a', 'A', 'a_b', 'a.b', 'a b', 'ä']) {
		assert.throws(() => createEditorProjectFeatureCapabilityProfile(definition(undefined, owner)), TypeError);
	}
	assert.doesNotThrow(() => createEditorProjectFeatureCapabilityProfile(definition(boundRows(128))));
	const hole = Array(2) as Registration[];
	hole[0] = registration('a', 'a.a', true);
	const extra = [registration('a', 'a.a', true)] as Registration[] & { extra?: boolean };
	extra.extra = true;
	const symbol = [registration('a', 'a.a', true)] as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	const foreign = [registration('a', 'a.a', true)];
	Object.setPrototypeOf(foreign, null);
	for (const rows of [[], boundRows(129), {}, { 0: registration('a', 'a.a', true), length: 1 },
		hole, extra, symbol, foreign]) {
		assert.throws(() => createEditorProjectFeatureCapabilityProfile(definition(
			rows as unknown as readonly Registration[],
		)), TypeError);
	}
	assertArrayDescriptorRefusals();
	assertProxyMatrix([registration('a', 'a.a', true)], (value) =>
		createEditorProjectFeatureCapabilityProfile(definition(value as readonly Registration[])), 'array');
});

test('enforces closed entry descriptors, key/ID grammar, booleans, sorting, and uniqueness', () => {
	class EntryClass { key = 'a'; featureId = 'a.a'; available = true; }
	const symbol = registration('a', 'a.a', true) as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const row of [
		null, false, 1, 'entry', [], new EntryClass(), Object.create(registration('a', 'a.a', true)),
		{ ...registration('a', 'a.a', true), extra: true }, symbol,
	]) assert.throws(() => createEditorProjectFeatureCapabilityProfile(definition([
		row as unknown as Registration,
	])), TypeError);
	for (const field of ['key', 'featureId', 'available'] as const) assertFieldShapeRefusal(
		registration('a', 'a.a', true), field,
		(value) => createEditorProjectFeatureCapabilityProfile(definition([value as Registration])),
	);
	assertProxyMatrix(registration('a', 'a.a', true), (value) =>
		createEditorProjectFeatureCapabilityProfile(definition([value as Registration])), 'entry');
	for (const key of ['a', 'aA0', 'a'.repeat(64)]) assert.doesNotThrow(() => createProfileFor(key, 'a.a', true));
	for (const key of ['', 'a'.repeat(65), 'A', '1a', 'a-b', 'a_b', 'a.b', 'a b', 'ä']) {
		assert.throws(() => createProfileFor(key, 'a.a', true), TypeError);
	}
	for (const id of ['a.a', `a.${'a'.repeat(254)}`, 'a.a-a']) {
		assert.doesNotThrow(() => createProfileFor('a', id, true));
	}
	for (const id of ['', 'a', `a.${'a'.repeat(255)}`, '.a', 'a.', 'a..a', 'A.a',
		'a.A', 'a.-a', 'a.a-', 'a_a.a', 'a a.a', 'a/a.a', 'ä.a']) {
		assert.throws(() => createProfileFor('a', id, true), TypeError);
	}
	for (const value of [0, 1, 'true', null, undefined, {}, []]) {
		assert.throws(() => createProfileFor('a', 'a.a', value as unknown as boolean), TypeError);
	}
	assert.doesNotThrow(() => createEditorProjectFeatureCapabilityProfile(definition([
		registration('aB', 'a.b', true), registration('aa', 'a.c', false),
	])));
	for (const rows of [
		[registration('b', 'b.b', true), registration('a', 'a.a', false)],
		[registration('a', 'a.a', true), registration('a', 'b.b', false)],
		[registration('a', 'a.a', true), registration('b', 'a.a', false)],
	]) assert.throws(() => createEditorProjectFeatureCapabilityProfile(definition(rows)), TypeError);
});

test('authenticates only creator-issued identities without observing any forgery', () => {
	const authentic = createEditorProjectFeatureCapabilityProfile(definition());
	for (const target of [
		{}, [], () => undefined, Object.create(null) as object, { ...authentic }, structuredClone(authentic),
	]) {
		const probe = zeroTrapProxy(target);
		assert.throws(() => editorProjectFeatureCapabilityProfileDefinition(probe.proxy), TypeError);
		assert.deepEqual(probe.hits, [0, 0, 0, 0]);
	}
	const wrapped = zeroTrapProxy(authentic);
	assert.throws(() => editorProjectFeatureCapabilityProfileDefinition(wrapped.proxy), TypeError);
	assert.deepEqual(wrapped.hits, [0, 0, 0, 0]);
	for (const value of [null, undefined, false, 1, 'profile', Symbol('profile')]) {
		assert.throws(() => editorProjectFeatureCapabilityProfileDefinition(value), TypeError);
	}
	assert.notEqual(createEditorProjectFeatureCapabilityProfile(definition()),
		FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE);
});

test('keeps private capability ownership within the closed V18 domain set', async () => {
	const files = await sourceFiles(['src', 'desktop', 'scripts', 'tests']);
	const exportReferences: string[] = [];
	const pathReferences: string[] = [];
	const genericPathReferences: string[] = [];
	const privateIdReferences: string[] = [];
	for (const file of files) {
		const source = await readSource(file);
		if (source.includes(PRODUCT_EXPORT)) exportReferences.push(file);
		if (source.includes(PRODUCT_MODULE_STEM)) pathReferences.push(file);
		if (source.includes(GENERIC_MODULE_STEM)) genericPathReferences.push(file);
		if (source.includes(VIDEO_PROXY_ID)) privateIdReferences.push(file);
	}
	assert.deepEqual(exportReferences, [
		PRODUCT_MODULE, FINAL_PRODUCT_MODULE, TEST_MODULE, FINAL_TEST_MODULE,
	]);
	assert.deepEqual(pathReferences, [FINAL_PRODUCT_MODULE, TEST_MODULE, FINAL_TEST_MODULE]);
	assert.deepEqual(genericPathReferences, [
		FINAL_GENERIC_MODULE, PRODUCT_MODULE, FEATURE_OWNER_MODULE, FINAL_PRODUCT_MODULE,
		TEST_MODULE, FINAL_TEST_MODULE,
	]);
	assert.deepEqual(privateIdReferences, [
		PRODUCT_MODULE, FEATURE_OWNER_MODULE, TEST_MODULE, FEATURE_TEST_MODULE,
	]);
	const generic = await readSource(GENERIC_MODULE);
	assert.deepEqual(importSpecifiers(generic), []);
	assert.doesNotMatch(generic, /^\s*import\b|\brequire\s*\(|\bimport\s*\(/gmu);
	assert.doesNotMatch(generic, /framescaper|soundscaper|productId|PROJECT_FEATURE|videoProxy/iu);
	const product = await readSource(PRODUCT_MODULE);
	assert.deepEqual([...new Set(importSpecifiers(product))], [
		'../common/editor/project-feature-capability-profile.ts',
	]);
	assert.doesNotMatch(product,
		/project-feature-capabilities|product\.js|products\.js|product-capabilities|runtime-profile-prerequisite|config\//iu);
	for (const file of files.filter((file) => file.startsWith('src/common/') || file.startsWith('src/soundscaper/'))) {
		assert.doesNotMatch(await readSource(file), new RegExp(PRODUCT_MODULE_STEM, 'u'), file);
	}
	const prerequisite = await readSource(PREREQUISITE_MODULE);
	assert.doesNotMatch(prerequisite,
		/FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE|project-feature-capability-profile|capabilityProfile|org\.soundscaper\.capability\.video-proxy/u);
});

function definition(
	registrations: readonly Registration[] = EXPECTED,
	owner = 'framescaper',
): Definition {
	return { owner, registrations };
}

function registration(key: string, featureId: string, available: boolean): Registration {
	return { key, featureId, available };
}

function nullRegistration(key: string, featureId: string, available: boolean): Registration {
	return Object.assign(Object.create(null) as MutableRecord, { key, featureId, available }) as unknown as Registration;
}

function ordinaryDefinition(value: Definition): Definition {
	return { owner: value.owner, registrations: [...value.registrations] };
}

function featureProject(featureId: string): object {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'video-proxy', featureId, displayName: 'Video proxy attachments',
			disposition: 'bypass', fallback: null,
		}] },
	};
}

function boundRows(count: number): readonly Registration[] {
	return Array.from({ length: count }, (_, index) => {
		const suffix = String(index).padStart(3, '0');
		return registration(`a${suffix}`, `a.${suffix}a`, index % 2 === 0);
	});
}

function createProfileFor(key: string, featureId: string, available: boolean): void {
	createEditorProjectFeatureCapabilityProfile(definition([registration(key, featureId, available)]));
}

function assertFieldShapeRefusal(
	base: object,
	field: PropertyKey,
	consume: (value: object) => unknown,
): void {
	const missing = { ...base } as MutableRecord;
	delete missing[field];
	assert.throws(() => consume(missing), TypeError);
	const nonEnumerable = { ...base } as MutableRecord;
	Object.defineProperty(nonEnumerable, field, { value: nonEnumerable[field], enumerable: false });
	assert.throws(() => consume(nonEnumerable), TypeError);
	let gets = 0;
	const accessor = { ...base } as MutableRecord;
	Object.defineProperty(accessor, field, { enumerable: true,
		get() { gets += 1; return (base as MutableRecord)[field]; } });
	assert.throws(() => consume(accessor), TypeError);
	assert.equal(gets, 0);
}

function assertArrayDescriptorRefusals(): void {
	const base = [registration('a', 'a.a', true)];
	let gets = 0;
	const accessor = [...base];
	Object.defineProperty(accessor, '0', { enumerable: true,
		get() { gets += 1; return base[0]; } });
	const nonEnumerable = [...base];
	Object.defineProperty(nonEnumerable, '0', { value: base[0], enumerable: false });
	for (const rows of [accessor, nonEnumerable]) {
		assert.throws(() => createEditorProjectFeatureCapabilityProfile(definition(rows)), TypeError);
	}
	assert.equal(gets, 0);
	for (const handler of [
		{ ownKeys(target: Registration[]) { return Reflect.ownKeys(target).filter((key) => key !== '0'); } },
		{ getOwnPropertyDescriptor(target: Registration[], key: PropertyKey) {
			const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
			return key === 'length' && descriptor ? { ...descriptor, value: 129 } : descriptor;
		} },
		{ getOwnPropertyDescriptor(target: Registration[], key: PropertyKey) {
			return key === '0' ? undefined : Reflect.getOwnPropertyDescriptor(target, key);
		} },
	] satisfies ProxyHandler<Registration[]>[]) assert.throws(() =>
		createEditorProjectFeatureCapabilityProfile(definition(new Proxy([...base], handler))), TypeError);
}

function assertProxyMatrix<T extends object>(
	target: T,
	consume: (value: T) => unknown,
	label: string,
): void {
	for (const [handler, pattern] of [
		[{ getPrototypeOf() { throw new Error(`${label} prototype failed`); } }, new RegExp(`${label} prototype failed`, 'u')],
		[{ ownKeys() { throw new Error(`${label} keys failed`); } }, new RegExp(`${label} keys failed`, 'u')],
		[{ getOwnPropertyDescriptor() { throw new Error(`${label} descriptor failed`); } }, new RegExp(`${label} descriptor failed`, 'u')],
	] as const) assert.throws(() => consume(new Proxy(target, handler)), pattern);
	for (const handler of [
		{ getPrototypeOf() { return label === 'array' ? Object.prototype : Array.prototype; } },
		{ ownKeys() { return []; } },
		{ getOwnPropertyDescriptor() { return undefined; } },
	] satisfies ProxyHandler<T>[]) assert.throws(() => consume(new Proxy(target, handler)), TypeError);
}

function descriptorProxy<T extends object>(target: T, label: string, events: string[]) {
	let gets = 0;
	const proxy = new Proxy(target, {
		getPrototypeOf(value) { events.push(`${label}:prototype`); return Reflect.getPrototypeOf(value); },
		ownKeys(value) { events.push(`${label}:keys`); return Reflect.ownKeys(value); },
		getOwnPropertyDescriptor(value, key) {
			events.push(`${label}:descriptor:${String(key)}`);
			return Reflect.getOwnPropertyDescriptor(value, key);
		},
		get() { gets += 1; throw new Error(`${label} ordinary get`); },
	});
	return { proxy, get gets() { return gets; } };
}

function zeroTrapProxy<T extends object>(target: T): { readonly proxy: T; readonly hits: number[] } {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1] += 1; throw new Error('keys trap'); },
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
