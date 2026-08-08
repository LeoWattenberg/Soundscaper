/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WINLDD_MIT_NOTICE = `MIT License

Copyright (c) 2020 Julien Waechter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

test('nightly-with-tests notices pin the shipped test tools and browser revisions', async () => {
	const [lock, browsers, notices, winlddNotice, attributes] = await Promise.all([
		readJson(new URL('../package-lock.json', import.meta.url)),
		readJson(new URL('../node_modules/playwright-core/browsers.json', import.meta.url)),
		readFile(new URL('../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8'),
		readFile(new URL('../LICENSES/Playwright-winldd-MIT.txt', import.meta.url), 'utf8'),
		readFile(new URL('../.gitattributes', import.meta.url), 'utf8'),
	]);

	for (const dependency of [
		'@axe-core/playwright',
		'@playwright/test',
		'axe-core',
		'playwright',
		'playwright-core',
	]) {
		const version = lock.packages[`node_modules/${dependency}`]?.version;
		assert.ok(version, `${dependency} must have a lockfile version`);
		assert.ok(notices.includes(`\`${dependency}\` ${version}`), `${dependency} notice is missing`);
	}

	for (const browserName of ['chromium', 'firefox', 'webkit']) {
		const browser = browsers.browsers.find(({ name }) => name === browserName);
		assert.ok(browser, `${browserName} must be pinned by Playwright`);
		assert.ok(
			notices.includes(`${browser.title} ${browser.browserVersion} (Playwright revision ${browser.revision})`),
			`${browserName} browser notice is missing`,
		);
	}
	const winldd = browsers.browsers.find(({ name }) => name === 'winldd');
	assert.ok(winldd, 'winldd must be pinned by Playwright');
	assert.match(
		notices,
		new RegExp(`WinLDD[\\s\\S]*PrintDeps\\.exe[\\s\\S]*revision ${winldd.revision}[\\s\\S]*MIT[\\s\\S]*Julien Waechter`, 'u'),
	);
	assert.ok(
		notices.includes('https://github.com/microsoft/playwright/blob/v1.61.1/browser_patches/winldd/PrintDeps.cpp'),
		'winldd notice must pin its exact upstream source',
	);
	assert.ok(
		notices.includes('[`LICENSES/Playwright-winldd-MIT.txt`](LICENSES/Playwright-winldd-MIT.txt)'),
		'winldd notice must link its bundled MIT terms',
	);
	assert.equal(winlddNotice, WINLDD_MIT_NOTICE);
	assert.match(attributes, /^\/LICENSES\/Playwright-winldd-MIT\.txt text eol=lf$/mu);
	assert.match(notices, /nightly-with-tests.*diagnostic.*not.*public release/isu);
});

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}
