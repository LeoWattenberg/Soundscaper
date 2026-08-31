/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_5_PACKAGE_AUDIT_IDENTITIES,
	milestone5PackageAuditDirectoryNames,
	readMilestone5PackageAuditDirectory,
	summarizeMilestone5PackageAudits,
} from '../scripts/lib/milestone-5-package-audit-summary.mjs';

const REVISION = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

test('the package-audit summary covers every product target without release semantics', () => {
	const summary = summarizeMilestone5PackageAudits(
		MILESTONE_5_PACKAGE_AUDIT_IDENTITIES.map(audit),
	);

	assert.equal(summary.schemaVersion, 1);
	assert.equal(summary.kind, 'milestone-5-package-audit-summary');
	assert.equal(summary.auditCount, 10);
	assert.equal(summary.packageFilesRevalidated, false);
	assert.equal(summary.passed, false);
	assert.equal(summary.status, 'unverified');
	assert.equal(summary.packageCount, 10);
	assert.equal(Object.hasOwn(summary, 'matrix'), false);
	assert.equal(Object.hasOwn(summary, 'evidenceAuthenticated'), false);
	assert.equal(Object.hasOwn(summary, 'evidenceSha256'), false);
	assert.doesNotMatch(JSON.stringify(summary), /qualification|admission|readiness/iu);
});

test('the package-audit summary rejects duplicate identities and malformed results', () => {
	const duplicate = MILESTONE_5_PACKAGE_AUDIT_IDENTITIES.map(audit);
	duplicate[1] = structuredClone(duplicate[0]);
	assert.throws(() => summarizeMilestone5PackageAudits(duplicate), /unique/iu);

	const malformed = MILESTONE_5_PACKAGE_AUDIT_IDENTITIES.map(audit);
	malformed[0].status = 'failed';
	assert.throws(() => summarizeMilestone5PackageAudits(malformed), /result state/iu);
});

test('package re-auditing accepts the exact local or downloaded artifact directory inventory', () => {
	const localNames = MILESTONE_5_PACKAGE_AUDIT_IDENTITIES.map(
		({ productId, targetId }) => `${productId}-${targetId}`,
	);
	const artifactNames = localNames.map((name) => `nightly-${name}`);

	assert.deepEqual(milestone5PackageAuditDirectoryNames(localNames), localNames);
	assert.deepEqual(milestone5PackageAuditDirectoryNames(artifactNames), artifactNames);
	assert.throws(
		() => milestone5PackageAuditDirectoryNames([
			...artifactNames.slice(0, -1),
			localNames.at(-1),
		]),
		/missing or unexpected/iu,
	);
});

test('serialized package audits must be canonical, complete, and direct', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5-package-audits-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	for (const identity of MILESTONE_5_PACKAGE_AUDIT_IDENTITIES) {
		await writeFile(
			join(directory, `milestone-5-package-audit-${identity.productId}-${identity.targetId}.json`),
			`${JSON.stringify(audit(identity), null, '\t')}\n`,
		);
	}
	const audited = await readMilestone5PackageAuditDirectory(directory);
	assert.equal(audited.status, 'unverified');
	assert.equal(audited.fileDescriptors.length, 10);

	await mkdir(join(directory, 'foreign'));
	await assert.rejects(
		readMilestone5PackageAuditDirectory(directory),
		/missing or unexpected entries/iu,
	);
});

function audit(identity) {
	const packageName = `${identity.productId}-${identity.targetId}.zip`;
	return {
		schemaVersion: 3,
		kind: 'milestone-5-package-audit',
		assessmentScope: { kind: 'package', ...identity },
		sourceRevision: REVISION,
		observedHeadRevision: REVISION,
		sourceRevisionBinding: {
			status: 'verified-clean-head',
			sourceRevision: REVISION,
		},
		repositoryInputsVerified: true,
		sourceInputsVerified: true,
		passed: true,
		status: 'passed',
		checks: { sources: [], payloads: [], package: null },
		failures: [],
		package: {
			status: 'installed-application-closure-audited',
			productId: identity.productId,
			targetId: identity.targetId,
			applicationVersion: '1.0.0',
			sourceRevision: REVISION,
			runtimeManifest: {
				name: `runtime-manifest-${identity.productId}-${identity.targetId}.json`,
				byteLength: 100,
				sha256: DIGEST,
			},
			packages: [{
				label: 'archive',
				name: packageName,
				byteLength: 1_000,
				sha256: DIGEST,
				content: null,
			}],
			packageCount: 1,
			totalPackageBytes: 1_000,
		},
	};
}
