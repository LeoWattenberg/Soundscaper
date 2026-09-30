/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Framescaper native services remain beneath family-v1 authority', async () => {
	const [architecture, threatModel, compatibility] = await Promise.all([
		text('docs/architecture/native-services.md'),
		text('docs/policies/security.md'),
		text('docs/policies/project-compatibility.md'),
	]);
	const security = await json('config/production-security-matrix.json');
	const mediaPayloads = await json('config/framescaper-media-host-payload-manifest.json');
	const openFxPayloads = await json('config/framescaper-openfx-host-payload-manifest.json');

	assert.match(architecture, /Historical S\/F\/V generation labels.*provenance, not current runtime authority/isu);
	assert.match(architecture, /projects are admitted by the family-v1 rules/iu);
	assert.match(architecture, /supported producer matrix.*Windows x64.*Windows ARM64.*macOS ARM64.*Linux x64.*Linux ARM64/isu);
	assert.match(architecture, /`ci-generated` manifest row with no payload remains unavailable/iu);

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
			status === 'ci-generated' && payload === null
		)));
	}
	assert.ok(openFxPayloads.targets.every((target) => !Object.hasOwn(target, 'productionReadiness')));
});

test('OpenFX remains documented while an empty payload stays unavailable', async () => {
	const architecture = await text('docs/architecture/native-services.md');
	assert.match(architecture, /OpenFX discovery and hosting.*dedicated host/isu);
	assert.match(architecture, /Generator, filter, transition, paint, retimer, and general contexts/iu);
	assert.match(architecture, /Interact V1.*DrawSuite V1.*menu-opened React surface/isu);
	assert.match(architecture, /`ci-generated` manifest row with no payload remains unavailable/iu);
	assert.match(architecture, /State and\s+parameters survive.*truthful bypass.*verified freeze/isu);
});

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
	return JSON.parse(await text(path));
}
