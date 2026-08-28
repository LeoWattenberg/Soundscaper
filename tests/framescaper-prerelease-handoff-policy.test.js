/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('pre-freeze handoff evidence is provenance and cannot authorize family-v1 storage', async () => {
	const [closure, compatibility, historicalContract] = await Promise.all([
		json('config/milestone-2-closure.json'),
		json('config/project-compatibility.json'),
		text('docs/milestone-3b-framescaper-v18-product-isolation.md'),
	]);
	const handoff = closure.items.find(({ id }) => id === 'm2-handoff-packaged-roundtrip');
	assert.equal(handoff.compatibilityBoundary.classification, 'legacy-shared-schema-17-pre-framescaper-v18');
	assert.equal(handoff.compatibilityBoundary.authorizesFramescaperV17Activation, false);

	assert.match(compatibility.historicalPreReleaseLineage.status, /provenance-only.*not-readable.*not-migrated/iu);
	assert.deepEqual(compatibility.historicalPreReleaseLineage.retainedMigrationSources, []);
	const isolation = compatibility.rules.find(({ id }) => id === 'family-v1-product-isolation');
	assert.match(isolation.currentBehavior, /fresh v1 stores.*no migration or copy-forward path.*never open, enumerate, mutate, or delete pre-release stores/iu);
	assert.equal(isolation.historicalPreFreezeNarrative.formerId, 'framescaper-v18-product-isolation');
	assert.match(historicalContract, /V18 is authoritative/iu);
});

test('current cross-product handoff is tuple-routed opaque custody', async () => {
	const [compatibility, browserEvidence] = await Promise.all([
		json('config/project-compatibility.json'),
		text('tests/browser/audio-editor-scape-product-roundtrip.spec.js'),
	]);
	const custody = compatibility.rules.find(({ id }) => id === 'family-v1-foreign-future-custody');
	assert.match(custody.currentBehavior, /\(schemaFamily, schemaVersion\) tuple/iu);
	assert.match(custody.currentBehavior, /known foreign-family and future-version archives.*Save Copy/iu);
	assert.match(custody.currentBehavior, /pre-release.*provenance only.*never validated, migrated, opened/iu);
	assert.doesNotMatch(browserEvidence, /LEGACY_SHARED_PROJECT_SCHEMA_VERSION = 17/u);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}
