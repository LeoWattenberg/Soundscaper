/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('5B status records the selected V28/V14 route without claiming external activation', async () => {
	const [roadmap, parentPlan, pickup, threatModel, compatibility] = await Promise.all([
		text('roadmap.md'),
		text('docs/milestone-5-plan.md'),
		text('docs/milestone-5b-framescaper-native-tier.md'),
		text('docs/production-threat-model.md'),
		text('docs/project-compatibility.md'),
	]);
	const security = await json('config/production-security-matrix.json');
	const mediaPayloads = await json('config/framescaper-media-host-payload-manifest.json');
	const openFxPayloads = await json('config/framescaper-openfx-host-payload-manifest.json');

	assert.match(pickup, /V28.*selected.*Milestone 5.*V14.*desktop library V19/isu);
	assert.match(pickup, /V20.*through V27.*historical.*V25\/V26.*opaque.*read-only/isu);
	assert.match(roadmap, /Framescaper V28.*exact V14.*evaluated-RGBA.*carrier/isu);
	assert.match(parentPlan, /selected V28.*V14.*render queue.*persistent services V3/isu);
	for (const document of [pickup, roadmap, parentPlan]) {
		assert.match(document, /five.*target.*pending-external/isu);
		assert.match(document, /payload.*(?:empty|no authenticated)/isu);
		assert.doesNotMatch(document, /whole 5B software substrate.*implemented/iu);
	}

	const helper = security.risks.find(({ id }) => id === 'native-helper-processes');
	assert.ok(helper);
	assert.match(JSON.stringify(helper), /V14.*evaluated-RGBA.*carrier/isu);
	assert.match(threatModel, /selected V28.*V14.*carrier/isu);
	assert.match(compatibility, /^## Framescaper V28 product isolation$/mu);

	for (const manifest of [mediaPayloads, openFxPayloads]) {
		assert.deepEqual(manifest.payloads, []);
		assert.equal(manifest.targets.length, 5);
		assert.ok(manifest.targets.every(({ status, payload }) => (
			status === 'pending-external' && payload === null
		)));
	}
	assert.ok(openFxPayloads.targets.every(({ productionReadiness }) => productionReadiness === null));
});

test('5B status preserves the OpenFX route while keeping execution unavailable', async () => {
	const [roadmap, pickup] = await Promise.all([
		text('roadmap.md'),
		text('docs/milestone-5b-framescaper-native-tier.md'),
	]);
	for (const document of [pickup, roadmap]) {
		assert.match(document, /scan.*enable.*Add OFX.*menu/isu);
		assert.match(document, /all six contexts.*Interact Suite V1.*DrawSuite V1/isu);
		assert.match(document, /payload.*empty.*third-party.*unavailable/isu);
		assert.match(document, /state.*(?:bypass|frozen).*preserv/isu);
	}
});

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
	return JSON.parse(await text(path));
}
