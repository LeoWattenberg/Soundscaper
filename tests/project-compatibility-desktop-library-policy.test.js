/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('desktop compatibility authority is split between two fresh family-v1 libraries', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-project-catalog-commit');
	assert.ok(rule);
	assert.equal(rule.policyAuthority, 'family-v1-active');
	assert.match(rule.requiredOutcome, /Soundscaper and Framescaper.*fresh.*family-v1 desktop library/iu);
	assert.match(
		rule.currentBehavior,
		/schemaFamily: 'soundscaper'.*schemaVersion: 1.*schemaFamily: 'framescaper'.*schemaVersion: 1/isu,
	);
	assert.match(rule.currentBehavior, /soundscaper-project-library\/v1.*framescaper-project-library\/v1/isu);
	assert.match(rule.currentBehavior, /SQLite user_version 1.*SSCP and FSCP/isu);
	assert.match(rule.currentBehavior, /soundscaper:v1:project-library.*framescaper:v1:project-library/isu);
	assert.match(rule.currentBehavior, /no migration or copy-forward marker/iu);
	assert.doesNotMatch(rule.currentBehavior, /\b(?:S30|F31|V(?:1[5-9]|2\d|3[0-2]))\b/u);
	for (const path of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
});

test('desktop lease policy keeps stable release fail-closed', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections');
	assert.ok(rule);
	assert.equal(rule.policyAuthority, 'family-v1-active');
	assert.match(rule.currentBehavior, /distinct roots.*user_version 1.*v1 IPC namespaces/isu);
	assert.match(rule.currentBehavior, /No pre-release library is opened, copied forward, enumerated, mutated, or deleted/iu);
	assert.match(rule.currentBehavior, /stable 1\.0 stays blocked/iu);
});

test('pre-freeze packaged shared-library handoff remains provenance only', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-packaged-source-bearing-handoff');
	assert.ok(rule);
	assert.equal(rule.policyAuthority, 'historical-provenance-only');
	assert.match(rule.requiredOutcome, /no family-v1.*authority/iu);
	assert.equal(
		rule.historicalPreFreezeNarrative?.status,
		'provenance-only-not-runtime-authority',
	);
});

test('compatibility documentation separates current desktop authority from provenance', async () => {
	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /^## Family-v1 desktop project libraries$/mu);
	assert.match(documentation, /direct unversioned Soundscaper and Framescaper libraries/iu);
	assert.match(documentation, /^### Historical pre-freeze shared-library provenance$/mu);
	assert.match(documentation, /grants no current project,\s+migration, storage, IPC, or package authority/iu);
});
