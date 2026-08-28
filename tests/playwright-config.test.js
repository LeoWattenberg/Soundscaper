/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractJob } from './helpers/workflow-jobs.js';

test('Playwright allows CI to pass when a retry succeeds', async () => {
	process.env.CI = 'true';
	const { default: config } = await import('../playwright.config.mjs?ci-flaky-policy');

	assert.equal(config.retries, 1);
	assert.equal(config.failOnFlakyTests, false);
});

test('Playwright runs the maintained evergreen browser-engine matrix', async () => {
	delete process.env.CI;
	const { default: config } = await import('../playwright.config.mjs?browser-matrix');

	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium', 'firefox', 'webkit']);
	for (const project of config.projects) {
		assert.ok(project.use.browserName, `${project.name} must select an engine explicitly`);
		assert.equal(project.use.viewport.width, 1280);
		assert.equal(project.use.viewport.height, 720);
	}
	const firefox = config.projects.find(({ name }) => name === 'firefox');
	assert.equal(firefox.use.launchOptions?.firefoxUserPrefs, undefined);
	const webkit = config.projects.find(({ name }) => name === 'webkit');
	assert.equal(webkit.use.deviceScaleFactor, 1, 'WebKit CI must avoid Retina-scale canvas rasterization');
	for (const project of config.projects) {
		assert.equal(project.use.launchOptions?.firefoxUserPrefs, undefined);
	}
	assert.equal(config.use.serviceWorkers, 'block', 'ordinary browser tests must not install the offline shell');
});

test('desktop verification isolates browser engines and qualifies packages with every engine', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assertBrowserQualification(workflow, 'desktop');
	for (const jobName of ['package', 'package-with-tests', 'soundscaper-project-library-lease-matrix']) {
		// Packaging waits on the sharded Node suite and the merged coverage gate too:
		// a package built off unverified source is worse than no package.
		assert.match(extractJob(workflow, jobName), /needs: \[quality, tests, coverage, browser, firefox\]/u);
	}
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
});

test('quality verification keeps Chromium and WebKit in the pinned container and gives Firefox real audio', async () => {
	const workflow = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
	assertBrowserQualification(workflow, 'quality');
});

test('Firefox CI audio helpers configure a null sink/source and reject a stalled clock', async () => {
	const [pulseSetup, clockProbe] = await Promise.all([
		readFile(new URL('../scripts/ci-firefox-pulseaudio.sh', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/ci-firefox-audio-clock.mjs', import.meta.url), 'utf8'),
	]);

	assert.match(pulseSetup, /module-null-sink/u);
	assert.match(pulseSetup, /set-default-sink/u);
	assert.match(pulseSetup, /set-default-source[^\n]+\.monitor/u);
	assert.match(pulseSetup, /GITHUB_ENV/u);
	assert.match(clockProbe, /firefox\.launch/u);
	assert.match(clockProbe, /new AudioContext/u);
	assert.match(clockProbe, /currentTime/u);
	assert.match(clockProbe, /withTimeout/u);
	assert.match(clockProbe, /did not advance/u);
});

function assertBrowserQualification(workflow, label) {
	const qualityJob = extractJob(workflow, 'quality');
	const browserJob = extractJob(workflow, 'browser');
	const firefoxJob = extractJob(workflow, 'firefox');

	assert.doesNotMatch(qualityJob, /test:browser|playwright install/u, `${label} quality must not share a browser budget`);
	assert.ok(browserJob.includes('name: Browser / ${{ matrix.project }}'));
	assert.match(browserJob, /needs: quality/u);
	assert.match(browserJob, /matrix:\n\s+project: \[chromium, webkit\]/u);
	assert.match(browserJob, /container:\n\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e\n\s+options: --user 1001/u);
	assert.match(browserJob, /npm install --global --prefix "\$HOME\/\.local" npm@12\.0\.1/u);
	assert.match(browserJob, /name: verified-site-build/u);
	assertEngineIsSharded(browserJob, `${label} browser`, 'npm run test:browser:built -- --project=${{ matrix.project }}');

	// The handbook suite has its own Playwright config, so `--shard` cannot
	// divide it alongside the site suite. It has to be pinned to one leg of the
	// matrix or the shards would each run the whole of it.
	const handbookLegs = [...browserJob.matchAll(/^\s+if: (?<condition>matrix\.project == 'chromium'.*)$/gmu)];
	assert.equal(handbookLegs.length, 1, `${label} must run the handbook suite from exactly one job`);
	assert.match(handbookLegs[0].groups.condition, /matrix\.shard == 1/u, `${label} must not run the handbook suite once per shard`);

	assert.match(firefoxJob, /name: Browser \/ firefox/u);
	assert.match(firefoxJob, /needs: quality/u);
	assert.match(firefoxJob, /runs-on: ubuntu-24\.04/u);
	assert.doesNotMatch(firefoxJob, /^\s+container:/mu);
	assert.match(firefoxJob, /playwright install --with-deps firefox/u);
	assert.match(firefoxJob, /ci-apt-install\.sh pulseaudio pulseaudio-utils/u);
	assert.match(firefoxJob, /scripts\/ci-firefox-pulseaudio\.sh/u);
	assert.match(firefoxJob, /node scripts\/ci-firefox-audio-clock\.mjs/u);
	assert.match(firefoxJob, /name: verified-site-build/u);
	assertEngineIsSharded(firefoxJob, `${label} firefox`, 'npm run test:browser:built -- --project=firefox');
	assert.ok(
		firefoxJob.indexOf('ci-firefox-audio-clock.mjs')
			< firefoxJob.indexOf('test:browser:built -- --project=firefox'),
		`${label} must probe the real audio clock before Firefox qualification`,
	);
}

/**
 * Playwright is the pipeline's long pole, so every engine is split across
 * runners with `--shard`. Three things have to agree for that to qualify the
 * same tests the unsharded job did, and each is silent when it does not: the
 * `/N` denominator has to equal the number of matrix legs, or the shards the
 * matrix never runs take their tests with them; the job name has to say which
 * leg it is, or a red check cannot be read; and the diagnostics artifact name
 * has to carry the shard, or the legs collide on upload.
 */
function assertEngineIsSharded(job, label, runCommand) {
	const axis = job.match(/^\s+shard: \[(?<legs>[^\]]+)\]$/mu);
	assert.ok(axis, `${label} must shard Playwright across runners`);
	const legs = axis.groups.legs.split(',').map((leg) => leg.trim());
	assert.deepEqual(legs, ['1', '2', '3'], `${label} shard ids must be 1..N`);

	const total = legs.length;
	assert.ok(
		job.includes(`${runCommand} --shard=\${{ matrix.shard }}/${total}`),
		`${label} must run \`${runCommand}\` under --shard=\${{ matrix.shard }}/${total}`,
	);
	assert.match(
		job,
		new RegExp(`^\\s+name: Browser /.*\\$\\{\\{ matrix\\.shard \\}\\}/${total}$`, 'mu'),
		`${label} job name must name its shard`,
	);

	const artifact = job.match(/^\s+name: (?<artifact>browser-diagnostics-.+)$/mu);
	assert.ok(artifact, `${label} must upload browser diagnostics`);
	assert.ok(
		artifact.groups.artifact.includes('${{ matrix.shard }}'),
		`${label} diagnostics artifact name must include the shard or the legs collide on upload`,
	);
}
