/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
		assert.match(extractJob(workflow, jobName), /needs: \[quality, browser, firefox\]/u);
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
	assert.match(browserJob, /strategy:\n\s+fail-fast: false\n\s+matrix:\n\s+project: \[chromium, webkit\]/u);
	assert.match(browserJob, /container:\n\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e\n\s+options: --user 1001/u);
	assert.match(browserJob, /npm install --global --prefix "\$HOME\/\.local" npm@12\.0\.1/u);
	assert.match(browserJob, /name: verified-site-build/u);
	assert.ok(browserJob.includes('npm run test:browser:built -- --project=${{ matrix.project }}'));
	assert.ok(browserJob.includes('name: browser-diagnostics-${{ matrix.project }}'));

	assert.match(firefoxJob, /name: Browser \/ firefox/u);
	assert.match(firefoxJob, /needs: quality/u);
	assert.match(firefoxJob, /runs-on: ubuntu-24\.04/u);
	assert.doesNotMatch(firefoxJob, /^\s+container:/mu);
	assert.match(firefoxJob, /playwright install --with-deps firefox/u);
	assert.match(firefoxJob, /ci-apt-install\.sh pulseaudio pulseaudio-utils/u);
	assert.match(firefoxJob, /scripts\/ci-firefox-pulseaudio\.sh/u);
	assert.match(firefoxJob, /node scripts\/ci-firefox-audio-clock\.mjs/u);
	assert.match(firefoxJob, /name: verified-site-build/u);
	assert.match(firefoxJob, /npm run test:browser:built -- --project=firefox/u);
	assert.match(firefoxJob, /name: browser-diagnostics-firefox/u);
	assert.ok(
		firefoxJob.indexOf('ci-firefox-audio-clock.mjs')
			< firefoxJob.indexOf('test:browser:built -- --project=firefox'),
		`${label} must probe the real audio clock before Firefox qualification`,
	);
}

function extractJob(workflow, jobName) {
	const marker = `\n  ${jobName}:\n`;
	const start = workflow.indexOf(marker);
	assert.notEqual(start, -1, `missing ${jobName} workflow job`);
	const remainder = workflow.slice(start + marker.length);
	const nextJob = remainder.search(/^ {2}[a-z][a-z0-9-]*:\s*$/mu);
	return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}
