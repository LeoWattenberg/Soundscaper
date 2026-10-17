/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { serializeLightscaperDocumentV1, validateLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { normalizePhotoDocumentV2, normalizePhotoDocumentV1OrV2, parsePhotoDocumentV1OrV2,
	serializePhotoDocumentV1OrV2, upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';

const CREATED = '2026-10-09T00:00:00.000Z';
const develop = () => ({ ...defaultImageDevelopStateV1(), processVersion: 2, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false,
	params: { lut: { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] });

test('Photo2 is explicit while old documents and immutable original bytes remain exact', () => {
	const { photo } = photoArchiveFixture();
	assert.equal(serializePhotoDocumentV1OrV2(photo), serializeLightscaperDocumentV1(photo));
	assert.deepEqual(normalizePhotoDocumentV1OrV2(photo), photo);
	const successor = upgradePhotoDocumentV2(photo);
	assert.deepEqual(successor, { ...photo, schemaVersion: 2 });
	assert.deepEqual(successor.original, photo.original);
	assert.deepEqual(upgradePhotoDocumentV2(successor), successor);
	assert.throws(() => normalizePhotoDocumentV1(successor));
	assert.throws(() => validateLightscaperDocumentV1(successor));
	assert.throws(() => normalizePhotoDocumentV2(photo));
});

test('Photo2 versions retain mixed processes and undo-selected history with LUT-only redo', () => {
	const { photo } = photoArchiveFixture();
	let workspace = createPhotoDevelopWorkspaceV2(photo.versions[0]!.develop, { label: 'Original', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop(), { label: 'LUT', createdAt: CREATED });
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	const successor = normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [
		{ ...photo.versions[0], workspace },
		{ id: 'copy', kind: 'virtual-copy', name: 'LUT copy', createdAt: CREATED, develop: develop() },
	] });
	const reopened = parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(successor));
	assert.deepEqual(reopened, successor);
	assert.equal(reopened.versions[0]?.develop.processVersion, 1);
	assert.equal(reopened.versions[0]?.workspace?.entries[1]?.develop.processVersion, 2);
	assert.deepEqual(reopened.versions[1]?.develop.effects[0]?.params.lut, develop().effects[0]!.params.lut);
	assert.deepEqual(reopened.original, photo.original);
	assert.equal(reopened.schemaVersion, 2);
});

test('Photo2 refuses mismatch between active develop and selected history without discarding references', () => {
	const { photo } = photoArchiveFixture();
	const workspace = createPhotoDevelopWorkspaceV2(develop(), { label: 'LUT', createdAt: CREATED });
	assert.throws(() => normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [{ ...photo.versions[0], workspace }] }));
	const coherent = normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [{ ...photo.versions[0], develop: develop(), workspace }] });
	assert.deepEqual(coherent.versions[0]?.workspace?.entries[0]?.develop, coherent.versions[0]?.develop);
	assert.throws(() => normalizePhotoDocumentV1({ ...coherent, schemaVersion: 1 }));
});

test('Photo2 preserves exact decomposed original names and existing metadata admission', () => {
	const { photo } = photoArchiveFixture();
	const exactName = '原本 e\u0301 ÉTÉ.PNG';
	const raw = { ...photo, schemaVersion: 2, original: { ...photo.original, name: exactName }, metadata: { ...photo.metadata, fileName: exactName } };
	const normalized = normalizePhotoDocumentV2(raw);
	assert.equal(normalized.original.name, exactName); assert.equal(normalized.metadata.fileName, exactName);
	assert.deepEqual(parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(normalized)), normalized);
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, original: { ...raw.original, name: 'x'.repeat(513) } }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, original: { ...raw.original, retention: 'remote' } }));
});

test('Photo2 keeps closed own-data, family, version, master and active-version admission', () => {
	const raw = { ...photoArchiveFixture().photo, schemaVersion: 2 };
	for (const schemaVersion of [0, 3, '2']) assert.throws(() => normalizePhotoDocumentV1OrV2({ ...raw, schemaVersion }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, schemaFamily: 'framescaper' }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, kind: 'photo-catalog' }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, activeVersionId: 'missing' }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, versions: [...raw.versions, ...raw.versions] }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, versions: raw.versions.map(version => ({ ...version, kind: 'virtual-copy' })) }));
	assert.throws(() => normalizePhotoDocumentV2({ ...raw, lutBytes: new Uint8Array(88) }));
	let calls = 0;
	const accessor = Object.defineProperty({ ...raw }, 'versions', { enumerable: true, get() { calls++; return raw.versions; } });
	assert.throws(() => normalizePhotoDocumentV2(accessor)); assert.equal(calls, 0);
	assert.throws(() => parsePhotoDocumentV1OrV2(' '.repeat(2_097_153)));
	assert.throws(() => parsePhotoDocumentV1OrV2(`"${'é'.repeat(1_048_576)}"`));
});

test('Photo2 applies the document byte limit across versions as well as each individual workspace', () => {
	const { photo } = photoArchiveFixture();
	const large = { ...develop(), effects: Array.from({ length: 256 }, (_, index) => ({ ...develop().effects[0], id: `profile-${String(index)}` })) };
	const entry = { label: 'LUT stack', createdAt: CREATED, develop: large };
	const workspace = { schemaVersion: 2, kind: 'photo-develop-workspace', entries: Array.from({ length: 14 }, () => entry), cursor: 0, snapshots: [] };
	const version = { ...photo.versions[0], develop: large, workspace };
	const one = normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [version] });
	assert.ok(new TextEncoder().encode(serializePhotoDocumentV1OrV2(one)).byteLength <= 2_097_152);
	assert.throws(() => normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [version,
		{ ...version, id: 'copy', kind: 'virtual-copy' }] }), /byte budget/u);
});

test('the mixed document owner also retains the legacy full-document byte gate', () => {
	const { photo } = photoArchiveFixture();
	const develop = { ...defaultImageDevelopStateV1(), effects: Array.from({ length: 256 }, (_, index) => ({
		id: `color-${String(index)}`, type: 'color-adjust', enabled: true, params: { brightness: 0.125 },
	})) };
	const workspace = { schemaVersion: 1, kind: 'photo-develop-workspace', entries: Array.from({ length: 40 }, () => ({
		label: 'Color edit', createdAt: CREATED, develop,
	})), cursor: 0, snapshots: [] };
	const version = { ...photo.versions[0], develop, workspace };
	const one = { ...photo, versions: [version] };
	assert.equal(serializePhotoDocumentV1OrV2(one), serializeLightscaperDocumentV1(one));
	const two = { ...photo, versions: [version, { ...version, id: 'copy', kind: 'virtual-copy' }] };
	assert.throws(() => validateLightscaperDocumentV1(two), /byte budget/u);
	assert.throws(() => normalizePhotoDocumentV1OrV2(two), /byte budget/u);
});
