/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageDevelopResourceReachabilityCurrentV1 } from '../src/common/editor/imaging/image-develop-resource-reachability-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageDevelopStateThroughV3 } from '../src/common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { createPhotoDevelopWorkspaceCurrentV1, savePhotoDevelopSnapshotCurrentV1,
	commitPhotoDevelopWorkspaceCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const STEP = { label: 'Recovered source', createdAt: '2026-10-20T00:00:00.000Z' };
const sha = (index: number) => index.toString(16).padStart(64, '0');
function brush(index: number) {
	return { storageKey: `brush-mask-v1:2:1:${sha(index)}`, sha256: sha(index), width: 2, height: 1, byteLength: 18 };
}
function lut(index: number) {
	return { storageKey: `lut-sha256:${sha(index)}`, sha256: sha(index), byteLength: 73, size: 2,
		domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function recipe(index = 1, mode: 'canonical' | 'headroom' | 'recovery' = 'recovery') {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode }, repairs: { schemaVersion: 1, spots: [] },
		effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: lut(index) } }],
		masks: [{ schemaVersion: 2, id: 'paint', name: 'Retained mask', kind: 'matte',
			inputs: [{ name: 'Used', kind: 'alpha', sourceRef: brush(index).storageKey },
				{ name: 'Unused', kind: 'raster', sourceRef: brush(index + 1).storageKey }],
			nodes: [{ id: 'coverage', kind: 'alpha', inputName: 'Used' }], outputNodeId: 'coverage' }], maskBindings: [] });
}

test('Current closure retains complete process4 disabled LUT and unused brush declarations without changing RAW metadata', () => {
	const input = recipe(), wire = JSON.stringify(input), collector = createImageDevelopResourceReachabilityCurrentV1();
	collector.addDevelop(input); collector.addDevelop(recipe(1, 'headroom'));
	const result = collector.finish();
	assert.deepEqual(result, { luts: [lut(1)], brushes: [brush(1), brush(2)] });
	assert.equal(JSON.stringify(input), wire); assert.deepEqual(Object.keys(result).sort(), ['brushes', 'luts']);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.luts[0])); assert.ok(Object.isFrozen(result.brushes[0]));
	assert.equal(collector.finish(), result);
});

test('Current closure validates the complete RAW slot atomically before enrolling otherwise valid resource references', () => {
	const collector = createImageDevelopResourceReachabilityCurrentV1(); collector.addDevelop(recipe()); let invoked = 0;
	const accessor = Object.defineProperty({ ...recipe(20) }, 'rawDevelopment', { enumerable: true,
		get() { invoked++; return { schemaVersion: 1, mode: 'recovery' }; } });
	for (const invalid of [accessor, { ...recipe(20), rawDevelopment: { schemaVersion: 1, mode: 'future' } },
		{ ...recipe(20), rawDevelopment: { schemaVersion: 1, mode: 'recovery', bytes: new Uint8Array(1) } }]) {
		assert.throws(() => collector.addDevelop(invalid));
	}
	assert.equal(invoked, 0); assert.deepEqual(collector.finish(), { luts: [lut(1)], brushes: [brush(1), brush(2)] });
});

test('Current Photo3 closure walks retained process4 history and snapshots even when the selected recipe is canonical legacy', () => {
	const template = queryPhotoV1(), first = recipe(1), second = recipe(3, 'headroom');
	let workspace = savePhotoDevelopSnapshotCurrentV1(createPhotoDevelopWorkspaceCurrentV1(first, STEP),
		{ id: 'recovered', name: 'Recovered', createdAt: STEP.createdAt });
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, second, { ...STEP, label: 'Headroom' });
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, defaultImageDevelopStateV1(), { ...STEP, label: 'Canonical' });
	const input = { ...template, schemaVersion: 3, versions: template.versions.map(version => ({ ...version,
		develop: defaultImageDevelopStateV1(), workspace })) };
	const photo = normalizePhotoDocumentCurrentV1(input), before = JSON.stringify(photo), collector = createPhotoResourceReachabilityCurrentV1();
	collector.addPhoto(photo);
	assert.deepEqual(collector.finish(), { luts: [lut(1), lut(3)], brushes: [brush(1), brush(2), brush(3), brush(4)] });
	assert.equal(JSON.stringify(photo), before); assert.deepEqual(photo.original, template.original);
	assert.equal(photo.versions[0]!.develop.processVersion, 1); assert.equal(photo.versions[0]!.workspace!.schemaVersion, 4);
	assert.throws(() => normalizePhotoDocumentV3(input), 'A hidden retained process4 must not enter the permanent Photo3 facade.');
});

test('Explicit Current resource admission does not widen the central alias or permanent through3 normalizer', () => {
	const value = recipe();
	assert.throws(() => normalizeImageDevelopStateThroughV3(value));
	assert.throws(() => normalizeImageDevelopStateCurrentV1(value));
	const old = defaultImageDevelopStateV1(), collector = createImageDevelopResourceReachabilityCurrentV1();
	collector.addDevelop(old); assert.deepEqual(collector.finish(), { luts: [], brushes: [] });
	assert.deepEqual(normalizeImageDevelopStateThroughV3(old), old);
});
