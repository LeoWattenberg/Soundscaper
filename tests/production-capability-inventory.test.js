/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PRODUCT_IDS, PRODUCT_PROFILES } from '../src/common/products.js';

const inventoryUrl = new URL('../config/production-capabilities.json', import.meta.url);
const PLATFORM_TIERS = ['web-core', 'web-enhanced', 'electron-enhanced', 'electron-only'];
const DESKTOP_TARGETS = [
	['linux', 'arm64'],
	['linux', 'x64'],
	['macos', 'arm64'],
	['windows', 'arm64'],
	['windows', 'x64'],
];

test('production capability inventory covers every product profile and platform tier', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));

	assert.equal(inventory.schemaVersion, 1);
	assert.equal(inventory.groundedAt, '2026-08-01');
	assert.deepEqual(inventory.platformTiers, PLATFORM_TIERS);
	assert.deepEqual(Object.keys(inventory.products).sort(), [...PRODUCT_IDS].sort());

	for (const productId of PRODUCT_IDS) {
		const expected = PRODUCT_PROFILES[productId];
		const actual = inventory.products[productId];
		assert.equal(actual.profileEvidence, `src/${productId}/product.js`);
		assert.deepEqual(actual.importFamilies, expected.importChoices);
		assert.deepEqual(actual.exportFamilies, expected.exportChoices);
		assert.deepEqual(actual.projectFeatures, expected.capabilities);
		assert.deepEqual(Object.keys(actual.platforms), PLATFORM_TIERS);
		for (const tier of PLATFORM_TIERS) {
			assert.match(actual.platforms[tier].status, /^(available|partial|planned|not-applicable)$/u);
			assert.ok(actual.platforms[tier].evidence.length > 0, `${productId}/${tier} needs evidence`);
		}
	}
});

test('production capability inventory pins browser and desktop qualification targets', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const browsers = inventory.browserTargets;

	assert.deepEqual(Object.keys(browsers), ['chromium', 'firefox', 'webkit']);
	assert.equal(browsers.chromium.automated, true);
	assert.equal(browsers.firefox.automated, true);
	assert.equal(browsers.webkit.automated, true);
	for (const [family, target] of Object.entries(browsers)) {
		assert.ok(target.project.length > 0, `${family} must name a Playwright project`);
		assert.equal(target.releaseStatus, 'provisional');
	}

	assert.deepEqual(
		inventory.desktopTargets.map(({ os, architecture }) => [os, architecture]).sort(),
		DESKTOP_TARGETS,
	);
	for (const target of inventory.desktopTargets) {
		assert.match(target.packageGate, /^(smoke-tested|packaged|planned)$/u);
		assert.ok(target.evidence.length > 0, `${target.os}/${target.architecture} needs evidence`);
	}
});

test('deferred MIDI and Framescaper capture capabilities are absent from maintained profiles', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const serializedProfiles = JSON.stringify(inventory.products).toLowerCase();
	const dependencyMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const dependencyNames = Object.keys({
		...dependencyMetadata.dependencies,
		...dependencyMetadata.devDependencies,
	});

	assert.doesNotMatch(serializedProfiles, /midi/u);
	assert.equal(inventory.products.framescaper.projectFeatures.audioRecording, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.timelineAnnotations, true);
	assert.equal(inventory.products.framescaper.projectFeatures.timelineAnnotations, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.trackFolders, true);
	assert.equal(inventory.products.framescaper.projectFeatures.trackFolders, false);
	assert.equal(inventory.products.framescaper.platforms['electron-only'].status, 'not-applicable');
	assert.deepEqual(dependencyNames.filter((name) => /midi/u.test(name)), []);
});

