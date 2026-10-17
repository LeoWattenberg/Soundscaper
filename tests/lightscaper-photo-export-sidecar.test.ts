/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, normalizePhotoExportSidecarV1, parsePhotoExportSidecarV1, serializePhotoExportSidecarV1,
	PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1, PHOTO_EXPORT_SIDECAR_SUFFIX_V1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';

const binding = () => ({ catalogId: 'catalog-1', photoId: 'photo-1', versionId: 'version-1', expectedRevision: 0 });
const HASH = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const GOLDEN = '{"binding":{"activeVersionId":"version-1","catalogId":"catalog-1","photoId":"photo-1","revision":0},'
	+ '"extractedMetadata":null,"kind":"photo-export-sidecar","metadata":{"aperture":null,"cameraMake":null,"cameraModel":null,'
	+ '"caption":"","captureTime":null,"copyright":"","creator":"","exposureSeconds":null,"fileName":"Photo 1.png",'
	+ '"focalLengthMm":null,"iso":null,"lens":null,"location":"","modifiedTime":null,"orientation":1,"title":""},'
	+ '"original":{"byteLength":3,"contentSha256":"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81","fileName":"Photo 1.png"},'
	+ '"photoSchemaVersion":1,"schemaFamily":"lightscaper","schemaVersion":1,"version":{"createdAt":"2026-10-07T00:00:00.000Z",'
	+ '"develop":{"effects":[],"geometry":{"crop":null,"flipHorizontal":false,"flipVertical":false,"rotationDegrees":0},'
	+ '"maskBindings":[],"masks":[],"processVersion":1},"id":"version-1","kind":"master","name":"Original"}}';
const sidecar = () => createPhotoExportSidecarV1(photoArchiveFixture().photo, binding());
const reference = () => ({ storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
function successor() {
	const photo = photoArchiveFixture().photo, develop = { ...photo.versions[0]!.develop, processVersion: 2,
		effects: [{ id: 'before', type: 'dehaze-v1', enabled: true, params: { amount: 37.125 } },
			{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: reference() } }],
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [
			{ id: 'second', kind: 'vector-shape', shape: 'rectangle', x: 0.25, y: 0, width: 0.5, height: 1 },
			{ id: 'first', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'second' }],
		maskBindings: [{ effectId: 'profile', maskId: 'mask' }] };
	return normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, revision: 7, versions: [photo.versions[0],
		{ id: 'copy', kind: 'virtual-copy', name: 'Saved copy', createdAt: '2026-10-09T00:00:00.000Z', develop }] });
}

test('sidecar pins independent canonical JSON and explicit Lightscaper filename/MIME identity', () => {
	const packet = sidecar();
	assert.equal(packet.original.contentSha256, HASH);
	assert.equal(serializePhotoExportSidecarV1(packet), GOLDEN);
	assert.deepEqual(parsePhotoExportSidecarV1(GOLDEN), packet);
	assert.equal(PHOTO_EXPORT_SIDECAR_SUFFIX_V1, '.lightscaper.json');
	assert.equal(PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1, 'application/json');
});

test('canonical keys ignore insertion order while nested ordered recipe arrays remain exact', () => {
	const photo = successor(), packet = createPhotoExportSidecarV1(photo, { ...binding(), versionId: 'copy', expectedRevision: 7 });
	const shuffled = Object.fromEntries(Object.entries(packet).reverse());
	assert.equal(serializePhotoExportSidecarV1(shuffled), serializePhotoExportSidecarV1(packet));
	assert.equal(packet.photoSchemaVersion, 2); assert.equal(packet.version.develop.processVersion, 2);
	assert.equal(packet.version.id, 'copy'); assert.equal(packet.binding.activeVersionId, 'version-1');
	assert.deepEqual(packet.version.develop.effects.map(effect => effect.id), ['before', 'profile']);
	assert.deepEqual(packet.version.develop.effects[1]?.params.lut, reference());
	assert.deepEqual(packet.version.develop.masks[0]?.nodes.map(node => node.id), ['first', 'second']);
	assert.deepEqual(packet.version.develop.maskBindings, [{ effectId: 'profile', maskId: 'mask' }]);
	assert.deepEqual(packet.version.develop, photo.versions[1]?.develop);
	assert.deepEqual(parsePhotoExportSidecarV1(serializePhotoExportSidecarV1(packet)), packet);
});

