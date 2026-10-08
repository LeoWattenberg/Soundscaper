/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRestoreDeliveryV1 } from '../src/lightscaper/catalog/photo-catalog-restore-delivery-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { savedArchiveDefinitionV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { stackArchiveRecord } from './helpers/lightscaper-stack-archive-fixture.ts';

test('delivery digests reject self-consistent document rewrites at unchanged identity and revision', () => {
	const ledger = new PhotoCatalogRestoreDeliveryV1('catalog-1'), photo = photoArchiveFixture(1).photo;
	ledger.admit(photo); ledger.assertDelivered(photo);
	assert.throws(() => ledger.assertDelivered({ ...photo, metadata: { ...photo.metadata, title: 'Changed' } }), /delivery/iu);
	assert.throws(() => ledger.assertDelivered({ ...photo, rating: photo.rating === 5 ? 0 : 5 }), /delivery/iu);
	assert.throws(() => ledger.admit(photo), /duplicate/iu);
});

test('kind framing separates equal photo, stack and saved IDs without retaining caller objects', () => {
	const ledger = new PhotoCatalogRestoreDeliveryV1('catalog-1');
	const photo = photoArchiveFixture(1).photo, stack = { ...stackArchiveRecord(), id: photo.id, photoIds: [...stackArchiveRecord().photoIds] };
	const definition = { ...savedArchiveDefinitionV3(), id: photo.id };
	for (const document of [photo, stack, definition]) { ledger.admit(document); ledger.assertDelivered(document); }
	stack.photoIds.reverse(); assert.throws(() => ledger.assertDelivered(stack), /delivery/iu);
	assert.throws(() => ledger.assertDelivered({ ...photo, catalogId: 'foreign' }), /catalog/iu);
});

test('the framed logical-byte ceiling refuses capacity before another digest is retained', () => {
	const ledger = new PhotoCatalogRestoreDeliveryV1('catalog-1', 65), photo = photoArchiveFixture(1).photo;
	ledger.admit(photo); assert.equal(ledger.byteLength, 62);
	assert.throws(() => ledger.admit({ ...photo, id: 'another-photo' }), /budget/iu);
	assert.equal(ledger.byteLength, 62); ledger.assertDelivered(photo);
	ledger.clear(); assert.equal(ledger.byteLength, 13);
	assert.throws(() => ledger.assertDelivered(photo), /delivery/iu);
	assert.throws(() => new PhotoCatalogRestoreDeliveryV1('catalog-1', 16 * 1024 * 1024 + 1));
});
