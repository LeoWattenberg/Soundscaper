/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { resolveBrowserProductBaseURL, scopedBrowserCoverageEnvironment } from './browser/helpers/browser-product-base-url.ts';

test('ordinary Motion UI files navigate their own product without changing other specs', () => {
	for (const file of ['motionscaper-shell.spec.js', 'motionscaper-opaque-archive.spec.ts', 'motionscaper-documents.spec.js']) {
		assert.equal(resolveBrowserProductBaseURL({ file: `/repo/tests/browser/${file}`, baseURL: 'http://127.0.0.1:4322', environment: {} }), 'http://127.0.0.1:4324');
	}
	assert.equal(resolveBrowserProductBaseURL({ file: 'audio-editor-project.spec.js', baseURL: 'http://127.0.0.1:4322', environment: {} }), 'http://127.0.0.1:4322');
	assert.equal(resolveBrowserProductBaseURL({ file: 'motionscaper-shell.spec.js', baseURL: 'http://127.0.0.1:4500', environment: { PLAYWRIGHT_PORT: '4500', PLAYWRIGHT_MOTIONSCAPER_PORT: '4508' } }), 'http://127.0.0.1:4508');
});

test('explicit custom sites and independently configured base URLs retain route authority', () => {
	for (const baseURL of ['http://127.0.0.1:4345', 'http://127.0.0.1:4335', 'https://example.invalid/editor/', undefined]) {
		assert.equal(resolveBrowserProductBaseURL({ file: 'motionscaper-successor-shell.spec.ts', baseURL, environment: {} }), baseURL);
	}
	assert.equal(resolveBrowserProductBaseURL({ file: 'motionscaper-linked-native-menu.spec.ts', baseURL: 'http://127.0.0.1:4322', customSites: true, environment: {} }), 'http://127.0.0.1:4322');
	assert.equal(resolveBrowserProductBaseURL({ file: 'motionscaper-shell.spec.js', baseURL: 'http://127.0.0.1:4322', environment: { SCAPE_BROWSER_COVERAGE_SITES: 'custom declared sites' } }), 'http://127.0.0.1:4322');
});

test('built Motion UI specs use the shared collector while isolated bundles remain explicitly scoped', async () => {
	const root = new URL('./browser/', import.meta.url);
	const isolated: string[] = [];
	for (const file of (await readdir(root)).filter(name => /^motionscaper.*\.spec\.(?:js|ts)$/u.test(name))) {
		const source = await readFile(new URL(file, root), 'utf8');
		if (!/import\s+\{[^}]*\btest\b[^}]*\}\s+from '@playwright\/test'/u.test(source)) continue;
		assert.match(source, /from '(?:vite|esbuild)'/u, `${file} must record real product UI through the shared fixture`);
		isolated.push(file);
	}
	assert.deepEqual(isolated.sort(), [
		'motionscaper-audio-preview.spec.ts', 'motionscaper-linear-webgl.spec.ts', 'motionscaper-link-bridge.spec.ts',
		'motionscaper-link-storage.spec.ts', 'motionscaper-media-provider.spec.ts', 'motionscaper-preview-worker.spec.ts',
		'motionscaper-project-release.spec.ts', 'motionscaper-successor-portable.spec.ts', 'motionscaper-successor-thumbnails.spec.ts',
		'motionscaper-video-delivery.spec.ts',
	]);
	const fixture = await readFile(new URL('./browser/helpers/browser-coverage-fixture.js', import.meta.url), 'utf8');
	assert.match(fixture, /baseURL: async \(\{ baseURL, browserCoverageSites \}, use, testInfo\)/u);
	assert.match(fixture, /file: testInfo\.file/u);
	assert.match(fixture, /customSites: browserCoverageSites !== null/u);
});

test('dedicated successor suites stay out of ordinary selection and retain authenticated custom sites', async () => {
	const { default: ordinary } = await import('../playwright.config.mjs');
	const { default: links } = await import('../playwright.motionscaper-links.config.mjs');
	assert.ok(ordinary.projects); assert.ok(Array.isArray(ordinary.webServer));
	assert.ok(Array.isArray(ordinary.testIgnore)); assert.ok(Array.isArray(links.testMatch)); assert.ok(links.use);
	assert.deepEqual(ordinary.projects.map(project => project.name), ['chromium', 'firefox', 'webkit']);
	assert.equal(ordinary.webServer.length, 3);
	for (const pattern of links.testMatch) assert.ok(ordinary.testIgnore.includes(pattern), String(pattern));
	assert.deepEqual(links.testMatch, [
		'**/motionscaper-linked-editors.spec.ts', '**/motionscaper-linked-native-menu.spec.ts', '**/motionscaper-linked-mixed-preview.spec.ts',
		'**/motionscaper-successor-native-cleanup.spec.ts', '**/motionscaper-successor-opaque-archive.spec.ts', '**/motionscaper-successor-shell.spec.ts',
	]);
	assert.deepEqual(links.use.browserCoverageSites.map((site: { productId: string; origin: string }) => site.productId), ['framescaper', 'motionscaper']);
	assert.equal(links.use.baseURL, links.use.browserCoverageSites[0].origin);
});

test('portable nightly Motion navigation uses only its launcher-declared site and preserves custom successor routes', () => {
	const environment = {
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: '/payload', SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://127.0.0.1:4500',
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({ soundscaper: 'http://127.0.0.1:4500', motionscaper: 'http://127.0.0.1:4502' }),
		SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{ productId: 'motionscaper', origin: 'http://127.0.0.1:4502' }]),
	};
	const options = { file: 'motionscaper-documents.spec.js', baseURL: environment.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL, environment };
	assert.equal(resolveBrowserProductBaseURL(options), 'http://127.0.0.1:4502');
	assert.equal(resolveBrowserProductBaseURL({ ...options, customSites: true }), options.baseURL);
	assert.equal(resolveBrowserProductBaseURL({ ...options, file: 'audio-editor.spec.js' }), options.baseURL);
	assert.equal(resolveBrowserProductBaseURL({ ...options, baseURL: 'http://127.0.0.1:4345' }), 'http://127.0.0.1:4345');
	assert.throws(() => resolveBrowserProductBaseURL({ ...options, environment: { ...environment, SCAPE_BROWSER_COVERAGE_SITES: '[]' } }), /declared product/u);
	assert.throws(() => resolveBrowserProductBaseURL({ ...options, environment: { ...environment, SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: '{"motionscaper":"http://127.0.0.1:4503"}' } }), /declared product/u);
});

test('portable scoped coverage retains the fixture origin without mutating the ordinary launcher environment', () => {
	const environment = { SCAPE_BROWSER_COVERAGE_SITES: '[{"origin":"http://127.0.0.1:4500"}]', SCAPE_BROWSER_COVERAGE: '1' };
	const sites = [{ productId: 'motionscaper', origin: 'http://127.0.0.1:4987', outputDirectory: '/run/retained/motionscaper' }];
	assert.equal(scopedBrowserCoverageEnvironment(null, environment), environment);
	assert.equal(scopedBrowserCoverageEnvironment(sites, {}).SCAPE_BROWSER_COVERAGE_SITES, undefined, 'ordinary collection remains in source-map mode');
	assert.deepEqual(scopedBrowserCoverageEnvironment(sites, environment), { ...environment, SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify(sites) });
	assert.equal(environment.SCAPE_BROWSER_COVERAGE_SITES, '[{"origin":"http://127.0.0.1:4500"}]');
});
