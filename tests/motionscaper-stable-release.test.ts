/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob } from './helpers/workflow-jobs.js';

test('Motion stable reuses the complete quality workflow including all browser engines, links, handbook and union', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-stable.yml', import.meta.url), 'utf8');
	const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
	assert.match(workflow, /'motionscaper-v\*'/u); assert.match(workflow, /'!motionscaper-v\*-\*'/u);
	assert.match(extractJob(workflow, 'admit'), /verify-motionscaper-release.ts[\s\S]*--expected-channel=stable[\s\S]*--source-revision/u);
	assert.match(extractJob(workflow, 'quality'), /needs: admit[\s\S]*uses: \.\/\.github\/workflows\/quality.yml/u);
	assert.match(quality, /workflow_call:/u);
	const audits = extractJob(quality, 'audits');
	for (const variable of ['CONTROLLER_DOMAIN_BASE_REVISION', 'MAINTAINABILITY_BASE_REVISION']) {
		assert.ok(audits.includes(`${variable}: \u0024{{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'push' && github.ref_type == 'branch' && github.event.before || github.sha }}`), 'own tag has no branch before revision; compare against its exact checkout');
	}
	assert.match(extractJob(quality, 'browser'), /project: \[chromium, webkit\]/u);
	assert.match(extractJob(quality, 'browser'), /test:browser:motion-links/u);
	assert.match(extractJob(quality, 'browser'), /test:browser:dual-origin/u);
	assert.match(extractJob(quality, 'browser'), /test:docs:browser/u);
	assert.match(extractJob(quality, 'firefox'), /--project=firefox/u);
	assert.match(extractJob(quality, 'coverage'), /coverage:check/u);
	assert.match(extractJob(quality, 'deploy'), /github.event_name == 'push' && github.ref == 'refs\/heads\/main'/u);
	assert.match(extractJob(workflow, 'package'), /motionscaper-desktop-preview.yml[\s\S]*expected-channel: stable/u);
	assert.match(extractJob(workflow, 'draft-release'), /needs: \[admit, quality, package, web\]/u);
	assert.match(extractJob(workflow, 'deploy-web'), /needs: \[admit, web, draft-release\]/u);
	assert.match(extractJob(workflow, 'publish-release'), /needs: \[admit, deploy-web\]/u);
	assert.doesNotMatch(workflow, /prepare-soundscaper-release|continue-on-error|workflow_dispatch|--no-verify/u);
});

test('Motion stable retains one source-bound production browser artifact and verifies exact live bytes before publication', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-stable.yml', import.meta.url), 'utf8');
	const web = extractJob(workflow, 'web'); const deploy = extractJob(workflow, 'deploy-web');
	assert.match(web, /SCAPE_PRODUCT: motionscaper/u); assert.match(web, /MOTIONSCAPER_SITE: https:\/\/motionscaper.org/u);
	assert.match(web, /MOTIONSCAPER_PAGES_COLD_START/u); assert.doesNotMatch(web, /SCAPE_PAGES_COLD_START: ['"]?1/u);
	assert.match(web, /motionscaper-release-web.ts --operation=build/u);
	assert.doesNotMatch(web, /--operation=capture/u);
	assert.match(web, /name: motionscaper-stable-web/u);
	assert.match(deploy, /motionscaper-release-web.ts --operation=verify/u);
	assert.ok(deploy.indexOf('--operation=verify') < deploy.indexOf('wrangler pages deploy'));
	assert.match(deploy, /--project-name=motionscaper --branch=main/u); assert.match(deploy, /set -euo pipefail/u);
	assert.match(deploy, /SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL: dist\/offline-shell.json/u);
	assert.match(deploy, /SCAPE_DEPLOY_IDENTITY_EVIDENCE: pages-deployment-identity.json/u);
	assert.match(extractJob(workflow, 'publish-release'), /gh release upload[\s\S]*pages-deployment-identity.json[\s\S]*gh release edit[\s\S]*--draft=false/u);
	assert.doesNotMatch(web + deploy, /\.wrangler\/browser-products|127\.0\.0\.1/u);
	assert.equal([...workflow.matchAll(/contents: write/gu)].length, 2);
	for (const match of workflow.matchAll(/uses: (\S+)/gu)) {
		assert.ok(match[1]!.startsWith('./') || /@[a-f\d]{40}$/u.test(match[1]!), match[1]);
	}
});

test('Motion reusable package workflow defaults to candidate and forwards exact requested channel to both validators', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /expected-channel:[\s\S]*default: candidate/u);
	const packageJob = extractJob(workflow, 'package'); const inventory = extractJob(workflow, 'inventory');
	assert.match(packageJob, /verify-motionscaper-release.ts[\s\S]*--expected-channel="\$MOTION_RELEASE_CHANNEL"/u);
	assert.match(inventory, /motionscaper-release-assets.ts[\s\S]*--expected-channel="\$MOTION_RELEASE_CHANNEL"/u);
	for (const job of [packageJob, inventory]) assert.match(job, /MOTION_RELEASE_CHANNEL:.*inputs.expected-channel/u);
	assert.match(packageJob, /--publish never/u);
	assert.match(packageJob, /motionscaper-linux-qualification/u);
	assert.doesNotMatch(workflow, /contents: write|gh release/u);
});