test('Electron Enhanced inventory includes the shared mixed-media editor project boundary', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	for (const productId of PRODUCT_IDS) {
		const platform = inventory.products[productId].platforms['electron-enhanced'];
		const evidence = platform.evidence;
		assert.equal(platform.status, 'partial');
		for (const path of [
			'desktop/desktop-smoke.js',
			'desktop/project-library-editor-media-service.ts',
			'desktop/project-library-editor-service.ts',
			'desktop/project-library-ipc.js',
			'desktop/project-library-media-binding.ts',
			'desktop/project-library-media-capacity.ts',
			'desktop/project-library-media-inventory-reclamation.ts',
			'desktop/project-library-media-inventory-schema.ts',
			'desktop/project-library-media-inventory-store.ts',
			'desktop/project-library-media-inventory.ts',
			'desktop/project-library-media-reclamation.ts',
			'desktop/project-library-media-reuse.ts',
			'desktop/project-library-media.ts',
			'scripts/lib/desktop-project-library-handoff-smoke.mjs',
			'scripts/lib/desktop-project-library-runtime.mjs',
			'scripts/desktop-project-library-handoff-smoke.mjs',
			'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
			'src/common/editor/storage/desktop-shared-project-media-contract.ts',
			'src/common/editor/storage/desktop-shared-project-media-sender.ts',
			'src/common/editor/storage/desktop-shared-project-media-sources.ts',
			'src/common/editor/storage/desktop-shared-project-media-transfer.ts',
			'src/common/editor/storage/desktop-shared-project-repository.ts',
			'src/common/editor/storage.js',
			'src/common/editor/app.js',
			'tests/audio-editor-desktop-shared-project-media-sender-video.test.ts',
			'tests/audio-editor-desktop-shared-project-media-transfer-budget.test.ts',
			'tests/audio-editor-desktop-shared-project-media-transfer-ownership.test.ts',
			'tests/audio-editor-desktop-shared-project-media-transfer.test.ts',
			'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
			'tests/audio-editor-desktop-shared-project-repository-handoff.test.ts',
			'tests/desktop-project-library-editor-service.test.ts',
			'tests/desktop-project-library-editor-media-freshness.test.ts',
			'tests/desktop-project-library-editor-media-reuse-fallback.test.ts',
			'tests/desktop-project-library-editor-media-service.test.ts',
			'tests/desktop-project-library-editor-video-media-service.test.ts',
			'tests/desktop-project-library-ipc.test.js',
			'tests/desktop-project-library-media-capacity.test.ts',
			'tests/desktop-project-library-media-inventory-store.test.ts',
			'tests/desktop-project-library-media-inventory.test.ts',
			'tests/desktop-project-library-media-reclamation.test.ts',
			'tests/desktop-project-library-media-reuse.test.ts',
			'tests/desktop-project-library-media.test.ts',
			'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
			'tests/desktop-project-library-packaging.test.js',
			'tests/desktop-project-library-video-media.test.ts',
			'tests/audio-editor-desktop-shared-project-repository.test.ts',
			'tests/desktop-project-library-editor-handoff.test.ts',
			'tests/desktop-smoke-probe.test.js',
			'tests/desktop-project-library-handoff-smoke.test.js',
			'tests/desktop-project-library-handoff-workflow.test.js',
			'.github/workflows/desktop-preview.yml',
		]) assert.ok(evidence.includes(path), `${productId} is missing ${path}`);
	}
});

test('Linux x64 inventory pins the packaged source-free project-library handoff', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const target = inventory.desktopTargets.find(
		({ os, architecture }) => os === 'linux' && architecture === 'x64',
	);

	assert.ok(target);
	for (const path of [
		'desktop/desktop-smoke.js',
		'scripts/lib/desktop-project-library-handoff-smoke.mjs',
		'scripts/desktop-project-library-handoff-smoke.mjs',
		'tests/desktop-smoke-probe.test.js',
		'tests/desktop-project-library-handoff-smoke.test.js',
		'tests/desktop-project-library-handoff-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(target.evidence.includes(path), `linux/x64 is missing ${path}`);
	assert.equal(
		target.evidence.includes('tests/desktop-project-library-mixed-media-roundtrip.test.ts'),
		false,
		'composed Node mixed-media acceptance is not packaged Linux evidence',
	);
});

test('every capability claim points at checked-in evidence', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const evidence = [
		...Object.values(inventory.browserTargets).flatMap((target) => target.evidence),
		...inventory.desktopTargets.flatMap((target) => target.evidence),
		...Object.values(inventory.products).flatMap((product) => [
			product.profileEvidence,
			...Object.values(product.platforms).flatMap((platform) => platform.evidence),
		]),
	];

	for (const reference of new Set(evidence)) {
		const [repositoryPath] = reference.split('#');
		await assert.doesNotReject(
			access(new URL(`../${repositoryPath}`, import.meta.url)),
			`Missing capability evidence: ${reference}`,
		);
	}
});
