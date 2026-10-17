/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1, parsePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { canonicalPhotoDocumentJsonV1 } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { createPhotoDevelopWorkspaceCurrentV1, savePhotoDevelopSnapshotCurrentV1, commitPhotoDevelopWorkspaceCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const STEP = { label: 'Raw processing', createdAt: '2026-10-15T08:00:00.000Z' };
function photo() {
	const template = queryPhotoV1(), develop = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode: 'recovery' });
	const workspace = savePhotoDevelopSnapshotCurrentV1(createPhotoDevelopWorkspaceCurrentV1(develop, STEP),
		{ id: 'recovery-snapshot', name: 'Recovered', createdAt: STEP.createdAt });
	return { ...template, schemaVersion: 3, versions: template.versions.map(version => ({ ...version, develop, workspace })) };
}

test('Current Photo3 aggregate preserves process4, workspace4 and exact Original identity through real JSON serialization', () => {
	const input = photo(), before = structuredClone(input.original), admitted = normalizePhotoDocumentCurrentV1(input);
	assert.equal(admitted.schemaVersion, 3); assert.deepEqual(admitted.original, before);
	const wire = serializePhotoDocumentCurrentV1(admitted), reopened = parsePhotoDocumentCurrentV1(wire);
	assert.equal(serializePhotoDocumentCurrentV1(reopened), wire); assert.deepEqual(reopened, admitted);
	assert.equal(reopened.versions[0]!.develop.processVersion, 4); assert.equal(reopened.versions[0]!.workspace!.schemaVersion, 4);
	assert.deepEqual(reopened.versions[0]!.workspace!.snapshots[0]!.develop, admitted.versions[0]!.develop);
	assert.deepEqual(reopened.original, before); assert.ok(Object.isFrozen(reopened));
});

test('permanent Photo1/2/3 readers reject the successor while Current rejects mismatched selected history and hostile source recipes', () => {
	const value = photo();
	for (const reader of [normalizePhotoDocumentV1, normalizePhotoDocumentV2, normalizePhotoDocumentV3]) assert.throws(() => reader(value));
	const changed = setImageDevelopRawDevelopmentCurrentV1(value.versions[0]!.develop, { schemaVersion: 1, mode: 'headroom' });
	assert.throws(() => normalizePhotoDocumentCurrentV1({ ...value, versions: value.versions.map(version => ({ ...version, develop: changed })) }));
	assert.throws(() => normalizePhotoDocumentCurrentV1({ ...value, versions: value.versions.map(version => ({ ...version,
		develop: { ...version.develop, rawDevelopment: { schemaVersion: 1, mode: 'future' } } })) }));
});

test('Current reads retain old Photo serialization and keep an explicitly promoted history envelope when restoring canonical settings', () => {
	for (const value of [queryPhotoV1(), { ...queryPhotoV1(), schemaVersion: 2 }, { ...queryPhotoV1(), schemaVersion: 3 }]) {
		const fixed = value.schemaVersion === 1 ? normalizePhotoDocumentV1(value) : value.schemaVersion === 2 ? normalizePhotoDocumentV2(value) : normalizePhotoDocumentV3(value);
		assert.equal(serializePhotoDocumentCurrentV1(value), canonicalPhotoDocumentJsonV1(fixed));
	}
	const value = photo(), version = value.versions[0]!, develop = defaultImageDevelopStateV1();
	const workspace = commitPhotoDevelopWorkspaceCurrentV1(version.workspace, develop, { ...STEP, label: 'Canonical history' });
	const admitted = normalizePhotoDocumentCurrentV1({ ...value, versions: [{ ...version, develop, workspace }] });
	assert.equal(admitted.versions[0]!.develop.processVersion, 1); assert.equal(admitted.versions[0]!.workspace!.schemaVersion, 4);
	assert.deepEqual(admitted.versions[0]!.workspace!.snapshots[0]!.develop, version.develop);
});
