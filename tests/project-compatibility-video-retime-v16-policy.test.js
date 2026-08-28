/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('Framescaper v1 owns retime while embedded wire versions remain independent contracts', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-video-retime-baseline');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(rule.requiredOutcome, /Framescaper family v1.*retime and proxy lifecycle.*exact ordinal authority/iu);
	assert.match(rule.currentBehavior, /closed V2 occurrence-curve wire.*direct unversioned retime modules/iu);
	assert.match(rule.currentBehavior, /constant, ramp, reverse, freeze.*nested playback.*source-domain proxy/iu);
	assert.match(rule.currentBehavior, /V2 curve and V14 carrier.*embedded protocol contracts.*not project-family identities/iu);
	assert.doesNotMatch(`${rule.id} ${rule.requiredOutcome} ${rule.currentBehavior}`, /\bF(?:18|2\d|3[0-2])\b/u);
	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.equal(rule.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
	assert.equal(rule.historicalPreFreezeNarrative.formerId, 'current-video-retime-v16-preservation');

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /Framescaper family v1 validates and edits.*V2 occurrence-curve wire.*direct unversioned retime modules/iu);
	assert.match(documentation, /V2 curve and V14 carrier.*embedded protocol contracts.*not project-family identities/iu);
});
