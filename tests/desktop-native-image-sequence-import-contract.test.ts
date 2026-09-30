/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertFramescaperNativeImageSequenceImportPortRequest,
	assertFramescaperNativeImageSequenceImportRequest,
	framescaperNativeImageSequenceAssetPath,
	framescaperNativeImageSequenceId,
	framescaperNativeImageSequenceInteger,
	normalizeFramescaperNativeImageSequenceAdmission,
	normalizeFramescaperNativeImageSequenceReference,
	parseFramescaperNativeImageSequenceManifest,
} from '../desktop/native-image-sequence-import-contract.ts';
import { imageSequenceStorageSha256 } from '../desktop/native-image-sequence-import-storage.ts';

const DIGEST = 'a'.repeat(64);
const TRANSACTION_ID = 'b'.repeat(40);
const PACK = Object.freeze({
	kind: 'image-sequence-source-pack' as const,
	storageKey: `image-sequence-pack-sha256:${DIGEST}`,
	sha256: DIGEST,
	byteLength: 12,
});
const INVENTORY = Object.freeze({
	kind: 'image-sequence-inventory' as const,
	version: 1 as const,
	storageKey: `image-sequence-inventory-sha256:${DIGEST}`,
	sha256: DIGEST,
	byteLength: 34,
	frameCount: 2,
	firstFrameNumber: 10,
	lastFrameNumber: 11,
});
const ADMISSION = Object.freeze({
	kind: 'framescaper-image-sequence-admission-v1' as const,
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
	projectId: 'project-one',
	projectRevision: 4,
	sourceId: 'source-one',
	profileId: 'decode-png-sequence' as const,
	frameRate: Object.freeze({ num: 24, den: 1 }),
	frameCount: 2,
	inventory: INVENTORY,
	sourcePack: PACK,
});

