/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	describeMilestone5PackageAuditBytes,
	readMilestone5PackageAuditInputSnapshot,
	verifyMilestone5PackageAuditInputs,
} from '../scripts/lib/milestone-5-package-audit-inputs.mjs';

test('package-audit inputs come from immutable Git blobs, not mutable worktree bytes', (context) => {
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

	const committed = readMilestone5PackageAuditInputSnapshot(
		root, { authority: 'config/authority.json' }, revision,
	);
	const working = readMilestone5PackageAuditInputSnapshot(
		root, { authority: 'config/authority.json' }, null,
	);
	assert.deepEqual(committed.inputs.authority, { value: 'committed' });
	assert.deepEqual(working.inputs.authority, { value: 'working' });
	assert.notEqual(
		committed.inputDigests['config/authority.json'].sha256,
		working.inputDigests['config/authority.json'].sha256,
	);
});

test('package auditors bind every repository input they reopen', () => {
	const payloadPath = 'config/native-addon-payload-manifest.json';
	const sourcePath = 'config/milestone-5-native-source-acquisitions.json';
	const descriptors = Object.fromEntries([payloadPath, sourcePath]
		.map((path) => [path, describeMilestone5PackageAuditBytes(Buffer.from(path))]));
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
	};
	const inputBytes = { [payloadPath]: Buffer.from(payloadPath) };
	assert.doesNotThrow(() => verifyMilestone5PackageAuditInputs({
		inputs, inputBytes, inputDigests: descriptors,
	}));

	const drifted = structuredClone(inputs);
	drifted.payloadAudit.inputDigests[payloadPath].sha256 = '0'.repeat(64);
	assert.throws(
		() => verifyMilestone5PackageAuditInputs({
			inputs: drifted, inputBytes, inputDigests: descriptors,
		}),
		/payload auditor input.*drifted/iu,
	);
	const invalidSourceStatus = structuredClone(inputs);
	invalidSourceStatus.sourceAcquisitions.sources[0].authenticationStatus = 'pinned-metadata';
	assert.throws(
		() => verifyMilestone5PackageAuditInputs({
			inputs: invalidSourceStatus, inputBytes, inputDigests: descriptors,
		}),
		/native-source auditor changed juce\.authenticationStatus/iu,
	);
	inputs.sourceAcquisitions.sources[0].version = 'tampered';
	assert.throws(
		() => verifyMilestone5PackageAuditInputs({
			inputs, inputBytes, inputDigests: descriptors,
		}),
		/native-source auditor changed juce\.version/iu,
	);
});

function git(cwd, ...arguments_) {
	return execFileSync('git', arguments_, { cwd, encoding: 'utf8' }).trim();
}
