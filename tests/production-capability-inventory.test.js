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
	['macos', 'x64'],
	['windows', 'arm64'],
	['windows', 'x64'],
];

test('production capability inventory covers every product profile and platform tier', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));

	assert.equal(inventory.schemaVersion, 1);
	assert.match(inventory.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
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
	assert.equal(browsers.firefox.automated, false);
	assert.equal(browsers.webkit.automated, false);
	for (const [family, target] of Object.entries(browsers)) {
		assert.ok(target.project.length > 0, `${family} must name a Playwright project`);
		assert.match(target.releaseStatus, /^(qualified|provisional|planned)$/u);
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
	assert.equal(inventory.products.framescaper.platforms['electron-only'].status, 'not-applicable');
	assert.deepEqual(dependencyNames.filter((name) => /midi/u.test(name)), []);
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
