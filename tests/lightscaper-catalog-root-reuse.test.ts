/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneLightscaperDocumentV1, parseLightscaperDocumentV1, readValidatedPhotoCatalogRootV1,
	serializeLightscaperDocumentV1, validateLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

function rootInput() {
	return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog', name: 'Root', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Folder', parentId: null }], keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }],
		collections: [{ id: 'smart', name: 'Smart', kind: 'smart', query: { kind: 'any', terms: [
			{ kind: 'not', term: { kind: 'keyword', id: 'keyword' } },
			{ kind: 'all', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'file-name', contains: 'image' }] },
		] } }] };
}
function assertDeepFrozen(value: unknown): void {
	if (value === null || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
function maximumRoot() {
	const input = rootInput(), keywords = [...input.keywords,
		...Array.from({ length: 7_000 }, (_, index) => ({ id: `z-${String(index)}`, name: '界'.repeat(80), parentId: null }))];
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
	let remaining = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes - bytes(normalizePhotoCatalogRootV1({ ...input, keywords }));
	for (const node of keywords.slice(1)) { const extra = Math.min(remaining, 256 - node.name.length); node.name += 'e'.repeat(extra); remaining -= extra; }
	assert.equal(remaining, 0);
	const root = { ...input, keywords };
	assert.equal(bytes(root), LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes);
	return root;
}

test('reuse accepts exact fully validated immutable root identities without copying descendants', () => {
	const input = rootInput(), validated = validateLightscaperDocumentV1(input);
	assert.equal(validated.kind, 'photo-catalog');
	assert.equal(readValidatedPhotoCatalogRootV1(validated), validated);
	const fromRaw = readValidatedPhotoCatalogRootV1(input);
	assert.notEqual(fromRaw, input); assert.equal(readValidatedPhotoCatalogRootV1(fromRaw), fromRaw);
});

test('general validation and clone still create fresh detached deeply frozen root graphs', () => {
	const validated = readValidatedPhotoCatalogRootV1(rootInput());
	for (const copy of [validateLightscaperDocumentV1(validated), cloneLightscaperDocumentV1(validated)]) {
		assert.notEqual(copy, validated); assert.deepEqual(copy, validated); assert.equal(copy.kind, 'photo-catalog');
		if (copy.kind !== 'photo-catalog') assert.fail('Expected root');
		assert.notEqual(copy.folders, validated.folders); assert.notEqual(copy.folders[0], validated.folders[0]);
		assert.notEqual(copy.keywords, validated.keywords); assert.notEqual(copy.collections, validated.collections);
		const next = copy.collections[0]!, old = validated.collections[0]!;
		assert.notEqual(next, old); assert.equal(next.kind, 'smart'); assert.equal(old.kind, 'smart');
		if (next.kind === 'smart' && old.kind === 'smart') assert.notEqual(next.query, old.query);
		assertDeepFrozen(copy); assert.equal(readValidatedPhotoCatalogRootV1(copy), copy);
	}
});

test('caller hierarchy and nested query mutations cannot change the reusable root', () => {
	const input = rootInput(), saved = readValidatedPhotoCatalogRootV1(input), before = serializeLightscaperDocumentV1(saved);
	input.folders[0]!.name = 'Changed'; input.keywords.push({ id: 'later', name: 'Later', parentId: null });
	input.collections[0]!.name = 'Changed'; input.collections[0]!.query.terms.length = 0;
	assert.equal(serializeLightscaperDocumentV1(saved), before); assertDeepFrozen(saved);
	assert.equal(readValidatedPhotoCatalogRootV1(saved), saved);
	assert.notEqual(readValidatedPhotoCatalogRootV1(rootInput()), saved);
});

test('raw/shape-only/frozen/spread/structured-cloned/proxied roots are admitted anew rather than acquiring a forged brand', () => {
	const validated = readValidatedPhotoCatalogRootV1(rootInput());
	const candidates = [rootInput(), normalizePhotoCatalogRootV1(rootInput()), Object.freeze({ ...validated }),
		{ ...validated }, structuredClone(validated), JSON.parse(JSON.stringify(validated)) as unknown, new Proxy(validated, {})];
	for (const candidate of candidates) {
		const read = readValidatedPhotoCatalogRootV1(candidate);
		assert.notEqual(read, candidate); assert.deepEqual(read, validated); assert.equal(readValidatedPhotoCatalogRootV1(read), read);
	}
	const parsed = parseLightscaperDocumentV1(serializeLightscaperDocumentV1(validated));
	assert.notEqual(parsed, validated); assert.equal(readValidatedPhotoCatalogRootV1(parsed), parsed);
});

test('forged frozen getters and hostile/revoked proxies cannot obtain reuse or read inherited authority', () => {
	const validated = readValidatedPhotoCatalogRootV1(rootInput()); let getters = 0;
	const forged = Object.freeze(Object.defineProperty({ ...validated }, 'id', { enumerable: true, get() { getters++; return 'catalog'; } }));
	assert.throws(() => readValidatedPhotoCatalogRootV1(forged), TypeError); assert.equal(getters, 0);
	const hostile = new Proxy(validated, { getPrototypeOf() { throw new Error('Caller proxy refused'); } });
	assert.throws(() => readValidatedPhotoCatalogRootV1(hostile), /Caller proxy refused/u);
	const revoked = Proxy.revocable(validated, {}); revoked.revoke(); assert.throws(() => readValidatedPhotoCatalogRootV1(revoked.proxy), TypeError);
	assert.throws(() => readValidatedPhotoCatalogRootV1(Object.create(validated)), TypeError);
	for (const candidate of [null, undefined, true, 17, 'catalog', Symbol('catalog'), () => validated]) {
		assert.throws(() => readValidatedPhotoCatalogRootV1(candidate), TypeError);
	}
});

test('exact2MiB root is reusable; shape-valid frozen oversize roots still refuse full byte admission', () => {
	const maximum = maximumRoot(), validated = readValidatedPhotoCatalogRootV1(maximum);
	assert.equal(readValidatedPhotoCatalogRootV1(validated), validated);
	const oversized = normalizePhotoCatalogRootV1({ ...maximum, name: maximum.name + 'x' });
	assert.equal(Object.isFrozen(oversized), true);
	assert.throws(() => readValidatedPhotoCatalogRootV1(oversized), /byte budget/iu);
	assert.throws(() => validateLightscaperDocumentV1(oversized), /byte budget/iu);
	assert.throws(() => readValidatedPhotoCatalogRootV1({ ...maximum, revision: 10 }), /byte budget/iu);
});

test('photo documents never become reusable catalog roots and every unsupported root field remains closed', () => {
	const photo = validateLightscaperDocumentV1(queryPhotoV1());
	assert.throws(() => readValidatedPhotoCatalogRootV1(photo), /catalog|root/iu);
	for (const candidate of [{ ...rootInput(), extra: true }, { ...rootInput(), schemaVersion: 2 },
		{ ...rootInput(), folders: Array(1) }, { ...rootInput(), [Symbol('brand')]: true }]) {
		assert.throws(() => readValidatedPhotoCatalogRootV1(candidate));
	}
});
