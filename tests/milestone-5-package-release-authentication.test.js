/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE,
	auditMilestone5PackageReleaseAuthentication,
	milestone5PackageReleaseAuthenticationEvidenceName,
	milestone5PackageReleaseStatementBytes,
} from '../scripts/lib/milestone-5-package-release-authentication.mjs';

const DIGEST = 'a'.repeat(64);
const REVISION = 'b'.repeat(40);

test('package release authentication requires a trusted signed exact-cell statement', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-package-release-auth-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = join(root, 'packages');
	await mkdir(packageRoot);
	const policyPath = join(root, 'policy.json');
	const packages = [packageDescriptor()];
	await writeJson(policyPath, policy([]));
	const pending = await auditMilestone5PackageReleaseAuthentication({
		repositoryRoot: root,
		packageRoot,
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: '1.2.3',
		sourceRevision: REVISION,
		packages,
		policyPath,
	});
	assert.equal(pending.status, 'pending-external');
	assert.equal(pending.evidence, null);

	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	await writeJson(policyPath, policy([{
		id: 'release-review-2026',
		status: 'accepted',
		publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
	}]));
	const statement = {
		schemaVersion: 1,
		statementType: MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE,
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: '1.2.3',
		sourceRevision: REVISION,
		keyId: 'release-review-2026',
		reviewer: 'Release Reviewer',
		reviewedAt: '2026-08-24T12:00:00Z',
		packages,
		controls: {
			artifactSignatures: 'accepted',
			platformTrust: 'accepted',
			installerSemantics: 'accepted',
		},
	};
	const signature = sign(null, milestone5PackageReleaseStatementBytes(statement), privateKey)
		.toString('base64');
	const evidenceName = milestone5PackageReleaseAuthenticationEvidenceName(
		'soundscaper',
		'linux-x64',
	);
	await writeJson(join(packageRoot, evidenceName), {
		schemaVersion: 1,
		statement,
		signature,
	});
	const audit = await auditMilestone5PackageReleaseAuthentication({
		repositoryRoot: root,
		packageRoot,
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: '1.2.3',
		sourceRevision: REVISION,
		packages,
		policyPath,
	});
	assert.equal(audit.status, 'authenticated');
	assert.equal(audit.evidence.name, evidenceName);
	assert.equal(audit.keyId, 'release-review-2026');

	await assert.rejects(auditMilestone5PackageReleaseAuthentication({
		repositoryRoot: root,
		packageRoot,
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: '1.2.3',
		sourceRevision: REVISION,
		packages: [{ ...packages[0], sha256: 'c'.repeat(64) }],
		policyPath,
	}), /not bound to this package cell/iu);
});

function packageDescriptor() {
	return {
		label: 'Linux x64 AppImage',
		name: 'Soundscaper-1.2.3-linux-x64.AppImage',
		byteLength: 123,
		sha256: DIGEST,
		content: {
			status: 'installed-resource-closure-audited',
			installedClosureSha256: DIGEST,
		},
	};
}

function policy(trustedKeys) {
	return {
		schemaVersion: 1,
		statementType: MILESTONE_5_PACKAGE_RELEASE_STATEMENT_TYPE,
		algorithm: 'Ed25519',
		trustedKeys,
		blockedBy: 'No accepted exact package release review statement is available for this package cell.',
	};
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
