/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessMilestone5AutomatedReadiness,
} from '../scripts/lib/milestone-5-handoff-automated-readiness.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

test('human review state cannot change Milestone 5 automated readiness or its digest', () => {
	const baseline = fixture();
	const reviewed = structuredClone(baseline);
	reviewed.sources[0].activationStatus = 'blocked';
	reviewed.sources[0].blockedBy = 'Human licensing review is pending.';
	reviewed.payloadRows[0].status = 'pending-external';
	reviewed.payloadRows[0].blockedBy = 'Human isolation readiness is pending.';
	reviewed.payloadRows[0].productionReadiness = {
		verified: { status: 'authenticated', reviewer: 'Release reviewer' },
	};
	reviewed.packageAudit.status = 'release-authentication-pending';
	reviewed.packageAudit.releaseAuthentication = {
		status: 'pending-external', reviewer: null, blockedBy: 'Human signature is pending.',
	};
	reviewed.packageAudit.runtimeManifest.value.reviewPolicy = {
		trustedKeys: [], blockedBy: 'Human reviewer has not accepted a key.',
	};

	const first = assessMilestone5AutomatedReadiness(baseline);
	const second = assessMilestone5AutomatedReadiness(reviewed);
	assert.equal(first.packageCellAutomatedReady, true);
	assert.equal(first.automatedStatus, 'automated-ready');
	assert.deepEqual(second, first);
});

test('source, payload, and package machine failures change automated evidence and block readiness', () => {
	const baseline = assessMilestone5AutomatedReadiness(fixture());
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
		const result = assessMilestone5AutomatedReadiness(changed);
		assert.equal(result.packageCellAutomatedReady, false, id);
		assert.equal(result.automatedStatus, 'automated-blocked', id);
		assert.notEqual(result.automatedEvidenceSha256, baseline.automatedEvidenceSha256, id);
		assert.ok(result.automatedBlockers.some((blocker) => blocker.id === id), id);
	}
	const hashMismatch = fixture();
	hashMismatch.sources[0].archiveEvidence.sha256 = DIGEST_B;
	const mismatched = assessMilestone5AutomatedReadiness(hashMismatch);
	assert.equal(mismatched.packageCellAutomatedReady, false);
	assert.notEqual(mismatched.automatedEvidenceSha256, baseline.automatedEvidenceSha256);
	assert.ok(mismatched.automatedBlockers.some(({ id }) => (
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
			activationStatus: 'accepted',
			blockedBy: null,
		}],
		payloadRows: [{
			identity: 'native:linux-x64',
			product: 'native',
			targetId: 'linux-x64',
			buildStatus: 'built',
			payloadEvidence: { path: 'native/payload.node', byteLength: 19, sha256: DIGEST_A },
			status: 'built',
			blockedBy: null,
			productionReadiness: null,
		}],
		packageAudit: {
			status: 'installed-application-closure-audited',
			releaseAuthentication: { status: 'authenticated', reviewer: 'Reviewer' },
			productId: 'native',
			targetId: 'linux-x64',
			applicationVersion: '1.0.0',
			sourceRevision: 'd'.repeat(40),
			runtimeManifest: {
				name: 'runtime-manifest-native-linux-x64.json',
				byteLength: 23,
				sha256: DIGEST_A,
				value: { reviewPolicy: { trustedKeys: ['human-key'] } },
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
