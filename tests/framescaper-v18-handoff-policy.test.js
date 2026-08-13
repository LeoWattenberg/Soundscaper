/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const closureUrl = new URL('../config/milestone-2-closure.json', import.meta.url);
const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const browserEvidenceUrl = new URL('./browser/audio-editor-scape-product-roundtrip.spec.js', import.meta.url);
const isolationContractUrl = new URL('../docs/milestone-3b-framescaper-v18-product-isolation.md', import.meta.url);
const workPacketsUrl = new URL('../docs/milestone-3b-work-packets.md', import.meta.url);

const EXPECTED_BOUNDARY = {
	classification: 'legacy-shared-schema-17-pre-framescaper-v18',
	desktopLibrarySchemaVersion: 9,
	framescaperCurrentProjectSchemaVersion: 18,
	framescaperPriorSchemaPolicy: 'reimport-required',
	crossProductV18Policy: 'copy-only-preservation',
	authorizesFramescaperV17Activation: false,
};

test('the frozen Milestone 2 handoff evidence cannot authorize Framescaper V17 after V18 selection', async () => {
	const [closure, compatibility, browserEvidence] = await Promise.all([
		readFile(closureUrl, 'utf8').then(JSON.parse),
		readFile(compatibilityUrl, 'utf8').then(JSON.parse),
		readFile(browserEvidenceUrl, 'utf8'),
	]);
	const handoff = closure.items.find(({ id }) => id === 'm2-handoff-packaged-roundtrip');
	assert.deepEqual(handoff.compatibilityBoundary, EXPECTED_BOUNDARY);

	for (const ruleId of [
		'current-desktop-packaged-source-bearing-handoff',
		'current-web-scape-mixed-media-handoff',
	]) {
		const rule = compatibility.rules.find(({ id }) => id === ruleId);
		assert.deepEqual(rule.policyBoundary, EXPECTED_BOUNDARY, ruleId);
		assert.match(rule.requiredOutcome, /legacy exact-schema-17/iu, ruleId);
		assert.match(
			rule.currentBehavior,
			/pre-V18 evidence.*does not authorize Framescaper V17 activation.*copy-only preservation/iu,
			ruleId,
		);
	}

	assert.match(browserEvidence, /LEGACY_SHARED_PROJECT_SCHEMA_VERSION = 17/u);
	assert.match(browserEvidence, /legacy shared-schema-17 cross-product Scape handoff roundtrips/u);
	assert.match(browserEvidence, /expect\(outbound\.schemaVersion\)\.toBe\(LEGACY_SHARED_PROJECT_SCHEMA_VERSION\)/u);
});

test('the reviewed Milestone 3 contract records V18 as authoritative and unblocks c-c REDs', async () => {
	const [isolationContract, workPackets] = await Promise.all([
		readFile(isolationContractUrl, 'utf8'),
		readFile(workPacketsUrl, 'utf8'),
	]);
	assert.match(
		isolationContract,
		/V18 is authoritative.*legacy shared-schema-17.*copy-only preservation.*c-c RED/isu,
	);
	assert.doesNotMatch(isolationContract, /Atomic c-c is blocked on a released-contract conflict/u);
	assert.match(workPackets, /V18 policy decision.*c-c REDs are authorized/isu);
	assert.doesNotMatch(workPackets, /blocked until the V17 cross-product handoff conflict/u);
});
