/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detachPhotoLibraryDevelopCommandV2, detachPhotoLibraryDevelopSettingsV2 } from '../src/common/editor/controller/shared/photo-library-develop-command-v2.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';

test('current command transport admits mixed strict recipes and detaches disabled closed refs before host acquisition', () => {
	const reference = { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2,
		domainMin: [0, 0, 0] as [number, number, number], domainMax: [1, 1, 1] as [number, number, number] };
	const input = { ...currentRecipe(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: reference } }] };
	const command = detachPhotoLibraryDevelopCommandV2({ type: 'record-develop', versionId: 'master', develop: input, label: 'Profile', createdAt: '2026-10-09T00:00:00.000Z' });
	reference.domainMax[0] = 2; reference.storageKey = 'changed';
	assert.equal(command.type, 'record-develop');
	if (command.type !== 'record-develop') assert.fail('Wrong command');
	assert.deepEqual(command.develop, currentRecipe());
	assert.deepEqual(detachPhotoLibraryDevelopSettingsV2(defaultImageDevelopStateV1()), defaultImageDevelopStateV1());
	assert.deepEqual(detachPhotoLibraryDevelopSettingsV2(currentRecipe(null)), currentRecipe(null));
	assert.throws(() => normalizeImageDevelopStateV1(input));
	assert.throws(() => detachPhotoLibraryDevelopSettingsV2({ ...input, processVersion: 3 }));
});

test('current transport preserves a complete canonical mask and refuses accessors, hidden bodies and byte overflow', () => {
	const develop = normalizeImageDevelopStateV2({ ...currentRecipe(null), masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'path', nodes: [{
		id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
			points: Array.from({ length: 16_384 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null })) }],
	}] }] });
	assert.deepEqual(detachPhotoLibraryDevelopSettingsV2(develop), develop);
	let calls = 0;
	assert.throws(() => detachPhotoLibraryDevelopSettingsV2({ ...develop, get effects() { calls++; return []; } }));
	assert.throws(() => detachPhotoLibraryDevelopSettingsV2({ ...currentRecipe(), effects: [{ ...currentRecipe().effects[0], params: { lut: { ...currentRecipe().effects[0]!.params.lut as object, bytes: [1] } } }] }));
	assert.throws(() => detachPhotoLibraryDevelopCommandV2({ type: 'record-develop', versionId: 'master', develop, label: 'x'.repeat(2_097_152), createdAt: '2026-10-09T00:00:00.000Z' }));
	assert.equal(calls, 0);
});

test('every current scalar workspace command is closed and stable while legacy recipe bytes are unchanged', () => {
	const command = { type: 'create-virtual-copy', sourceVersionId: 'master', id: 'copy', name: 'Copy', createdAt: '2026-10-09T00:00:00.000Z' };
	assert.deepEqual(detachPhotoLibraryDevelopCommandV2(command), command);
	assert.throws(() => detachPhotoLibraryDevelopCommandV2({ ...command, body: 'hidden' }));
	assert.throws(() => detachPhotoLibraryDevelopCommandV2({ type: 'activate-version', versionId: 'master', createdAt: command.createdAt }));
	const legacy = defaultImageDevelopStateV1(); assert.equal(JSON.stringify(detachPhotoLibraryDevelopSettingsV2(legacy)), JSON.stringify(legacy));
});
