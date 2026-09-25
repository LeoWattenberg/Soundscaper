/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('desktop distribution and automated test artifacts have separate workflow entry points', async () => {
	const preview = await readWorkflow('desktop-preview.yml');
	const tested = await readWorkflow('desktop-nightly-tests.yml');
	const previewHeader = preview.slice(0, preview.indexOf('\njobs:\n'));
	const testedHeader = tested.slice(0, tested.indexOf('\njobs:\n'));

	assert.match(previewHeader, /^name: Desktop preview and nightly$/mu);
	assert.match(previewHeader, /schedule:\s+(?:#.*\n\s+)*- cron:/u);
	assert.match(previewHeader, /push:\s+tags:/u);
	assert.match(previewHeader, /workflow_dispatch:/u);
	assert.doesNotMatch(previewHeader, /workflow_run:|artifact_variant:|nightly_tests_targets:/u);
	for (const job of ['package', 'milestone-5-package-audit-summary', 'release-inventory', 'soundscaper-project-library-lease-matrix']) {
		assert.ok(extractJob(preview, job).length > 0, `${job} belongs to desktop distribution`);
	}
	for (const job of ['nightly-test-targets', 'verify-assistance-runtime-handoff', 'package-with-tests']) {
		assert.doesNotMatch(preview, new RegExp(`^  ${job}:`, 'mu'));
	}

	assert.match(testedHeader, /^name: Desktop test artifacts \(internal\)$/mu);
	assert.match(testedHeader, /workflow_dispatch:\s+inputs:\s+nightly_tests_targets:/u);
	assert.doesNotMatch(testedHeader, /workflow_run:|schedule:|push:\s+tags:|artifact_variant:/u);
	for (const job of ['nightly-test-targets', 'verify-assistance-runtime-handoff', 'package-with-tests']) {
		assert.ok(extractJob(tested, job).length > 0, `${job} belongs to automated tests`);
	}
	for (const job of ['package', 'milestone-5-package-audit-summary', 'release-inventory', 'soundscaper-project-library-lease-matrix']) {
		assert.doesNotMatch(tested, new RegExp(`^  ${job}:`, 'mu'));
	}
	assert.match(testedHeader, /cancel-in-progress: false/u);
	assert.doesNotMatch(tested, /desktop:publish:assistance-runtimes|R2_MODELS_ACCESS_KEY_ID/u);
	assert.match(extractJob(tested, 'verify-assistance-runtime-handoff'), /publish-assistance-runtime-assets\.mjs --verify/u);
	const stable = await readWorkflow('soundscaper-stable-1.yml');
	const assetUpdate = await readWorkflow('update-ai-assets.yml');
	for (const [name, workflow] of [['desktop preview', preview], ['stable release', stable]]) {
		assert.match(workflow, /publish-assistance-runtime-assets\.mjs --verify/u, `${name} must verify published AI archives`);
	}
	assert.match(extractJob(preview, 'publish-windows-assistance-runtime-handoff'),
		/desktop:publish:assistance-runtimes/u);
	assert.doesNotMatch(extractJob(preview, 'package'), /R2_MODELS_ACCESS_KEY_ID/u);
	assert.doesNotMatch(stable, /desktop:publish:assistance-runtimes|R2_MODELS_ACCESS_KEY_ID/u,
		'stable release must leave AI runtime publication to Update AI assets');
	assert.match(assetUpdate, /desktop:publish:assistance-runtimes/u);
});
