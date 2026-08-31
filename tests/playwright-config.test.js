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
	assert.ok(config.testIgnore.includes('dual-origin/**'),
		'the ordinary suite must not accidentally run the separately served dual-origin workflow');
});

test('ordinary Playwright previews separately built Soundscaper and Framescaper origins', async () => {
	delete process.env.CI;
	process.env.PLAYWRIGHT_PORT = '4372';
	process.env.PLAYWRIGHT_FRAMESCAPER_PORT = '4379';
	try {
		const [{ default: config }, packageText, prepareScript] = await Promise.all([
			import('../playwright.config.mjs?product-sites'),
			readFile(new URL('../package.json', import.meta.url), 'utf8'),
			readFile(new URL('../scripts/prepare-browser-product-sites.mjs', import.meta.url), 'utf8'),
		]);
		const scripts = JSON.parse(packageText).scripts;

		assert.equal(config.use.baseURL, 'http://127.0.0.1:4372');
		assert.equal(config.use.ignoreHTTPSErrors, undefined);
		assert.ok(Array.isArray(config.webServer));
		assert.equal(config.webServer.length, 2);
		for (const [server, product, port] of [
			[config.webServer[0], 'soundscaper', '4372'],
			[config.webServer[1], 'framescaper', '4379'],
		]) {
			assert.equal(server.url, `http://127.0.0.1:${port}/en/`);
			assert.match(server.command, /^node node_modules\/vite\/bin\/vite\.js preview /u);
			assert.ok(server.command.includes(`.wrangler/browser-products/${product}`));
			assert.ok(server.command.includes(`--port ${port}`));
			assert.ok(server.command.includes('--host 127.0.0.1'));
			assert.ok(server.command.includes('--strictPort'));
			assert.equal(server.ignoreHTTPSErrors, undefined);
			assert.equal(server.reuseExistingServer, false);
		}

		assert.equal(scripts['build:browser:framescaper'],
			'node scripts/build-browser-product-site.mjs framescaper');
		assert.equal(scripts['prepare:browser:products'],
			'node scripts/prepare-browser-product-sites.mjs');
		assert.equal(scripts['pretest:browser'],
			'npm run build && npm run build:browser:framescaper && npm run prepare:browser:products');
		assert.equal(scripts['pretest:browser:built'], 'npm run prepare:browser:products');
		assert.match(prepareScript, /verifyBrowserProductSite/u,
			'the prebuilt Framescaper artifact must be authenticated before Playwright starts');
		assert.doesNotMatch(prepareScript, /localizeRetiredFramescaperRedirects/u,
			'the disposable fixture must preserve the production redirect artifact');
	} finally {
		delete process.env.PLAYWRIGHT_PORT;
		delete process.env.PLAYWRIGHT_FRAMESCAPER_PORT;
	}
});

test('the dual-origin Playwright harness serves two reciprocal built Pages sites', async () => {
	delete process.env.CI;
	delete process.env.PLAYWRIGHT_DUAL_ORIGIN_OUTPUT_DIR;
	const [{ default: config }, packageText, buildScript] = await Promise.all([
		import('../playwright.dual-origin.config.mjs?dual-origin-sites'),
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/build-dual-origin-browser-sites.mjs', import.meta.url), 'utf8'),
	]);
	const packageDocument = JSON.parse(packageText);
	const scripts = packageDocument.scripts;

	assert.equal(config.testDir, './tests/browser/dual-origin');
	assert.equal(config.fullyParallel, false);
	assert.equal(config.workers, 1);
	assert.equal(config.retries, 0);
	assert.equal(config.use.baseURL, 'http://127.0.0.1:4332');
	assert.equal(config.use.serviceWorkers, 'block');
	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium']);
	assert.equal(config.outputDir, 'test-results/dual-origin');
	assert.ok(Array.isArray(config.webServer));
	assert.equal(config.webServer.length, 2);

	const [soundscaper, framescaper] = config.webServer;
	assert.equal(soundscaper.url, 'http://127.0.0.1:4332/transfer/send/');
	assert.equal(framescaper.url, 'http://127.0.0.1:4333/transfer/receive/');
	for (const [server, product, port] of [
		[soundscaper, 'soundscaper', '4332'],
		[framescaper, 'framescaper', '4333'],
	]) {
		assert.match(server.command, /^node node_modules\/wrangler\/bin\/wrangler\.js pages dev /u);
		assert.ok(server.command.includes(`.wrangler/dual-origin-browser/${product}`));
		assert.ok(server.command.includes(`--port ${port}`));
		assert.ok(server.command.includes(`--persist-to .wrangler/dual-origin-browser/state/${product}`));
		assert.ok(server.command.includes('--show-interactive-dev-session=false'));
		assert.equal(server.reuseExistingServer, false);
	}

	assert.equal(scripts['pretest:browser:dual-origin'], 'node scripts/build-dual-origin-browser-sites.mjs');
	assert.equal(scripts['test:browser:dual-origin'],
		'playwright test --config playwright.dual-origin.config.mjs');
	assert.equal(packageDocument.devDependencies.wrangler, '4.114.0');
	assert.match(buildScript, /SCAPE_PRODUCT: 'soundscaper'/u);
	assert.match(buildScript, /SOUNDSCAPER_SITE: 'http:\/\/127\.0\.0\.1:4332'/u);
	assert.match(buildScript, /PUBLIC_TRANSFER_PEER_ORIGIN: 'http:\/\/127\.0\.0\.1:4333'/u);
	assert.match(buildScript, /SCAPE_PRODUCT: 'framescaper'/u);
	assert.match(buildScript, /FRAMESCAPER_SITE: 'http:\/\/127\.0\.0\.1:4333'/u);
	assert.match(buildScript, /PUBLIC_TRANSFER_PEER_ORIGIN: 'http:\/\/127\.0\.0\.1:4332'/u);
});

