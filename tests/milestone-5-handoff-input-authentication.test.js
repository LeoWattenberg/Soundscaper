/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	authenticateMilestone5HandoffAuditorInputs,
	describeMilestone5HandoffBytes,
	readMilestone5HandoffInputSnapshot,
} from '../scripts/lib/milestone-5-handoff-input-authentication.mjs';

const qualificationPath = 'config/milestone-5-qualification-evidence.json';
const policyPath = 'config/milestone-5-package-release-authentication-policy.json';

test('authenticated handoff inputs come from immutable Git blobs, not mutable worktree bytes', (context) => {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-m5-inputs-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'config'));
	writeFileSync(join(root, 'config/authority.json'), '{"value":"committed"}\n');
	git(root, 'init');
	git(root, 'config', 'user.email', 'tests@soundscaper.invalid');
	git(root, 'config', 'user.name', 'Soundscaper Tests');
	git(root, 'add', '.');
	git(root, 'commit', '-m', 'authority');
	const revision = git(root, 'rev-parse', 'HEAD');
	writeFileSync(join(root, 'config/authority.json'), '{"value":"working"}\n');

	const committed = readMilestone5HandoffInputSnapshot(
		root, { authority: 'config/authority.json' }, revision,
	);
	const working = readMilestone5HandoffInputSnapshot(
		root, { authority: 'config/authority.json' }, null,
	);
	assert.deepEqual(committed.inputs.authority, { value: 'committed' });
	assert.deepEqual(working.inputs.authority, { value: 'working' });
	assert.notEqual(
		committed.inputDigests['config/authority.json'].sha256,
		working.inputDigests['config/authority.json'].sha256,
	);
});

test('handoff auditor results must bind every repository authority they reopen', () => {
	const payloadPath = 'config/native-addon-payload-manifest.json';
	const sourcePath = 'config/milestone-5-native-source-acquisitions.json';
	const descriptors = Object.fromEntries([
		payloadPath, sourcePath, qualificationPath, policyPath,
	].map((path) => [path, describeMilestone5HandoffBytes(Buffer.from(path))]));
	const source = { id: 'juce', version: '9.0.1', authenticationStatus: 'pinned-metadata' };
	const sourceRegister = {
		schemaVersion: 1,
		groundedAt: '2026-08-24',
		purpose: 'fixture',
		delegatedSources: [],
		sources: [source],
	};
	const inputs = {
		sourceAcquisitionRegister: sourceRegister,
		sourceAcquisitions: {
			...sourceRegister,
			sources: [{ ...source, authenticationStatus: 'authenticated' }],
			inputDigests: { [sourcePath]: descriptors[sourcePath] },
		},
		payloadAudit: { inputDigests: { [payloadPath]: descriptors[payloadPath] } },
		qualificationAudit: {
			registerEvidence: { path: qualificationPath, ...descriptors[qualificationPath] },
		},
		packageAudit: { releaseAuthentication: {
			policyEvidence: { name: policyPath, ...descriptors[policyPath] },
		} },
	};
	const inputBytes = { [policyPath]: Buffer.from(policyPath) };
	assert.doesNotThrow(() => authenticateMilestone5HandoffAuditorInputs({
		inputs, inputBytes, inputDigests: descriptors,
	}));

	const drifted = structuredClone(inputs);
	drifted.payloadAudit.inputDigests[payloadPath].sha256 = '0'.repeat(64);
	assert.throws(
		() => authenticateMilestone5HandoffAuditorInputs({
			inputs: drifted, inputBytes, inputDigests: descriptors,
		}),
		/payload auditor input.*drifted/iu,
	);
	const invalidSourceStatus = structuredClone(inputs);
	invalidSourceStatus.sourceAcquisitions.sources[0].authenticationStatus = 'pinned-metadata';
	assert.throws(
		() => authenticateMilestone5HandoffAuditorInputs({
			inputs: invalidSourceStatus, inputBytes, inputDigests: descriptors,
		}),
		/native-source auditor changed juce\.authenticationStatus/iu,
	);
	inputs.sourceAcquisitions.sources[0].version = 'tampered';
	assert.throws(
		() => authenticateMilestone5HandoffAuditorInputs({
			inputs, inputBytes, inputDigests: descriptors,
		}),
		/native-source auditor changed juce\.version/iu,
	);
});

function git(cwd, ...arguments_) {
	return execFileSync('git', arguments_, { cwd, encoding: 'utf8' }).trim();
}
