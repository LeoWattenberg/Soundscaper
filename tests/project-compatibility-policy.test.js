/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

const BASELINE_RULES = Object.freeze([
	'pre-release-reimport-required',
	'current-schema-editing',
	'current-video-retime-baseline',
	'family-v1-product-isolation',
	'family-v1-foreign-future-custody',
	'framescaper-v1-nested-sequence-native',
	'framescaper-v1-multicamera-native',
	'framescaper-v1-video-proxy-preservation',
]);

test('active compatibility rules are family-v1 authorities with checked-in evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, policy.rules.length, 'compatibility rule IDs are unique');
	for (const id of BASELINE_RULES) assert.ok(rules.has(id), `${id} is registered`);

	for (const rule of rules.values()) {
		assert.match(rule.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(['implemented', 'partial', 'planned'].includes(rule.status), rule.id);
		assert.ok(rule.requiredOutcome.length > 0, `${rule.id} has a required outcome`);
		assert.ok(rule.currentBehavior.length > 0, `${rule.id} has current behavior`);
		if (rule.policyAuthority === 'historical-provenance-only') {
			assert.match(rule.requiredOutcome, /preserves pre-freeze.*no family-v1.*authority/iu);
			assert.equal(
				rule.historicalPreFreezeNarrative?.status,
				'provenance-only-not-runtime-authority',
			);
			continue;
		}
		assert.equal(rule.policyAuthority, 'family-v1-active', rule.id);
		assert.ok(rule.evidence.length > 0, `${rule.id} has evidence`);
		for (const reference of rule.evidence) {
			const [repositoryPath] = reference.split('#');
			await assert.doesNotReject(
				access(new URL(`../${repositoryPath}`, import.meta.url)),
				`Missing compatibility evidence: ${reference}`,
			);
		}
		const activeText = `${rule.id}\n${rule.requiredOutcome}\n${rule.currentBehavior}`;
		assert.doesNotMatch(
			activeText,
			/\b(?:S(?:2[1-9]|30)|F(?:1[89]|2\d|3[0-2]))\b|schema(?:Version)?[- ]?(?:1[5-9]|2\d|3[0-2])/u,
			`${rule.id} cites a retired product generation`,
		);
		assert.doesNotMatch(
			activeText,
			/(?:Soundscaper-to(?:-fresh)?-Framescaper|Framescaper-to(?:-fresh)?-Soundscaper|less-capable recipient)/iu,
			`${rule.id} cites a retired cross-family semantic workflow`,
		);
		if (rule.historicalPreFreezeNarrative) {
			assert.equal(rule.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
		}
	}

	assert.equal(rules.get('future-core-read-only').status, 'implemented');
	assert.equal(rules.get('future-scape-round-trip').status, 'implemented');
	assert.equal(rules.get('unavailable-native-feature').status, 'planned');
});

test('compatibility register freezes two independent family-v1 stores and one Scape format', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	assert.equal(policy.releaseCandidate, '1.0.0-rc.1');
	assert.equal(Object.hasOwn(policy.baselineDecision, 'stableReleaseAdmission'), false);
	assert.equal(Object.hasOwn(policy.baselineDecision, 'approver'), false);
	assert.equal(policy.baselineDecision.releaseDecision, 'repository-owner-on-v1.0.0-tag');
	assert.deepEqual(policy.projectSchema.baselines.map(({ schemaFamily, currentVersion }) => ({ schemaFamily, currentVersion })), [
		{ schemaFamily: 'soundscaper', currentVersion: 1 },
		{ schemaFamily: 'framescaper', currentVersion: 1 },
	]);
	assert.deepEqual(policy.projectSchema.baselines.map(({ retainedMigrationSources }) => retainedMigrationSources), [[], []]);
	assert.deepEqual(policy.portableArchive.advertisedFormatVersions, [1]);
	assert.equal(policy.portableArchive.currentFormatVersion, 1);
	assert.equal(policy.portableArchive.legacyFamilylessFormat1Behavior, 'typed-reimport-required');
	assert.equal(policy.portableArchive.preReleaseFormat2Behavior, 'typed-reimport-required');
	assert.equal(policy.forwardReadOnly.allowMutation, false);
	assert.equal(policy.forwardReadOnly.allowOverwrite, false);
	assert.equal(policy.forwardReadOnly.opaqueClone, 'archive-byte-authority-no-domain-clone');
	assert.equal(policy.forwardReadOnly.portableArchiveStatus, 'implemented-byte-exact-save-copy');
	assert.deepEqual(policy.schemaRetirement.currentMinimumVersions, { soundscaper: 1, framescaper: 1 });
	assert.deepEqual(policy.schemaRetirement.requiredConditions, [
		'future-versioned-policy-change',
		'retained-migration-from-family-v1',
	]);
	assert.equal(Object.hasOwn(policy.schemaRetirement, 'approval'), false);
	assert.equal(policy.schemaRetirement.designRecord, 'docs/wp-9.0.0-baseline-decision.md');
});

test('compatibility documentation distinguishes the active baseline from historical provenance', async () => {
	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /1\.0 family baselines/u);
	assert.match(documentation, /schemaFamily: 'soundscaper'.*schemaVersion: 1/isu);
	assert.match(documentation, /schemaFamily: 'framescaper'.*schemaVersion: 1/isu);
	assert.match(documentation, /never opens, enumerates, migrates,\s+mutates, or deletes a pre-release/iu);
	assert.match(documentation, /known foreign-family or future-version format-1 archive/iu);
	assert.match(documentation, /opens as opaque\s+read-only custody.*byte-exact Save Copy/isu);
	assert.match(documentation, /Family-less format 1 and every pre-release format 2 archive require re-import/iu);
	assert.match(documentation, /managed desktop acquisition.*only after the owning family-v1 identity.*same-family workflows/isu);
	assert.match(documentation, /foreign-family archive never\s+enters those domain controls.*byte-exact Save Copy/isu);
	assert.match(documentation, /Version-bearing S21–S30, F18–F32[\s\S]*?provenance/iu);
	assert.match(documentation, /pushing the matching stable tag.*owner's\s+release decision/isu);
	assert.match(documentation, /does not certify it/iu);
	assert.doesNotMatch(documentation, /release admission/iu);
});
