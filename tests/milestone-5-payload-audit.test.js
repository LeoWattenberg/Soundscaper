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
	assert.equal(audit.schemaVersion, 3);
	assert.equal(Object.keys(audit.inputDigests).length, 4);
	assert.equal('reviewPolicy' in audit, false);
	assert.ok(audit.rows.every((row) => row.buildStatus === row.status));
	assert.ok(audit.rows.every((row) => !('productionReadiness' in row)));
	assert.equal(isAuditedMilestone5Payloads(structuredClone(audit)), false);
});

test('Soundscaper payload audit authenticates only five professional target rows', async () => {
	const audit = await auditMilestone5Payloads(repositoryRoot, ['soundscaper']);
	assert.equal(isAuditedMilestone5Payloads(audit), true);
	assert.equal(audit.rows.length, 5);
	assert.deepEqual([...new Set(audit.rows.map(({ product }) => product))], [
		'soundscaper-professional',
	]);
	assert.deepEqual(Object.keys(audit.manifests), ['soundscaperProfessional']);
	assert.deepEqual(Object.keys(audit.inputDigests).sort(), [
		'config/soundscaper-professional-native-payload-manifest.json',
	]);
	assert.ok(!audit.rows.some(({ product }) => product.startsWith('framescaper')));
});

test('professional and Framescaper build bytes are audited from their payload descriptors', () => {
	for (const product of [
		'soundscaper-professional', 'framescaper-media', 'framescaper-openfx',
	]) {
		const built = createMilestone5PayloadAuditRow({
			product,
			targetId: 'linux-x64',
			status: 'built',
			blockedBy: null,
			payload: { sha256: 'a'.repeat(64) },
		});
		assert.equal(built.automatedReady, true);
		assert.equal(built.buildStatus, 'built');
		assert.equal(built.status, 'built');
		assert.equal('productionReadiness' in built, false);

		const changedPayload = createMilestone5PayloadAuditRow({
			product,
			targetId: 'linux-x64',
			status: 'built',
			blockedBy: null,
			payload: { sha256: 'b'.repeat(64) },
		});
		assert.notEqual(changedPayload.automatedEvidenceSha256,
			built.automatedEvidenceSha256);
	}
});