test('image-sequence control admission accepts every exact operation shape', () => {
	const requests = [
		{ operation: 'begin', schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-one', projectRevision: 4 },
		{ operation: 'write', transactionId: TRANSACTION_ID, asset: 'pack', offset: 0,
			bytes: new Uint8Array([1]) },
		{ operation: 'prepare-write', transactionId: TRANSACTION_ID, asset: 'pack', offset: 0,
			binding: {} },
		{ operation: 'await-write', transactionId: TRANSACTION_ID, asset: 'pack', offset: 0,
			streamId: 'stream-one' },
		{ operation: 'commit', transactionId: TRANSACTION_ID, asset: 'pack', reference: PACK },
		{ operation: 'read', transactionId: TRANSACTION_ID, asset: 'pack', offset: 0, length: 1 },
		{ operation: 'admit', transactionId: TRANSACTION_ID, admission: ADMISSION },
		{ operation: 'complete', transactionId: TRANSACTION_ID, sourceId: 'source-one',
			inventorySha256: DIGEST, sourcePackSha256: DIGEST },
		{ operation: 'discard', transactionId: TRANSACTION_ID },
	];
	for (const request of requests) {
		assert.doesNotThrow(() => assertFramescaperNativeImageSequenceImportRequest(
			request, { allowDirectWrite: true },
		));
	}
});

test('image-sequence control admission accepts an exact null-prototype record', () => {
	const request = Object.assign(Object.create(null) as Record<string, unknown>, {
		operation: 'begin', schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-one', projectRevision: 4,
	});
	assert.doesNotThrow(() => assertFramescaperNativeImageSequenceImportRequest(
		request, { allowDirectWrite: false },
	));
});

test('image-sequence control admission rejects non-record inputs', () => {
	for (const value of [null, undefined, false, 'request', [], new Date()]) {
		assert.throws(
			() => assertFramescaperNativeImageSequenceImportRequest(
				value, { allowDirectWrite: true },
			),
			/plain record/iu,
		);
	}
});

test('image-sequence control admission rejects an inherited operation', () => {
	const value = Object.create({ operation: 'discard' }) as Record<string, unknown>;
	value.transactionId = TRANSACTION_ID;
	assert.throws(
		() => assertFramescaperNativeImageSequenceImportRequest(value, { allowDirectWrite: true }),
		/plain record/iu,
	);
});

test('image-sequence control admission does not invoke an operation accessor', () => {
	let calls = 0;
	const value = { transactionId: TRANSACTION_ID };
	Object.defineProperty(value, 'operation', {
		enumerable: true,
		get: () => { calls += 1; return 'discard'; },
	});
	assert.throws(
		() => assertFramescaperNativeImageSequenceImportRequest(value, { allowDirectWrite: true }),
		/data property/iu,
	);
	assert.equal(calls, 0);
});

test('image-sequence control admission requires an enumerable operation', () => {
	const value = { transactionId: TRANSACTION_ID };
	Object.defineProperty(value, 'operation', { enumerable: false, value: 'discard' });
	assert.throws(
		() => assertFramescaperNativeImageSequenceImportRequest(value, { allowDirectWrite: true }),
		/enumerable/iu,
	);
});

test('image-sequence control admission rejects unknown and non-string operations', () => {
	for (const operation of ['erase', 1, null]) {
		assert.throws(
			() => assertFramescaperNativeImageSequenceImportRequest(
				{ operation, transactionId: TRANSACTION_ID }, { allowDirectWrite: true },
			),
			/unsupported/iu,
		);
	}
});

test('image-sequence control admission enforces the MessagePort write policy', () => {
	assert.throws(
		() => assertFramescaperNativeImageSequenceImportRequest({
			operation: 'write', transactionId: TRANSACTION_ID, asset: 'pack', offset: 0,
			bytes: new Uint8Array([1]),
		}, { allowDirectWrite: false }),
		/MessagePort data plane/iu,
	);
});

test('image-sequence control admission rejects missing, extra, and symbol fields', () => {
	const symbol = Symbol('hidden');
	for (const value of [
		{ operation: 'discard' },
		{ operation: 'discard', transactionId: TRANSACTION_ID, path: '/tmp/body' },
		{ operation: 'discard', transactionId: TRANSACTION_ID, [symbol]: true },
	]) {
		assert.throws(
			() => assertFramescaperNativeImageSequenceImportRequest(
				value, { allowDirectWrite: true },
			),
			/missing or unsupported fields/iu,
		);
	}
});

test('image-sequence port admission accepts only its exact pathless record', () => {
	const value = { transactionId: TRANSACTION_ID, asset: 'pack', offset: 0, binding: {} };
	assert.doesNotThrow(() => assertFramescaperNativeImageSequenceImportPortRequest(value));
	for (const invalid of [
		null,
		[],
		{ ...value, path: '/tmp/body' },
		{ transactionId: TRANSACTION_ID, asset: 'pack', offset: 0 },
	]) {
		assert.throws(
			() => assertFramescaperNativeImageSequenceImportPortRequest(invalid),
			/record|exact|pathless/iu,
		);
	}
});

test('image-sequence references normalize frozen pack and inventory values', () => {
	const pack = normalizeFramescaperNativeImageSequenceReference({ ...PACK }, 'pack');
	const inventory = normalizeFramescaperNativeImageSequenceReference({ ...INVENTORY }, 'inventory');
	assert.deepEqual(pack, PACK);
	assert.deepEqual(inventory, INVENTORY);
	assert.equal(Object.isFrozen(pack), true);
	assert.equal(Object.isFrozen(inventory), true);
});

test('image-sequence references reject invalid digests and storage bindings', () => {
	for (const value of [
		{ ...PACK, sha256: DIGEST.toUpperCase() },
		{ ...PACK, storageKey: `image-sequence-pack-sha256:${'c'.repeat(64)}` },
		{ ...PACK, kind: 'image-sequence-inventory' },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceReference(value, 'pack'),
			/SHA-256|digest-bound/iu,
		);
	}
});

test('image-sequence references require positive safe byte lengths', () => {
	for (const byteLength of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12']) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceReference(
				{ ...PACK, byteLength }, 'pack',
			),
			/byte length is invalid/iu,
		);
	}
});

test('image-sequence inventory references require version one', () => {
	assert.throws(
		() => normalizeFramescaperNativeImageSequenceReference({ ...INVENTORY, version: 2 }, 'inventory'),
		/version is unsupported/iu,
	);
});

test('image-sequence inventory references require valid frame counters', () => {
	for (const value of [
		{ ...INVENTORY, frameCount: 0 },
		{ ...INVENTORY, firstFrameNumber: -1 },
		{ ...INVENTORY, lastFrameNumber: 1.5 },
		{ ...INVENTORY, lastFrameNumber: 12 },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceReference(value, 'inventory'),
			/is invalid/iu,
		);
	}
});

test('image-sequence references reject non-plain, inexact, and accessor records', () => {
	const accessor = { ...PACK } as Record<string, unknown>;
	Object.defineProperty(accessor, 'byteLength', { enumerable: true, get: () => 12 });
	for (const value of [new (class { readonly kind = PACK.kind; })(), { ...PACK, path: '/tmp/body' }, accessor]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceReference(value, 'pack'),
			/exact plain record|data property/iu,
		);
	}
});

test('image-sequence admission snapshots and freezes every nested contract value', () => {
	const input = structuredClone(ADMISSION);
	const normalized = normalizeFramescaperNativeImageSequenceAdmission(input);
	assert.deepEqual(normalized, ADMISSION);
	assert.notEqual(normalized.frameRate, input.frameRate);
	assert.notEqual(normalized.inventory, input.inventory);
	assert.notEqual(normalized.sourcePack, input.sourcePack);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.frameRate), true);
	assert.equal(Object.isFrozen(normalized.inventory), true);
	assert.equal(Object.isFrozen(normalized.sourcePack), true);
});

