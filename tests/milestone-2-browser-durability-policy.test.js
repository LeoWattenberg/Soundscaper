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
	'storage-eviction-recovery',
];

test('milestone 2 runs configured browsers without a qualification matrix', async () => {
	const [inventory, qualityBudgets, threatModel, browserEvidence] = await Promise.all([
		readFile(new URL('config/milestone-2-closure.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('docs/quality-budgets.md', root), 'utf8'),
		readFile(new URL('docs/production-threat-model.md', root), 'utf8'),
		Promise.all([
			'tests/browser/milestone-2-browser-storage-durability.spec.js',
			'tests/browser/audio-editor-export-session.spec.js',
			'tests/browser/audio-editor-opfs-worker.spec.js',
			'tests/browser/offline-application-shell.spec.js',
		].map((path) => readFile(new URL(path, root), 'utf8'))).then((files) => files.join('\n')),
	]);
	const item = inventory.items.find(({ id }) => id === 'm2-browser-durability-matrix');
	assert.ok(item);
	assert.equal(item.status, 'implemented');
	assert.deepEqual(item.workflowIds, workflowIds);
	assert.equal(Object.hasOwn(item, 'qualifiedBrowserProjects'), false);
	assert.equal(Object.hasOwn(item, 'deferredBrowserProjects'), false);
	assert.deepEqual(inventory.testActivation.browserProjects, ['chromium', 'firefox', 'webkit']);
	assert.deepEqual(inventory.testActivation.desktopTargets, [
		'windows-x64', 'windows-arm64', 'macos-arm64', 'linux-x64', 'linux-arm64',
	]);
	assert.equal(Object.hasOwn(inventory.testActivation, 'humanReviewMilestone'), false);
	for (const id of workflowIds) assert.match(browserEvidence, new RegExp(`\\b${id}\\b`, 'u'), id);
	for (const document of [qualityBudgets, threatModel]) {
		assert.match(document, /indexeddb-quota-refusal.*opfs-quota-refusal.*indexeddb-multitab-writer.*opfs-multitab-writer.*offline-shell-upgrade.*storage-eviction-recovery/isu);
		assert.match(document, /automated test.*(?:runs?|run).*Chromium.*Firefox.*WebKit|Chromium.*Firefox.*WebKit.*automated test/isu);
		assert.doesNotMatch(document, /WebKit release qualification/iu);
	}
});

test('less-capable return exercises browsers and packaged products without a qualification status', async () => {
	const inventory = JSON.parse(await readFile(new URL('config/milestone-2-closure.json', root), 'utf8'));
	const item = inventory.items.find(({ id }) => id === 'm2-compatibility-less-capable-roundtrip');
	assert.ok(item);
	assert.equal(item.status, 'implemented');
	assert.equal(Object.hasOwn(item, 'qualifiedBrowserProjects'), false);
	assert.equal(Object.hasOwn(item, 'deferredBrowserProjects'), false);
	assert.deepEqual(inventory.testActivation.browserProjects, ['chromium', 'firefox', 'webkit']);
	assert.equal(Object.hasOwn(item, 'packagedProductPairQualified'), false);
	assert.doesNotMatch(JSON.stringify(item), /qualification|qualified/iu);
});
