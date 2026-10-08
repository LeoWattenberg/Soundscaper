/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detachPhotoLibrarySavedCommandV1 } from '../src/common/editor/controller/shared/photo-library-saved-command.ts';

const context = () => ({ catalogId: 'catalog', catalogRevision: 4, indexRevision: 3, collectionStateRevision: 2, collectionCount: 1 });
const command = () => ({ type: 'update', context: context(), collectionId: 'saved', expectedDefinitionRevision: 2,
	name: 'Full recipe', queryJson: '{"schemaVersion":2,"kind":"photo-query","text":"tree"}' });

test('saved commands detach every scalar and context before acquisition without parsing recipe semantics', () => {
	const source = command(), admitted = detachPhotoLibrarySavedCommandV1(source);
	source.context.catalogRevision = 100; source.name = 'Changed'; source.queryJson = '{}'; source.collectionId = 'other';
	assert.equal(admitted.context.catalogRevision, 4); assert.equal(admitted.type, 'update');
	if (admitted.type !== 'update') throw new Error('Expected an update.');
	assert.equal(admitted.name, 'Full recipe'); assert.equal(admitted.collectionId, 'saved');
	assert.equal(admitted.queryJson, '{"schemaVersion":2,"kind":"photo-query","text":"tree"}');
	assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.context));
	assert.deepEqual(detachPhotoLibrarySavedCommandV1({ type: 'create', context: context(), name: 'A', queryJson: 'unparsed' }),
		{ type: 'create', context: context(), name: 'A', queryJson: 'unparsed' });
	assert.deepEqual(detachPhotoLibrarySavedCommandV1({ type: 'delete', context: context(), collectionId: 'saved', expectedDefinitionRevision: 2 }),
		{ type: 'delete', context: context(), collectionId: 'saved', expectedDefinitionRevision: 2 });
});

test('closed scalar commands reject accessors, inherited authority and extra fields without reading getters', () => {
	let probes = 0;
	for (const key of ['type', 'context', 'name', 'queryJson', 'collectionId', 'expectedDefinitionRevision']) {
		const source = command(); Object.defineProperty(source, key, { enumerable: true, get() { probes++; throw new Error('Do not invoke'); } });
		assert.throws(() => detachPhotoLibrarySavedCommandV1(source), TypeError);
	}
	const nested = command(); Object.defineProperty(nested.context, 'catalogRevision', { enumerable: true, get() { probes++; return 4; } });
	assert.throws(() => detachPhotoLibrarySavedCommandV1(nested), TypeError);
	for (const source of [{ ...command(), future: true }, { ...command(), [Symbol('future')]: true },
		{ ...command(), context: { ...context(), cursor: 'opaque' } }, Object.create(command()) as unknown,
		{ ...command(), type: 'future' }, { ...command(), type: 'delete' }]) {
		assert.throws(() => detachPhotoLibrarySavedCommandV1(source), TypeError);
	}
	assert.equal(probes, 0);
});

test('recipe bytes and canonical bounded context are admitted before any borrowed host', () => {
	const exact = 'é'.repeat(262_144);
	const admitted = detachPhotoLibrarySavedCommandV1({ ...command(), queryJson: exact });
	assert.equal(admitted.type, 'update'); if (admitted.type === 'update') assert.equal(admitted.queryJson, exact);
	for (const value of [exact + 'a', new String('{}'), null]) assert.throws(() => detachPhotoLibrarySavedCommandV1({ ...command(), queryJson: value }));
	for (const value of [-0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
		assert.throws(() => detachPhotoLibrarySavedCommandV1({ ...command(), context: { ...context(), indexRevision: value } }));
		assert.throws(() => detachPhotoLibrarySavedCommandV1({ ...command(), expectedDefinitionRevision: value }));
	}
	for (const source of [{ ...command(), collectionId: '../saved' }, { ...command(), name: '' }, { ...command(), name: 'a'.repeat(257) },
		{ ...command(), name: 'bad\u0000name' }, { ...command(), context: { ...context(), collectionCount: 10_001 } }]) {
		assert.throws(() => detachPhotoLibrarySavedCommandV1(source));
	}
});
