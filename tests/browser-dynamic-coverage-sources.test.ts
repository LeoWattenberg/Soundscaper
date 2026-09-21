/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { browserCoverageProfile } from '../scripts/lib/browser-coverage-profile.mjs';
import { isBrowserInternalCdpScript } from '../scripts/lib/cdp-javascript-coverage.mjs';
import {
	needsCapturedBrowserSource,
	retainedBrowserDynamicCoverageScript,
	validateBrowserSourceCache,
} from '../scripts/lib/browser-dynamic-coverage-sources.mjs';

test('only the exact parser-authenticated Chromium error page bypasses dynamic capture', () => {
	const directories = new Map([['http://127.0.0.1:4322', '/build/soundscaper']]);
	const errorPage = 'chrome-error://chromewebdata/';
	assert.equal(isBrowserInternalCdpScript({ url: errorPage }), true);
	assert.equal(isBrowserInternalCdpScript({ hasSourceURL: true, url: errorPage }), false);
	assert.equal(isBrowserInternalCdpScript({ url: 'chrome-error://changed/' }), false);
	assert.equal(isBrowserInternalCdpScript({ url: 'about:blank' }), false);
	assert.equal(isBrowserInternalCdpScript({ url: 'about:srcdoc' }), false);
	assert.equal(needsCapturedBrowserSource(errorPage, directories), true);
	assert.equal(needsCapturedBrowserSource('soundscaper-unapproved://runtime.js', directories), true);
	assert.equal(needsCapturedBrowserSource('blob:http://127.0.0.1:4322/worker', directories), true);
});

test('a Blob program keeps exact bytes for final build-evidence authentication', () => {
	const url = 'blob:http://127.0.0.1:4322/vendor-worker';
	const source = 'self.postMessage("worker");';
	const profile = browserCoverageProfile([{
		url,
		scriptId: 'blob-worker',
		source,
		functions: [],
	}], retainedBrowserDynamicCoverageScript);

	assert.deepEqual(profile.result.map((entry) => entry.url), [url]);
	assert.equal(profile['script-source-cache'][url], source);
	assert.deepEqual(Object.keys(profile['source-map-cache']), []);
});

test('only Blob URLs enter the deferred dynamic-source path', () => {
	assert.equal(retainedBrowserDynamicCoverageScript('data:text/javascript,void 0', 'void 0'), null);
	assert.equal(retainedBrowserDynamicCoverageScript('soundscaper-other://runtime.js', 'void 0'), null);
	assert.throws(
		() => retainedBrowserDynamicCoverageScript('blob:http://127.0.0.1/missing', undefined),
		/captured no source bytes/iu,
	);
});

test('cached browser dynamic bytes must have a corresponding V8 entry', () => {
	const url = 'blob:http://127.0.0.1:4322/vendor-worker';
	const profile = {
		result: [{ functions: [], url }],
		'script-source-cache': { [url]: 'self.postMessage("worker");' },
	};
	assert.doesNotThrow(() => validateBrowserSourceCache(profile, 'fixture.json'));
	profile.result = [];
	assert.throws(
		() => validateBrowserSourceCache(profile, 'fixture.json'),
		/captured source bytes without a V8 entry/iu,
	);
});
