/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('desktop distribution job environments do not reference an unassigned runner', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const jobEnvironments = workflow.matchAll(/^ {4}env:\n(?: {6}[^\n]*\n)*/gmu);
	for (const [environment] of jobEnvironments) {
		// GitHub validates job env before it assigns a runner. Runner-bound paths
		// must be resolved by a step, where the runner context is available.
		assert.doesNotMatch(environment, /\$\{\{[^}]*\brunner\./u);
	}
});

test('desktop preview restores Electron before the native protocol test shard', async () => {
	const tests = extractJob(await readWorkflow('desktop-preview.yml'), 'tests');
	assert.match(tests, /if: matrix\.shard == 'common-2'\s+run: \|\s+if \[ ! -x node_modules\/electron\/dist\/electron \]; then\s+node node_modules\/electron\/install\.js\s+fi\s+test -x node_modules\/electron\/dist\/electron/u);
	assert.ok(tests.indexOf('node node_modules/electron/install.js')
		< tests.indexOf('run: xvfb-run --auto-servernum npm run test:shard'));
});

test('desktop preview keeps browser partitions aligned with the Quality gate', async () => {
	const [preview, quality] = await Promise.all([
		readWorkflow('desktop-preview.yml'), readWorkflow('quality.yml'),
	]);
	for (const jobName of ['browser', 'firefox']) {
		const canonical = extractJob(quality, jobName);
		const desktop = extractJob(preview, jobName);
		const shards = /shard: \[([\d, ]+)\]/u.exec(canonical)?.[1];
		assert.ok(shards, `${jobName} defines its Quality partitions`);
		const shardCount = shards.split(',').length;
		assert.equal(/shard: \[([\d, ]+)\]/u.exec(desktop)?.[1], shards,
			`${jobName} must use the same partitions to stay within the job timeout`);
		const label = /^\s+name:\s+([^\n]+)/mu.exec(desktop)?.[1];
		assert.ok(label?.endsWith(`\${{ matrix.shard }}/${shardCount}`),
			`${jobName} labels the complete partition count`);
		assert.ok(desktop.includes(`--shard=\${{ matrix.shard }}/${shardCount}`),
			`${jobName} runs every partition using the declared total`);
		assert.match(desktop, /timeout-minutes: 45/u);
	}
});

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
	assert.match(testedHeader, /push:\s+branches:\s+- main/u);
	assert.match(testedHeader, /workflow_dispatch:\s+inputs:\s+nightly_tests_targets:/u);
	assert.doesNotMatch(testedHeader, /workflow_run:|schedule:|push:\s+tags:|artifact_variant:/u);
	for (const job of ['nightly-test-targets', 'package-with-tests']) {
		assert.ok(extractJob(tested, job).length > 0, `${job} belongs to automated tests`);
	}
	assert.doesNotMatch(tested, /^ {2}verify-assistance-runtime-handoff:/mu);
	for (const job of ['quality', 'tests', 'coverage', 'browser', 'firefox']) {
		assert.doesNotMatch(tested, new RegExp(`^  ${job}:`, 'mu'));
	}
	for (const job of ['package', 'milestone-5-package-audit-summary', 'release-inventory', 'soundscaper-project-library-lease-matrix']) {
		assert.doesNotMatch(tested, new RegExp(`^  ${job}:`, 'mu'));
	}
	assert.match(testedHeader, /cancel-in-progress: false/u);
	assert.match(extractJob(tested, 'package-with-tests'), /stage-desktop-test-runtime-snapshot\.mjs/u);
	assert.doesNotMatch(tested, /desktop:publish:assistance-runtimes|R2_MODELS_|desktop-prepare\.mjs/u);
	assert.doesNotMatch(extractJob(tested, 'package-with-tests'),
		/desktop:publish:assistance-runtimes|R2_MODELS_/u);
	const stable = await readWorkflow('soundscaper-stable-1.yml');
	const assetUpdate = await readWorkflow('update-ai-assets.yml');
	for (const [name, workflow] of [['desktop preview', preview], ['stable release', stable]]) {
		assert.match(workflow, /publish-assistance-runtime-assets\.mjs --verify/u, `${name} must verify published AI archives`);
	}
	assert.match(extractJob(preview, 'publish-assistance-runtime-handoff'),
		/desktop:publish:assistance-runtimes/u);
	assert.doesNotMatch(extractJob(preview, 'package'), /R2_MODELS_ACCESS_KEY_ID/u);
	assert.doesNotMatch(stable, /desktop:publish:assistance-runtimes|R2_MODELS_ACCESS_KEY_ID/u,
		'stable release must leave AI runtime publication to Update AI assets');
	assert.match(assetUpdate, /desktop:publish:assistance-runtimes/u);
});
