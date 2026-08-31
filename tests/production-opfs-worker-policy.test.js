/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PRODUCT_IDS } from '../src/common/products.js';
import { OPFS_SYNC_OPERATION_IDS } from '../src/common/editor/storage/opfs-sync-worker-protocol.ts';

const closureUrl = new URL('../config/milestone-2-closure.json', import.meta.url);
const capabilitiesUrl = new URL('../config/production-capabilities.json', import.meta.url);
const qualityBudgetsUrl = new URL('../docs/quality-budgets.md', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

const OPERATION_IDS = [
	'canonical-pcm-chunk-read',
	'canonical-pcm-chunk-write',
	'media-asset-chunk-read',
	'media-asset-chunk-write',
	'derivative-payload-read',
	'derivative-payload-write',
];

const WEB_EVIDENCE = [
	'src/common/editor/storage/opfs-repository.ts',
	'src/common/editor/storage/opfs-sync-repository-bridge.ts',
	'src/common/editor/storage/opfs-sync-worker-client.ts',
	'src/common/editor/storage/opfs-sync-worker-protocol.ts',
	'src/common/editor/storage/opfs-sync-worker-runtime.ts',
	'src/common/editor/storage/opfs-sync-worker.ts',
	'src/common/editor/storage/opfs-sync-writer-adapters.ts',
	'tests/audio-editor-opfs-worker-client.test.ts',
	'tests/audio-editor-opfs-worker-repository.test.ts',
	'tests/audio-editor-opfs-worker-runtime.test.ts',
	'tests/audio-editor-storage-persistence.test.ts',
	'tests/browser/audio-editor-opfs-worker.spec.js',
];

test('milestone 2 closes the exact dedicated OPFS worker boundary', async () => {
	const [closure, roadmap] = await Promise.all([
		readFile(closureUrl, 'utf8').then(JSON.parse),
		readFile(roadmapUrl, 'utf8'),
	]);
	const item = closure.items.find(({ id }) => id === 'm2-opfs-worker-boundary');
	assert.ok(item);
	assert.equal(item.status, 'implemented');
	assert.deepEqual(item.operationIds, OPERATION_IDS);
	assert.deepEqual([...OPFS_SYNC_OPERATION_IDS], OPERATION_IDS);

	const openItems = roadmap.slice(
		roadmap.indexOf('### Open closure items, in priority order'),
		roadmap.indexOf('### Explicitly deferred or outside milestone 2'),
	);
	assert.doesNotMatch(openItems, /^- `m2-opfs-worker-boundary`$/mu);
});

test('both web products pin worker and IndexedDB fallback evidence', async () => {
	const capabilities = JSON.parse(await readFile(capabilitiesUrl, 'utf8'));
	for (const productId of PRODUCT_IDS) {
		const tier = capabilities.products[productId].platforms['web-enhanced'];
		assert.equal(tier.status, 'partial');
		for (const path of WEB_EVIDENCE) {
			assert.ok(tier.evidence.includes(path), `${productId} is missing ${path}`);
			await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		}
	}
});

test('quality policy limits the dedicated OPFS worker claim to proved behavior', async () => {
	const documentation = await readFile(qualityBudgetsUrl, 'utf8');
	assert.match(
		documentation,
		/dedicated OPFS storage worker.*six closed operation IDs.*synchronous access handles.*only after capability detection.*16 MiB.*canonical PCM.*exact bounded ranges.*media and derivative writes.*slices.*worker-owned `File` snapshots.*exact synchronous size check.*store close.*terminates.*asynchronous OPFS.*IndexedDB.*correctness fallback/isu,
	);
	assert.match(
		documentation,
		/automated test runs Chromium, Firefox, and WebKit.*Chromium and Firefox witness.*main-realm.*`createWritable`.*`getFile`.*persisted PCM, original video, and derivatives.*reload.*playback.*second tab.*read-only.*writer lock.*WebKit.*supported fallback.*broader browser support.*release readiness/isu,
	);
});
