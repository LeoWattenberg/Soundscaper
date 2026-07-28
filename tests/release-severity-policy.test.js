/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/release-severity-policy.json', import.meta.url);
const documentationUrl = new URL('../docs/release-policy.md', import.meta.url);
const REQUIRED_DEFECT_CLASSES = [
	'audio-dropout',
	'av-drift',
	'data-loss-or-corruption',
	'dropped-video-frames',
	'inaccessible-critical-workflow',
	'license-or-provenance-failure',
	'security-boundary-failure',
];

test('release severity levels fail closed for critical and high defects', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	assert.equal(policy.schemaVersion, 1);
	assert.match(policy.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.deepEqual(policy.levels.map(({ id }) => id), ['critical', 'high', 'medium', 'low']);

	const levels = new Map(policy.levels.map((level) => [level.id, level]));
	assert.equal(levels.get('critical').releaseDisposition, 'block');
	assert.equal(levels.get('critical').waiver, 'prohibited');
	assert.equal(levels.get('high').releaseDisposition, 'block');
	assert.equal(levels.get('medium').releaseDisposition, 'approved-exception-only');
	assert.equal(levels.get('low').releaseDisposition, 'track');
	assert.equal(policy.releaseGate.maximumOpen.critical, 0);
	assert.equal(policy.releaseGate.maximumOpen.high, 0);
	assert.equal(policy.releaseGate.missingRequiredBudget, 'block');
	assert.equal(policy.releaseGate.unknownClassification, 'block-as-high');
});

test('release policy classifies every roadmap defect family and names evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const classes = new Map(policy.defectClasses.map((entry) => [entry.id, entry]));
	assert.equal(classes.size, policy.defectClasses.length);
	assert.deepEqual([...classes.keys()].sort(), REQUIRED_DEFECT_CLASSES);

	for (const entry of classes.values()) {
		assert.match(entry.defaultSeverity, /^(?:critical|high|medium|low)$/u, entry.id);
		assert.ok(entry.releaseCondition.length > 0, entry.id);
		assert.ok(entry.escalation.length > 0, entry.id);
		assert.ok(entry.currentEvidence.length > 0, entry.id);
		for (const reference of entry.currentEvidence) {
			const [repositoryPath] = reference.split('#');
			await assert.doesNotReject(
				access(new URL(`../${repositoryPath}`, import.meta.url)),
				`Missing release-policy evidence: ${reference}`,
			);
		}
	}

	for (const id of [
		'data-loss-or-corruption',
		'inaccessible-critical-workflow',
		'license-or-provenance-failure',
		'security-boundary-failure',
	]) assert.equal(classes.get(id).waiver, 'prohibited', id);
});

test('waivers are scoped, expiring records and never redefine numeric budgets', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	assert.deepEqual(policy.waiverPolicy.requiredFields, [
		'id', 'issue', 'owner', 'rationale', 'scope', 'workaround', 'approvedBy', 'approvedAt', 'expiresAt',
	]);
	assert.equal(policy.waiverPolicy.maximumLifetimeDays, 30);
	assert.equal(policy.waiverPolicy.mayChangeBudget, false);
	assert.equal(policy.waiverPolicy.expiredDisposition, 'block');
	assert.ok(policy.requalificationTriggers.includes('schema-or-migration-change'));
	assert.ok(policy.requalificationTriggers.includes('codec-runtime-or-driver-change'));
	assert.ok(policy.requalificationTriggers.includes('security-or-license-evidence-change'));

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /No open critical or high defects/u);
	assert.match(documentation, /Accessibility/u);
	assert.match(documentation, /Waivers/u);
	assert.match(documentation, /Rollback and recovery/u);
});