test('image-sequence admission accepts every supported decode profile', () => {
	for (const profileId of [
		'decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence',
	] as const) {
		assert.equal(
			normalizeFramescaperNativeImageSequenceAdmission({ ...ADMISSION, profileId }).profileId,
			profileId,
		);
	}
});

test('image-sequence admission rejects foreign and future project identities', () => {
	for (const value of [
		{ ...ADMISSION, schemaFamily: 'soundscaper' },
		{ ...ADMISSION, schemaVersion: 2 },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission(value),
			/current Framescaper project schema/iu,
		);
	}
});

test('image-sequence admission requires its exact v1 kind', () => {
	assert.throws(
		() => normalizeFramescaperNativeImageSequenceAdmission({ ...ADMISSION, kind: 'image-sequence' }),
		/exact Framescaper v1 request/iu,
	);
});

test('image-sequence admission requires bounded project and source IDs', () => {
	for (const value of [
		{ ...ADMISSION, projectId: '' },
		{ ...ADMISSION, sourceId: '../source' },
		{ ...ADMISSION, sourceId: 'a'.repeat(129) },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission(value),
			/ID is invalid/iu,
		);
	}
});

test('image-sequence admission requires safe non-negative counts and revisions', () => {
	for (const value of [
		{ ...ADMISSION, projectRevision: -1 },
		{ ...ADMISSION, projectRevision: 1.5 },
		{ ...ADMISSION, frameCount: 0 },
		{ ...ADMISSION, frameCount: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission(value),
			/is invalid/iu,
		);
	}
});

test('image-sequence admission rejects unsupported profiles without coercion', () => {
	let calls = 0;
	const profileId = {};
	Object.defineProperty(profileId, 'toString', {
		get: () => { calls += 1; return () => 'decode-png-sequence'; },
	});
	assert.throws(
		() => normalizeFramescaperNativeImageSequenceAdmission({ ...ADMISSION, profileId }),
		/unsupported/iu,
	);
	assert.equal(calls, 0);
});

test('image-sequence admission requires an exact positive rational rate', () => {
	for (const frameRate of [
		{ num: 24 },
		{ num: 24, den: 1, dropFrame: false },
		{ num: 0, den: 1 },
		{ num: 24, den: 0 },
		{ num: 23.976, den: 1 },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission({ ...ADMISSION, frameRate }),
			/rate|invalid/iu,
		);
	}
});

test('image-sequence admission rejects malformed nested asset references', () => {
	for (const value of [
		{ ...ADMISSION, inventory: null },
		{ ...ADMISSION, inventory: { ...INVENTORY, storageKey: PACK.storageKey } },
		{ ...ADMISSION, sourcePack: { ...PACK, byteLength: 0 } },
		{ ...ADMISSION, frameCount: 1 },
	]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission(value),
			/asset reference|digest-bound|byte length/iu,
		);
	}
});

test('image-sequence admission rejects inexact and accessor records', () => {
	const accessor = { ...ADMISSION } as Record<string, unknown>;
	Object.defineProperty(accessor, 'kind', {
		enumerable: true,
		get: () => ADMISSION.kind,
	});
	for (const value of [{ ...ADMISSION, path: '/tmp/body' }, accessor]) {
		assert.throws(
			() => normalizeFramescaperNativeImageSequenceAdmission(value),
			/exact plain record|data property/iu,
		);
	}
});

test('image-sequence recovery parses an authenticated empty manifest', () => {
	const bytes = manifestBytes({ sourceId: null, pack: null, inventory: null });
	const parsed = parseFramescaperNativeImageSequenceManifest(bytes, TRANSACTION_ID);
	assert.equal(parsed.sourceId, null);
	assert.equal(parsed.pack, null);
	assert.equal(parsed.inventory, null);
	assert.equal(Object.isFrozen(parsed), true);
});

test('image-sequence recovery parses and freezes authenticated asset references', () => {
	const parsed = parseFramescaperNativeImageSequenceManifest(
		manifestBytes({ sourceId: 'source-one', pack: PACK, inventory: INVENTORY }),
		TRANSACTION_ID,
	);
	assert.deepEqual(parsed.pack, PACK);
	assert.deepEqual(parsed.inventory, INVENTORY);
	assert.equal(Object.isFrozen(parsed.pack), true);
	assert.equal(Object.isFrozen(parsed.inventory), true);
});

