/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const DIRECTORY = 'src/common/editor/';
const MERGE = [
	'controller/shared/image-hdr-merge-current-v1.ts', 'controller/shared/image-hdr-merge-preview-current-v1.ts',
	'controller/shared/image-hdr-merge-authoring-current-v1.ts',
	...['capture', 'source-staging', 'owner', 'authoring-owner'].map(name => `controller/shared/internal/image-hdr-merge-${name}-current-v1.ts`),
	'storage/image-hdr-pixel-staging-v1.ts', 'imaging/image-hdr-merge-contract-v1.ts',
	'imaging/image-hdr-alignment-v1.ts', 'imaging/image-hdr-radiance-v1.ts',
];
const PROOF = ['timeline-image-hdr-original-current-v1.ts', 'imaging/image-hdr-original-v1.ts', 'imaging/image-hdr-original-contract-v1.ts'];

for (const [owner, modules] of [['editor-hdr-merge', MERGE], ['editor-hdr-original-proof', PROOF]] as const) test(`${owner} owns the exact optional executable HDR closure`, () => {
	for (const module of modules) {
		const path = DIRECTORY + module;
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner, path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
		assert.notEqual(chunkGroupForModulePath(path.replace('-v1.ts', '-future-v1.ts')), owner);
	}
	const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
});

test('inert HDR declarations and scalar planning retain their ordinary startup owners', () => {
	for (const module of ['imaging/image-hdr-original-profile-v1.ts', 'timeline-image-hdr-receipt-v1.ts',
		'timeline-image-model-hdr-current-v1.ts', 'timeline-image-model-current-v1.ts', 'timeline-image-native-body-current-v1.ts']) {
		const owner = chunkGroupForModulePath(DIRECTORY + module);
		assert.ok(owner === 'editor-imaging' || owner === 'editor-domain', module);
	}
	for (const module of ['imaging/image-develop-linear-owner-v1.ts', 'timeline-image-raw-pack-current-v1.ts', 'storage/opfs-repository.js']) {
		assert.notEqual(chunkGroupForModulePath(DIRECTORY + module), 'editor-hdr-merge');
		assert.notEqual(chunkGroupForModulePath(DIRECTORY + module), 'editor-hdr-original-proof');
	}
});

test('eager Frame HDR registration and scalar planning share the existing timeline image owner', () => {
	for (const module of ['editor-selected-image-hdr-merge-current-v1.ts', 'internal/timeline-image-hdr-working-plan-current-v1.ts',
		'internal/timeline-image-publication-transition-v1.ts']) {
		const path = `src/framescaper/${module}`;
		assert.equal(chunkGroupForModulePath(path), 'framescaper-timeline-images', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'framescaper-timeline-images', path);
	}
	for (const module of ['internal/selected-image-hdr-merge-session-current-v1.ts',
		'internal/image-hdr-merge-frame-source-current-v1.ts', 'internal/image-hdr-merge-frame-result-current-v1.ts']) {
		assert.notEqual(chunkGroupForModulePath(`src/framescaper/${module}`), 'framescaper-timeline-images', module);
	}
});

test('inert Source5 metadata shares imaging ownership with native image contracts', () => {
	for (const module of ['timeline-image-model-hdr-current-v1.ts', 'timeline-image-hdr-receipt-v1.ts',
		'image-develop-handoff-provenance-hdr-current-v1.ts']) {
		const path = DIRECTORY + module;
		assert.equal(chunkGroupForModulePath(path), 'editor-imaging', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-imaging', path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-imaging');
	}
});
