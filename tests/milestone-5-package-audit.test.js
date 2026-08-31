/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	assessMilestone5PackageAudit,
	MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS,
} from '../scripts/lib/milestone-5-package-audit.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function load(path) {
	return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

function inputs() {
	return {
		licensingMatrix: load(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.licensingMatrix),
		sourceAcquisitions: load(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.sourceAcquisitions),
		nativeAddonPayload: load(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.nativeAddonPayload),
		soundscaperProfessionalPayload: load(
			MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.soundscaperProfessionalPayload,
		),
		mediaHostPayload: load(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.mediaHostPayload),
		openFxHostPayload: load(MILESTONE_5_PACKAGE_AUDIT_INPUT_PATHS.openFxHostPayload),
	};
}

test('Milestone 5 reports a machine package audit without qualification state', () => {
	const audit = assessMilestone5PackageAudit(inputs());

	assert.equal(audit.schemaVersion, 3);
	assert.equal(audit.kind, 'milestone-5-package-audit');
	assert.equal(audit.assessmentScope.kind, 'engineering-inputs');
	assert.equal(audit.status, 'failed', 'raw checked-in declarations are not in-process audits');
	assert.equal(audit.passed, false);
	assert.equal(audit.repositoryInputsVerified, false);
	assert.equal(audit.sourceInputsVerified, false);
	assert.equal(audit.package, null);
	assert.equal(audit.payloads.total, 20);
	assert.equal(audit.sources.total, 10);
	assert.equal(audit.licensing.distributionPolicies.length, 3);
	assert.equal(audit.licensing.nativeFormatPolicies.length, 38);
	assert.equal(Object.hasOwn(audit.licensing, 'disabledGates'), false);
	assert.equal(Object.hasOwn(audit.licensing, 'blockedPolicyRows'), false);
	assert.equal(Object.hasOwn(audit, 'evidenceAuthenticated'), false);
	assert.equal(Object.hasOwn(audit, 'evidenceSha256'), false);
	assert.equal(Object.hasOwn(audit, 'evidence'), false);
	assert.ok(Array.isArray(audit.checks.sources));
	assert.ok(Array.isArray(audit.checks.payloads));
	assert.equal(Object.hasOwn(audit, 'qualification'), false);
	assert.equal(Object.hasOwn(audit, 'milestoneReleaseReady'), false);
	assert.equal(Object.hasOwn(audit, 'packageCellReady'), false);
	assert.ok(audit.failures.some(({ id }) => id === 'input-verification:missing'));
});

test('product-scoped package audits retain only their source and payload inventory', () => {
	const value = inputs();
	delete value.nativeAddonPayload;
	delete value.mediaHostPayload;
	delete value.openFxHostPayload;
	value.sourceAcquisitions.sources = value.sourceAcquisitions.sources.filter(({ id }) => (
		['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2'].includes(id)
	));
	value.sourceAcquisitions.delegatedSources = [];
	const audit = assessMilestone5PackageAudit(value, ['soundscaper']);

	assert.deepEqual(audit.engineeringScope.products, ['soundscaper']);
	assert.equal(audit.sources.total, 6);
	assert.equal(audit.payloads.total, 5);
});

test('package audits reject incomplete and reordered native target inventories', () => {
	for (const mutate of [
		(value) => { value.soundscaperProfessionalPayload.targets.pop(); },
		(value) => { value.soundscaperProfessionalPayload.targets.reverse(); },
	]) {
		const value = inputs();
		mutate(value);
		assert.throws(() => assessMilestone5PackageAudit(value), /exact five-target inventory/iu);
	}
});
