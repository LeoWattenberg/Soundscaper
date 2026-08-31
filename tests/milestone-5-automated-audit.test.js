/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessMilestone5AutomatedAudit,
} from '../scripts/lib/milestone-5-handoff-automated-audit.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

test('non-audit metadata cannot change the Milestone 5 automated audit or its digest', () => {
	const baseline = fixture();
	const reviewed = structuredClone(baseline);
	reviewed.sources[0].notes = 'local cache copy';
	reviewed.payloadRows[0].notes = 'debug build log retained elsewhere';
	reviewed.packageAudit.notes = 'package smoke log retained elsewhere';

	const first = assessMilestone5AutomatedAudit(baseline);
	const second = assessMilestone5AutomatedAudit(reviewed);
	assert.equal(first.passed, true);
	assert.equal(first.status, 'passed');
	assert.deepEqual(second, first);
});

test('source, payload, and package failures change audit data and fail the automated audit', () => {
	const baseline = assessMilestone5AutomatedAudit(fixture());
	for (const [id, mutate] of [
		['source-authentication:native-source', (value) => {
			value.sources[0].authenticationStatus = 'pending-external';
			value.sources[0].archiveEvidence = null;
			value.sources[0].extractedTreeEvidence = null;
		}],
		['payload:native:linux-x64', (value) => {
			value.payloadRows[0].buildStatus = 'pending-external';
			value.payloadRows[0].payloadEvidence = null;
		}],
		['package-content:native:linux-x64', (value) => {
			value.packageAudit.packages[0].content = null;
		}],
	]) {
		const changed = fixture();
		mutate(changed);
		const result = assessMilestone5AutomatedAudit(changed);
		assert.equal(result.passed, false, id);
		assert.equal(result.status, 'failed', id);
		assert.notEqual(result.evidenceSha256, baseline.evidenceSha256, id);
		assert.ok(result.failures.some((blocker) => blocker.id === id), id);
	}
	const hashMismatch = fixture();
	hashMismatch.sources[0].archiveEvidence.sha256 = DIGEST_B;
	const mismatched = assessMilestone5AutomatedAudit(hashMismatch);
	assert.equal(mismatched.passed, false);
	assert.notEqual(mismatched.evidenceSha256, baseline.evidenceSha256);
	assert.ok(mismatched.failures.some(({ id }) => (
		id === 'source-authentication:native-source'
	)));
});

function fixture() {
	return {
		assemblyInputsAuthenticated: true,
		sourceInputsAudited: true,
		payloadsAuthenticated: true,
		packageAudited: true,
		sourceRevisionAuthenticated: true,
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
			payloadEvidence: { path: 'native/payload.node', byteLength: 19, sha256: DIGEST_A },
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
