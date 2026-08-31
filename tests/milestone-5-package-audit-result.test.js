/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessMilestone5PackageAuditResult,
} from '../scripts/lib/milestone-5-package-audit-result.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

test('non-audit metadata cannot change the Milestone 5 package-audit checks', () => {
	const baseline = fixture();
	const reviewed = structuredClone(baseline);
	reviewed.sources[0].notes = 'local cache copy';
	reviewed.payloadRows[0].notes = 'debug build log retained elsewhere';
	reviewed.packageAudit.notes = 'package smoke log retained elsewhere';

	const first = assessMilestone5PackageAuditResult(baseline);
	const second = assessMilestone5PackageAuditResult(reviewed);
	assert.equal(first.passed, true);
	assert.equal(first.status, 'passed');
	assert.equal(Object.hasOwn(first, 'evidenceAuthenticated'), false);
	assert.equal(Object.hasOwn(first, 'evidenceSha256'), false);
	assert.equal(Object.hasOwn(first, 'evidence'), false);
	assert.deepEqual(second, first);
});

test('source, payload, and package failures change checks and fail the package audit', () => {
	const baseline = assessMilestone5PackageAuditResult(fixture());
	for (const [id, mutate] of [
		['source-authentication:native-source', (value) => {
			value.sources[0].authenticationStatus = 'pending-external';
			value.sources[0].archiveEvidence = null;
			value.sources[0].extractedTreeEvidence = null;
		}],
		['payload:native:linux-x64', (value) => {
			value.payloadRows[0].buildStatus = 'pending-external';
			value.payloadRows[0].payload = null;
		}],
		['package-content:native:linux-x64', (value) => {
			value.packageAudit.packages[0].content = null;
		}],
	]) {
		const changed = fixture();
		mutate(changed);
		const result = assessMilestone5PackageAuditResult(changed);
		assert.equal(result.passed, false, id);
		assert.equal(result.status, 'failed', id);
		assert.notDeepEqual(result.checks, baseline.checks, id);
		assert.ok(result.failures.some((blocker) => blocker.id === id), id);
	}
	const hashMismatch = fixture();
	hashMismatch.sources[0].archiveEvidence.sha256 = DIGEST_B;
	const mismatched = assessMilestone5PackageAuditResult(hashMismatch);
	assert.equal(mismatched.passed, false);
	assert.notDeepEqual(mismatched.checks, baseline.checks);
	assert.ok(mismatched.failures.some(({ id }) => (
		id === 'source-authentication:native-source'
	)));
});

function fixture() {
	return {
		repositoryInputsVerified: true,
		sourceInputsAudited: true,
		payloadsAuthenticated: true,
		packageAudited: true,
		sourceRevisionVerified: true,
		sources: [{
			id: 'native-source',
			version: '1.0.0',
			git: { tag: 'v1.0.0', commit: 'c'.repeat(40) },
			archive: { byteLength: 11, sha256: DIGEST_A },
			extractedTree: {
				algorithm: 'framescaper-portable-source-tree-sha256-v1',
				fileCount: 2,
				sha256: DIGEST_B,
			},
			authenticationStatus: 'authenticated',
			archiveEvidence: { path: '/machine-specific/cache/archive', byteLength: 11, sha256: DIGEST_A },
			extractedTreeEvidence: {
				root: '/machine-specific/cache/source',
				algorithm: 'framescaper-portable-source-tree-sha256-v1',
				fileCount: 2,
				sha256: DIGEST_B,
			},
		}],
		payloadRows: [{
			identity: 'native:linux-x64',
			product: 'native',
			targetId: 'linux-x64',
			buildStatus: 'built',
			payload: { path: 'native/payload.node', byteLength: 19, sha256: DIGEST_A },
		}],
		packageAudit: {
			status: 'installed-application-closure-audited',
			productId: 'native',
			targetId: 'linux-x64',
			applicationVersion: '1.0.0',
			sourceRevision: 'd'.repeat(40),
			runtimeManifest: {
				name: 'runtime-manifest-native-linux-x64.json',
				byteLength: 23,
				sha256: DIGEST_A,
				value: {},
			},
			packages: [{
				label: 'Linux package',
				name: 'Native-1.0.0-linux-x64.AppImage',
				byteLength: 29,
				sha256: DIGEST_B,
				content: {
					status: 'installed-resource-closure-audited',
					closureSha256: DIGEST_A,
					contentManifestSha256: DIGEST_B,
					installedClosureSha256: DIGEST_A,
				},
			}],
		},
	};
}
