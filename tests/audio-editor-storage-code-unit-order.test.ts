/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { planDerivativeCacheEviction } from '../src/common/editor/storage/derivative-cache-policy.ts';
import { projectProtectedLinkedOriginalSourceReferences } from '../src/common/editor/storage/project-publication-options.ts';
import { sortProjects } from '../src/common/editor/storage/project-repository-support.ts';
import { freezeRawPcmSpoolGlobalInventory } from '../src/common/editor/storage/raw-pcm-spool-global-inventory.ts';

const ORDERED_STORAGE_SOURCES = Object.freeze([
	'src/common/editor/storage/derivative-cache-policy.ts',
	'src/common/editor/storage/project-publication-options.ts',
	'src/common/editor/storage/encoded-capture-spool-repository.ts',
	'src/common/editor/storage/framescaper-capture-creation-admission.ts',
	'src/common/editor/storage/framescaper-capture-session-manifest-repository.ts',
	'src/common/editor/storage/framescaper-capture-session-creation-repository.ts',
	'src/common/editor/storage/raw-pcm-spool-global-inventory.ts',
	'src/common/editor/storage/raw-pcm-spool-record.ts',
	'src/common/editor/storage/raw-pcm-spool-tail-cleanup.ts',
	'src/common/editor/controller/take-cycle-capture-spool.ts',
	'src/common/editor/storage/linked-original-repository-inventory.ts',
	'src/common/editor/storage/linked-original-lifecycle-coordinator.ts',
	'src/common/editor/storage/linked-original-project-save.ts',
	'src/common/editor/storage/linked-original-project-open-maintenance.ts',
	'src/common/editor/storage/linked-original-project-alias-repository.ts',
	'src/common/editor/storage/linked-original-provisional-root.ts',
	'src/common/editor/storage/linked-original-startup-reconciliation-repository.ts',
	'src/common/editor/storage/linked-original-project-reachability-repository.ts',
	'src/common/editor/controller/project-retention-service.ts',
	'src/common/editor/storage/assistance-derivative-repository.ts',
	'src/common/editor/storage/project-repository-support.ts',
	'src/common/editor/storage/video-derivative-repository.ts',
]);

test('storage ordering uses UTF-16 code units for eviction and durable inventories', () => {
	const committedAt = '2026-08-28T00:00:00.000Z';
	const eviction = planDerivativeCacheEviction([
		{ key: 'a', size: 1, committedAt },
		{ key: 'Z', size: 1, committedAt },
	], { maximumBytes: 1, maximumEntries: 1 });
	assert.deepEqual(eviction.removals.map(({ key }) => key), ['Z']);

	const references = projectProtectedLinkedOriginalSourceReferences({
		protectedLinkedOriginalSourceReferences: [
			{ kind: 'audio', sourceId: 'a' },
			{ kind: 'audio', sourceId: 'Z' },
		],
	});
	assert.deepEqual(references?.map(({ sourceId }) => sourceId), ['Z', 'a']);

	const inventory = freezeRawPcmSpoolGlobalInventory([
		{ projectId: 'project', spoolId: 'lowercase', spoolToken: 'a' },
		{ projectId: 'project', spoolId: 'uppercase', spoolToken: 'Z' },
	]);
	assert.deepEqual(inventory.entries.map(({ spoolToken }) => spoolToken), ['Z', 'a']);
});

test('project repository ordering uses descending UTF-16 code units', () => {
	const projects = [
		{ id: 'uppercase', updatedAt: 'Z' },
		{ id: 'lowercase', updatedAt: 'a' },
	].sort(sortProjects);
	assert.deepEqual(projects.map(({ id }) => id), ['lowercase', 'uppercase']);
});

test('the bounded storage ordering surface does not consult host locale collation', async () => {
	assert.equal(ORDERED_STORAGE_SOURCES.length, 22);
	for (const relativePath of ORDERED_STORAGE_SOURCES) {
		const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /\.localeCompare\s*\(/u, relativePath);
		assert.match(source, /compareCodeUnits/u, relativePath);
	}
});