test('Photo2 with a process1 selected version stays mixed without implicit promotion', () => {
	const photo = successor(), packet = createPhotoExportSidecarV1(photo, { ...binding(), expectedRevision: 7 });
	assert.equal(packet.photoSchemaVersion, 2); assert.equal(packet.version.develop.processVersion, 1);
	assert.deepEqual(packet.version.develop, photo.versions[0]?.develop);
});

test('authored Unicode and renamed filename remain separate from exact original and raw capture facts', () => {
	const raw = photoArchiveFixture().photo, originalName = '原本 e\u0301 ÉTÉ.PNG';
	const extracted = { schemaVersion: 1, container: 'png', iptc: null, issues: [], exif: {
		orientation: 8, cameraMake: 'Camera', cameraModel: null, lensModel: null, artist: 'Original artist', copyright: null,
		description: null, exposureSeconds: 1 / 125, aperture: null, iso: 4_000_000_000, focalLengthMm: null,
		captureTime: null, captureTimeRaw: { dateTimeOriginal: '2020:  :   12:00:00', offsetTimeOriginal: '   :  ', subsecondOriginal: '0010' } } };
	const photo = { ...raw, original: { ...raw.original, name: originalName }, extractedMetadata: extracted,
		metadata: { ...raw.metadata, fileName: 'Renamed.png', title: '日本語 café', creator: 'Authored creator',
			captureTime: { local: '2020-03-04T12:00:00', offsetMinutes: null } } };
	const before = JSON.stringify(photo), packet = createPhotoExportSidecarV1(photo, binding());
	assert.equal(packet.original.fileName, originalName); assert.equal(packet.metadata.fileName, 'Renamed.png');
	assert.equal(packet.metadata.title, '日本語 café'); assert.equal(packet.metadata.creator, 'Authored creator');
	assert.equal(packet.extractedMetadata?.exif?.artist, 'Original artist');
	assert.deepEqual(packet.extractedMetadata?.exif?.captureTimeRaw, extracted.exif.captureTimeRaw);
	assert.equal(packet.extractedMetadata?.exif?.captureTime, null);
	assert.equal(packet.metadata.captureTime?.offsetMinutes, null);
	assert.equal(JSON.stringify(photo), before);
	assert.deepEqual(parsePhotoExportSidecarV1(serializePhotoExportSidecarV1(packet)), packet);
});

test('capture detaches every retained recipe/metadata branch and never delivers source storage or bodies', () => {
	const source = successor(), metadata = { ...source.metadata }, geometry = { ...source.versions[1]!.develop.geometry };
	const photo = { ...source, metadata, versions: [source.versions[0], { ...source.versions[1], develop: { ...source.versions[1]!.develop, geometry } }] };
	const before = serializePhotoDocumentV1OrV2(photo);
	const packet = createPhotoExportSidecarV1(photo, { ...binding(), versionId: 'copy', expectedRevision: 7 }), text = serializePhotoExportSidecarV1(packet);
	assert.equal(serializePhotoDocumentV1OrV2(photo), before);
	assert.notEqual(packet.version.develop, photo.versions[1]?.develop); assert.notEqual(packet.metadata, photo.metadata);
	assert.ok(Object.isFrozen(packet) && Object.isFrozen(packet.binding) && Object.isFrozen(packet.version.develop.effects));
	metadata.title = 'Later'; geometry.rotationDegrees = 10;
	assert.equal(serializePhotoExportSidecarV1(packet), text);
	for (const field of ['storageKey', 'retention', 'body', 'pixels', 'versions', 'workspace']) assert.equal(Object.hasOwn(packet.original, field), false);
	assert.deepEqual(Object.keys(packet.version).sort(), ['createdAt', 'develop', 'id', 'kind', 'name']);
	assert.equal(text.includes('original-1'), false);
});

test('captured binding refuses wrong catalog/photo/revision/missing version before projection', () => {
	const photo = photoArchiveFixture().photo;
	for (const changed of [{ catalogId: 'other' }, { photoId: 'other' }, { expectedRevision: 1 }, { versionId: 'missing' }]) {
		assert.throws(() => createPhotoExportSidecarV1(photo, { ...binding(), ...changed }), /identity|revision|version/iu);
	}
	let recipeReflections = 0;
	const develop = new Proxy(photo.versions[0]!.develop, { getPrototypeOf(target) { recipeReflections++; return Object.getPrototypeOf(target); } });
	assert.throws(() => createPhotoExportSidecarV1({ ...photo, versions: [{ ...photo.versions[0], develop }] }, { ...binding(), expectedRevision: 1 }));
	assert.equal(recipeReflections, 0);
	const changing = { ...photo, revision: 0, versions: [...photo.versions] };
	const lateChange = new Proxy(photo.versions[0]!.develop, { getPrototypeOf(target) { changing.revision = 1; return Object.getPrototypeOf(target); } });
	changing.versions = [{ ...photo.versions[0]!, develop: lateChange }];
	assert.throws(() => createPhotoExportSidecarV1(changing, binding()), /identity|revision/iu);
});

