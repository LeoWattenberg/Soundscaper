/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const workflowIds = [
	'indexeddb-quota-refusal',
	'opfs-quota-refusal',
	'indexeddb-multitab-writer',
	'opfs-multitab-writer',
	'offline-shell-upgrade',
	'offline-runtime-rollback',
	'storage-eviction-recovery',
];

test('milestone 2 records the exact Chromium and Firefox durability matrix', async () => {
	const [inventory, qualityBudgets, threatModel, browserEvidence] = await Promise.all([
		readFile(new URL('config/milestone-2-closure.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('docs/quality-budgets.md', root), 'utf8'),
		readFile(new URL('docs/production-threat-model.md', root), 'utf8'),
		Promise.all([
			'tests/browser/milestone-2-browser-storage-durability.spec.js',
			'tests/browser/audio-editor-export-session.spec.js',
			'tests/browser/audio-editor-opfs-worker.spec.js',
			'tests/browser/offline-application-shell.spec.js',
			'tests/browser/offline-ffmpeg-runtime-download.spec.js',
		].map((path) => readFile(new URL(path, root), 'utf8'))).then((files) => files.join('\n')),
	]);
	const item = inventory.items.find(({ id }) => id === 'm2-browser-durability-matrix');
	assert.ok(item);
	assert.equal(item.status, 'partial');
	assert.deepEqual(item.workflowIds, workflowIds);
	assert.deepEqual(item.qualifiedBrowserProjects, ['chromium', 'firefox']);
	assert.deepEqual(item.unqualifiedBrowserProjects, ['webkit']);
	for (const id of workflowIds) assert.match(browserEvidence, new RegExp(`\\b${id}\\b`, 'u'), id);
	for (const document of [qualityBudgets, threatModel]) {
		assert.match(document, /indexeddb-quota-refusal.*opfs-quota-refusal.*indexeddb-multitab-writer.*opfs-multitab-writer.*offline-shell-upgrade.*offline-runtime-rollback.*storage-eviction-recovery/isu);
		assert.match(document, /Chromium and Firefox.*WebKit.*unqualified/isu);
	}
});

test('less-capable return qualification records the same two browser engines and packaged pair', async () => {
	const inventory = JSON.parse(await readFile(new URL('config/milestone-2-closure.json', root), 'utf8'));
	const item = inventory.items.find(({ id }) => id === 'm2-compatibility-less-capable-roundtrip');
	assert.ok(item);
	assert.equal(item.status, 'partial');
	assert.deepEqual(item.qualifiedBrowserProjects, ['chromium', 'firefox']);
	assert.deepEqual(item.unqualifiedBrowserProjects, ['webkit']);
	assert.equal(item.packagedProductPairQualified, true);
});