test('each site-verifying workflow runs the dual-origin proof exactly once', async () => {
	for (const workflowName of ['quality.yml', 'desktop-preview.yml']) {
		const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
		const browserJob = extractJob(workflow, 'browser');
		assert.equal(
			workflow.match(/npm run test:browser:dual-origin/gu)?.length,
			1,
			`${workflowName} must invoke the dual-origin proof once`,
		);
		assert.match(browserJob,
			/if: matrix\.project == 'chromium' && matrix\.shard == 1\n\s+run: npm run test:browser:dual-origin/u);
	}
});

test('each site-verifying workflow publishes and consumes a verified Framescaper browser build', async () => {
	for (const workflowName of ['quality.yml', 'desktop-preview.yml']) {
		const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
		const qualityJob = extractJob(workflow, 'quality');
		const browserJob = extractJob(workflow, 'browser');
		const firefoxJob = extractJob(workflow, 'firefox');
		const buildIndex = qualityJob.indexOf('run: npm run build:browser:framescaper');
		const uploadIndex = qualityJob.indexOf('name: verified-framescaper-site-build');
		assert.ok(buildIndex >= 0, `${workflowName} must build the Framescaper site once in quality`);
		assert.ok(uploadIndex > buildIndex,
			`${workflowName} must upload Framescaper only after its build verifies successfully`);
		assert.match(qualityJob,
			/name: verified-framescaper-site-build\n\s+path: \.wrangler\/browser-products\/framescaper\/\n\s+include-hidden-files: true/u);
		for (const [job, label] of [[browserJob, 'browser'], [firefoxJob, 'firefox']]) {
			assert.match(job,
				/name: verified-framescaper-site-build\n\s+path: \.wrangler\/browser-products\/framescaper/u,
				`${workflowName} ${label} must download the verified Framescaper build`);
		}
	}
});

test('desktop verification isolates browser engines and tests packages with every engine', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assertBrowserCoverage(workflow, 'desktop');
	for (const jobName of ['package', 'package-with-tests', 'soundscaper-project-library-lease-matrix']) {
		// Packaging waits on the sharded Node suite and the merged coverage gate too:
		// a package built off unverified source is worse than no package.
		assert.match(extractJob(workflow, jobName), /needs: \[quality, tests, coverage, browser, firefox\]/u);
	}
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
});

test('quality verification keeps Chromium and WebKit in the pinned container and gives Firefox real audio', async () => {
	const workflow = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
	assertBrowserCoverage(workflow, 'quality');
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

function assertBrowserCoverage(workflow, label) {
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
	const handbookLegs = [...browserJob.matchAll(
		/^\s+if: (?<condition>matrix\.project == 'chromium'.*)\n\s+run: npm run test:docs:browser$/gmu,
	)];
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
		`${label} must probe the real audio clock before Firefox verification`,
	);
}

/**
 * Playwright is the pipeline's long pole, so every engine is split across
 * runners with `--shard`. Three things have to agree for that gate to be meaningful:
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
