/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	auditMilestone5Payloads,
	createMilestone5PayloadAuditRow,
	isAuditedMilestone5Payloads,
} from '../scripts/lib/milestone-5-payload-audit.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('Milestone 5 payload audit authenticates all twenty exact target rows', async () => {
	const audit = await auditMilestone5Payloads(repositoryRoot);
	assert.equal(isAuditedMilestone5Payloads(audit), true);
	assert.equal(audit.rows.length, 20);
	assert.equal(audit.rows.filter(({ status }) => status === 'built').length, 1);
	assert.deepEqual(audit.rows.filter(({ status }) => status === 'built').map(({ identity }) => identity), [
		'soundscaper:linux-x64',
	]);
	assert.equal(audit.schemaVersion, 2);
	assert.equal(Object.keys(audit.inputDigests).length, 5);
	assert.deepEqual(audit.reviewPolicy, {
		path: 'config/milestone-5-native-isolation-review-policy.json',
		...audit.inputDigests['config/milestone-5-native-isolation-review-policy.json'],
	});
	assert.ok(audit.rows.every((row) => (
		row.buildStatus === row.status && row.productionReadiness === null
	)));
	assert.equal(isAuditedMilestone5Payloads(structuredClone(audit)), false);
});

test('professional and Framescaper build bytes are not release-built without authenticated readiness', () => {
	for (const product of [
		'soundscaper-professional', 'framescaper-media', 'framescaper-openfx',
	]) {
		assert.deepEqual(createMilestone5PayloadAuditRow({
			product,
			targetId: 'linux-x64',
			status: 'built',
			blockedBy: null,
			payload: { sha256: 'a'.repeat(64) },
			productionReadiness: null,
		}), {
			identity: `${product}:linux-x64`,
			product,
			targetId: 'linux-x64',
			buildStatus: 'built',
			status: 'pending-external',
			blockedBy: `The ${product}:linux-x64 payload has no authenticated per-target production-readiness evidence.`,
			productionReadiness: null,
		});
	}
});