test('image-sequence recovery rejects malformed JSON and UTF-8', () => {
	for (const bytes of [
		new TextEncoder().encode('{'),
		Uint8Array.from([0xc3, 0x28]),
	]) {
		assert.throws(
			() => parseFramescaperNativeImageSequenceManifest(bytes, TRANSACTION_ID),
			/SyntaxError|encoded data/iu,
		);
	}
});

test('image-sequence recovery rejects invalid manifest identities', () => {
	for (const [overrides, expectedId] of [
		[{ version: 2 }, TRANSACTION_ID],
		[{ transactionId: 'c'.repeat(40) }, TRANSACTION_ID],
		[{}, 'not-a-transaction'],
		[{ sourceId: 42 }, TRANSACTION_ID],
	] as const) {
		assert.throws(
			() => parseFramescaperNativeImageSequenceManifest(manifestBytes(overrides), expectedId),
			/invalid image-sequence recovery identity/iu,
		);
	}
});

test('image-sequence recovery rejects foreign schema identities', () => {
	for (const overrides of [
		{ schemaFamily: 'soundscaper' },
		{ schemaVersion: 2 },
	]) {
		assert.throws(
			() => parseFramescaperNativeImageSequenceManifest(
				manifestBytes(overrides), TRANSACTION_ID,
			),
			/current Framescaper project schema/iu,
		);
	}
});

test('image-sequence recovery rejects invalid project and source values', () => {
	for (const overrides of [
		{ projectId: '../project' },
		{ projectRevision: -1 },
		{ sourceId: '../source' },
	]) {
		assert.throws(
			() => parseFramescaperNativeImageSequenceManifest(
				manifestBytes(overrides), TRANSACTION_ID,
			),
			/is invalid/iu,
		);
	}
});

test('image-sequence recovery rejects malformed referenced assets', () => {
	assert.throws(
		() => parseFramescaperNativeImageSequenceManifest(manifestBytes({
			pack: { ...PACK, sha256: 'not-a-digest' },
		}), TRANSACTION_ID),
		/SHA-256 digest is invalid/iu,
	);
});

test('image-sequence recovery rejects unauthenticated content', () => {
	const value = JSON.parse(new TextDecoder().decode(manifestBytes({}))) as Record<string, unknown>;
	value.projectId = 'tampered-project';
	assert.throws(
		() => parseFramescaperNativeImageSequenceManifest(
			new TextEncoder().encode(JSON.stringify(value)), TRANSACTION_ID,
		),
		/unauthenticated/iu,
	);
});

test('image-sequence asset paths bind supported kinds to digest extensions', () => {
	assert.equal(
		framescaperNativeImageSequenceAssetPath('/library', PACK),
		join('/library', 'objects', `${DIGEST}.pack`),
	);
	assert.equal(
		framescaperNativeImageSequenceAssetPath('/library', INVENTORY),
		join('/library', 'objects', `${DIGEST}.inventory`),
	);
});

test('image-sequence asset paths reject unsupported kinds and digests', () => {
	assert.throws(
		() => framescaperNativeImageSequenceAssetPath('/library', {
			kind: 'video' as never, sha256: DIGEST,
		}),
		/kind is unsupported/iu,
	);
	assert.throws(
		() => framescaperNativeImageSequenceAssetPath('/library', {
			kind: PACK.kind, sha256: '../object',
		}),
		/SHA-256 digest is invalid/iu,
	);
});

test('image-sequence IDs enforce their closed portable alphabet and bound', () => {
	assert.equal(framescaperNativeImageSequenceId('A-1_b:c.d', 'test ID'), 'A-1_b:c.d');
	for (const value of ['', '-leading', '../path', 'space here', 'a'.repeat(129), 1]) {
		assert.throws(
			() => framescaperNativeImageSequenceId(value, 'test ID'),
			/test ID is invalid/iu,
		);
	}
});

test('image-sequence integers enforce safe whole values and configurable minima', () => {
	assert.equal(framescaperNativeImageSequenceInteger(0, 'offset'), 0);
	assert.equal(framescaperNativeImageSequenceInteger(1, 'length', 1), 1);
	for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1']) {
		assert.throws(
			() => framescaperNativeImageSequenceInteger(value, 'offset'),
			/offset is invalid/iu,
		);
	}
	assert.throws(
		() => framescaperNativeImageSequenceInteger(0, 'length', 1),
		/length is invalid/iu,
	);
});

function manifestBytes(overrides: Readonly<Record<string, unknown>>): Uint8Array {
	const body = {
		version: 1,
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		transactionId: TRANSACTION_ID,
		projectId: 'project-one',
		projectRevision: 4,
		sourceId: null,
		pack: null,
		inventory: null,
		...overrides,
	};
	return new TextEncoder().encode(JSON.stringify({
		...body,
		authenticator: imageSequenceStorageSha256(JSON.stringify(body)),
	}));
}