test('binding is closed own-data and refuses accessors/inherited IDs before recipe work', () => {
	const photo = photoArchiveFixture().photo; let calls = 0;
	const accessor = Object.defineProperty(binding(), 'photoId', { enumerable: true, get() { calls++; return 'photo-1'; } });
	for (const value of [accessor, { ...binding(), target: {} }, { ...binding(), versionId: 'bad id' }, { ...binding(), expectedRevision: -1 },
		Object.assign(Object.create(binding()) as object, { versionId: 'version-1' })]) assert.throws(() => createPhotoExportSidecarV1(photo, value as ReturnType<typeof binding>));
	assert.equal(calls, 0);
});

test('all known source photo/workspace/process versions are admitted before exporting a subset', () => {
	const photo = photoArchiveFixture().photo;
	for (const value of [{ ...photo, schemaVersion: 3 }, { ...photo, versions: [{ ...photo.versions[0], develop: { ...photo.versions[0]!.develop, processVersion: 3 } }] },
		{ ...photo, versions: [{ ...photo.versions[0], workspace: { schemaVersion: 3 } }] }]) assert.throws(() => createPhotoExportSidecarV1(value, binding()));
});

test('sidecar parser refuses future family/envelope/photo/process/metadata schemas without rewriting', () => {
	const packet = sidecar();
	for (const value of [{ ...packet, schemaFamily: 'framescaper' }, { ...packet, schemaVersion: 2 }, { ...packet, kind: 'photo' },
		{ ...packet, photoSchemaVersion: 3 }, { ...packet, version: { ...packet.version, develop: { ...packet.version.develop, processVersion: 3 } } },
		{ ...packet, extractedMetadata: { schemaVersion: 2, container: 'unsupported', exif: null, iptc: null, issues: [] } }]) {
		assert.throws(() => parsePhotoExportSidecarV1(JSON.stringify(value)));
	}
	const newer = createPhotoExportSidecarV1(successor(), { ...binding(), versionId: 'copy', expectedRevision: 7 });
	assert.throws(() => normalizePhotoExportSidecarV1({ ...newer, photoSchemaVersion: 1 }));
});

test('original scalar identity and version identity retain strict digest/size/name admission', () => {
	const packet = sidecar();
	for (const original of [{ ...packet.original, contentSha256: 'A'.repeat(64) }, { ...packet.original, byteLength: 0 },
		{ ...packet.original, byteLength: 1.5 }, { ...packet.original, fileName: 'x'.repeat(513) }, { ...packet.original, storageKey: 'original-1' }]) {
		assert.throws(() => normalizePhotoExportSidecarV1({ ...packet, original }));
	}
	assert.throws(() => normalizePhotoExportSidecarV1({ ...packet, binding: { ...packet.binding, revision: -1 } }));
	assert.throws(() => normalizePhotoExportSidecarV1({ ...packet, version: { ...packet.version, id: 'invalid id' } }));
});

test('closed sidecar fields reject accessor/extra output authority without invoking getters', () => {
	const packet = sidecar(); let calls = 0;
	const accessor = Object.defineProperty({ ...packet }, 'metadata', { enumerable: true, get() { calls++; return packet.metadata; } });
	for (const value of [accessor, { ...packet, output: { sizing: { kind: 'original' } } }, { ...packet, blob: new Blob() },
		{ ...packet, version: { ...packet.version, workspace: {} } }]) assert.throws(() => normalizePhotoExportSidecarV1(value));
	assert.equal(calls, 0);
});

test('JSON text checks the 2 MiB UTF-8 bound before parsing and rejects malformed/non-text input', () => {
	assert.throws(() => parsePhotoExportSidecarV1(' '.repeat(2_097_153)), /byte budget/u);
	assert.throws(() => parsePhotoExportSidecarV1(`"${'é'.repeat(1_048_576)}"`), /byte budget/u);
	assert.throws(() => parsePhotoExportSidecarV1('{'));
	assert.throws(() => parsePhotoExportSidecarV1(null as unknown as string));
	assert.ok(new TextEncoder().encode(serializePhotoExportSidecarV1(sidecar())).byteLength < 2_097_152);
});
