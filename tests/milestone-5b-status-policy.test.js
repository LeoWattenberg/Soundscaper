/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('5B status distinguishes implemented candidate routes from shipped activation', async () => {
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

	assert.match(pickup, /V20 is selected provisionally.*V22 through V26.*dormant/isu);
	assert.match(pickup, /earlier claim.*whole software substrate.*inaccurate/isu);
	assert.doesNotMatch(roadmap, /whole 5B software substrate.*implemented/iu);

	assert.match(parentPlan, /source-body handoff.*watch-project\s+mutation.*exist/isu);
	assert.match(parentPlan, /empty payload manifest.*self-test.*not ready.*dispatch fail-closed/isu);
	assert.doesNotMatch(parentPlan, /unavailable source-body\/watch mutation bindings/iu);
	assert.match(parentPlan, /payload manifests.*selectors.*stagers.*exist/isu);
	assert.doesNotMatch(parentPlan, /No generic native-payload manifest or target selector exists yet/iu);

	for (const document of [pickup, roadmap]) {
		assert.match(document, /scan\/enable\/Add.*source route.*candidate-tested/isu);
		assert.match(document, /future-payload stager.*source-(?:implemented|tested)/isu);
		assert.match(document, /shipped activation.*unavailable/isu);
		assert.doesNotMatch(document, /Renderer(?:-facing)? scan\/Add execution.*(?:absent|unavailable)/iu);
	}
	assert.doesNotMatch(pickup, /future built-payload staging.*remain unavailable/iu);
	assert.doesNotMatch(pickup, /copier that\s+would stage a future verified payload row/iu);

	const hosting = security.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.ok(hosting);
	const residual = hosting.residualRisks.find(({ id }) => id === 'unexercised-plugin-hosting-gates');
	assert.ok(residual);
	for (const document of [pickup, roadmap, residual.exposure]) {
		assert.match(
			document,
			/OverlayInteractV2.*property.*Interact Suite V1.*DrawSuite V1/isu,
		);
		assert.doesNotMatch(document, /Overlay Interact V2\/DrawSuite V1/iu);
	}

	assert.match(threatModel, /media decode\/encode\/render source candidates.*outside the enacted payload surface/isu);
	assert.doesNotMatch(threatModel, /decode\/encode and render helpers remain out of scope/iu);
	assert.match(compatibility, /^## Framescaper V20 product isolation$/mu);

	for (const manifest of [mediaPayloads, openFxPayloads]) {
		assert.deepEqual(manifest.payloads, []);
		assert.equal(manifest.targets.length, 5);
		assert.ok(manifest.targets.every(({ status, payload }) => (
			status === 'pending-external' && payload === null
		)));
	}
	assert.ok(openFxPayloads.targets.every(({ productionReadiness }) => productionReadiness === null));
});

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
	return JSON.parse(await text(path));
}
