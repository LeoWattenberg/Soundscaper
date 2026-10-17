/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detachPhotoLibraryDevelopCommandV1, detachPhotoLibraryDevelopSettingsV1 } from '../src/common/editor/controller/shared/photo-library-develop-command.ts';
import { normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';

test('transport preserves a full canonical 16384-point local mask without narrowing the 2 MiB recipe', () => {
	const develop = normalizePhotoDevelopV1({ processVersion: 1, effects: [], geometry: {
		crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false }, maskBindings: [], masks: [{
		schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'path', nodes: [{
			id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
				points: Array.from({ length: 16_384 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null })) }],
		}],
	}] });
	assert.ok(new TextEncoder().encode(JSON.stringify(develop)).byteLength < 2_097_152);
	assert.deepEqual(detachPhotoLibraryDevelopSettingsV1(develop), develop);
	const command = detachPhotoLibraryDevelopCommandV1({ type: 'record-develop', versionId: 'master', develop,
		label: 'Local settings preserved', createdAt: '2026-10-09T00:00:00.000Z' });
	assert.equal(command.type, 'record-develop');
	assert.deepEqual(command.type === 'record-develop' && command.develop, develop);
});

test('byte-accounted transport refuses oversized inert input without invoking accessors or toJSON', () => {
	const base = { processVersion: 1, effects: [], geometry: {}, masks: [], maskBindings: [] };
	assert.throws(() => detachPhotoLibraryDevelopSettingsV1({ ...base, effects: ['x'.repeat(2_097_152)] }), /byte/iu);
	let calls = 0;
	assert.throws(() => detachPhotoLibraryDevelopSettingsV1({ ...base, geometry: { get crop() { calls++; return null; } } }), /accessor|data property/iu);
	assert.throws(() => detachPhotoLibraryDevelopSettingsV1({ ...base, geometry: { toJSON() { calls++; return {}; } } }), /scalar|inert/iu);
	assert.equal(calls, 0);
});
