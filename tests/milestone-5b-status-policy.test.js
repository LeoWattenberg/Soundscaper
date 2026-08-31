/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('5B generation prose remains provenance beneath the Framescaper-v1 authority', async () => {
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

	assert.match(pickup, /F31.*selected.*Milestone 5.*V14.*desktop library V20.*immutable V28 foundation/isu);
	assert.match(pickup, /V20.*through V27.*historical.*V25\/V26.*opaque.*read-only/isu);
	assert.match(roadmap, /Framescaper F31.*immutable V28 foundation.*exact V14.*evaluated-RGBA.*carrier/isu);
	assert.match(parentPlan, /selected F31.*immutable V28 foundation.*V14.*render queue.*persistent services V3/isu);
	for (const document of [pickup, roadmap, parentPlan]) {
		assert.match(document, /five.*target.*pending-external/isu);
		assert.match(document, /payload.*(?:empty|no authenticated)/isu);
		assert.doesNotMatch(document, /whole 5B software substrate.*implemented/iu);
	}

	const helper = security.risks.find(({ id }) => id === 'native-helper-processes');
	assert.ok(helper);
	assert.match(JSON.stringify(helper), /V14.*evaluated-RGBA.*carrier/isu);
	assert.match(threatModel, /version-bearing S21–S30, F18–F32.*historical implementation provenance/isu);
	assert.match(compatibility, /^## Family-v1 product isolation$/mu);
	assert.match(compatibility, /Version-bearing S21–S30, F18–F32.*implementation provenance/isu);
	const nativeControl = security.risks
		.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'framescaper-native-services-pathless-bridge');
	assert.equal(nativeControl?.policyAuthority, 'family-v1-active');
	assert.match(nativeControl.summary, /Framescaper family v1.*direct unversioned Framescaper baseline.*V14/isu);

	for (const manifest of [mediaPayloads, openFxPayloads]) {
		assert.deepEqual(manifest.payloads, []);
		assert.equal(manifest.targets.length, 5);
		assert.ok(manifest.targets.every(({ status, payload }) => (
			status === 'pending-external' && payload === null
		)));
	}
	assert.ok(openFxPayloads.targets.every((target) => !Object.hasOwn(target, 'productionReadiness')));
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
