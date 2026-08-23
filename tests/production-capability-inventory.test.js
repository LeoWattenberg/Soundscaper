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
	assert.equal(inventory.groundedAt, '2026-08-22');
	assert.deepEqual(inventory.platformTiers, PLATFORM_TIERS);
	assert.deepEqual(Object.keys(inventory.products).sort(), [...PRODUCT_IDS].sort());

	for (const productId of PRODUCT_IDS) {
		const expected = PRODUCT_PROFILES[productId];
		const actual = inventory.products[productId];
		assert.equal(actual.profileEvidence, `src/${productId}/product.js`);
		assert.deepEqual(actual.importFamilies, expected.importChoices);
		assert.deepEqual(actual.exportFamilies, expected.exportChoices);
		assert.deepEqual(actual.projectFeatures, expected.capabilities);
		assert.deepEqual(actual.applicationFeatures, expected.applicationFeatures);
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

test('MIDI stays absent while Framescaper capture is a separate application capability', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const serializedProfiles = JSON.stringify(inventory.products).toLowerCase();
	const dependencyMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const dependencyNames = Object.keys({
		...dependencyMetadata.dependencies,
		...dependencyMetadata.devDependencies,
	});

	assert.doesNotMatch(serializedProfiles, /midi/u);
	assert.deepEqual(inventory.products.soundscaper.applicationFeatures, {});
	assert.deepEqual(inventory.products.framescaper.applicationFeatures, {
		framescaperCapture: true, framescaperWebVcr: false,
	});
	assert.equal(inventory.products.framescaper.projectFeatures.audioRecording, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.timelineAnnotations, true);
	assert.equal(inventory.products.framescaper.projectFeatures.timelineAnnotations, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.trackFolders, true);
	assert.equal(inventory.products.framescaper.projectFeatures.trackFolders, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.audioWarp, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.videoRetime, false);
	assert.equal(inventory.products.framescaper.projectFeatures.audioWarp, false);
	assert.equal(inventory.products.framescaper.projectFeatures.videoRetime, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.nestedSequences, false);
	assert.equal(inventory.products.framescaper.projectFeatures.nestedSequences, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.multicamera, false);
	assert.equal(inventory.products.framescaper.projectFeatures.multicamera, true);
	assert.equal(inventory.products.framescaper.platforms['electron-only'].status, 'not-applicable');
	assert.deepEqual(dependencyNames.filter((name) => /midi/u.test(name)), []);
});

test('Electron Enhanced inventory records product-owned current desktop boundaries', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const soundscaper = inventory.products.soundscaper.platforms['electron-enhanced'];
	const framescaper = inventory.products.framescaper.platforms['electron-enhanced'];
	assert.equal(soundscaper.status, 'partial');
	assert.equal(framescaper.status, 'partial');
	for (const path of [
		'desktop/desktop-smoke.js',
		'desktop/project-library-host.ts',
		'desktop/project-library-lease-smoke.js',
		'scripts/lib/desktop-project-library-lease-matrix.mjs',
		'tests/desktop-project-library-lease-matrix.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(soundscaper.evidence.includes(path), `soundscaper is missing ${path}`);
	for (const path of [
		'desktop/desktop-smoke.js',
		'desktop/framescaper-v18-artifact-smoke.js',
		'desktop/project-library-product-runtime.js',
		'desktop/project-library-v10-main.ts',
		'desktop/project-library-v10-main-session.ts',
		'desktop/project-library-v10-lifecycle-host.ts',
		'src/framescaper/desktop-project-library-v10-renderer.ts',
		'tests/desktop-project-library-v10-main.test.ts',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(framescaper.evidence.includes(path), `framescaper is missing ${path}`);
	assert.doesNotMatch(JSON.stringify(framescaper.evidence), /project-library-handoff-smoke/iu);
});

test('Linux x64 inventory pins the current product-aware artifact smoke', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const target = inventory.desktopTargets.find(
		({ os, architecture }) => os === 'linux' && architecture === 'x64',
	);

	assert.ok(target);
	for (const path of [
		'desktop/desktop-smoke.js',
		'scripts/lib/desktop-smoke.mjs',
		'scripts/desktop-smoke.mjs',
		'tests/desktop-smoke-probe.test.js',
		'tests/desktop-smoke.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(target.evidence.includes(path), `linux/x64 is missing ${path}`);
	assert.doesNotMatch(JSON.stringify(target.evidence), /project-library-handoff-smoke/iu);
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
