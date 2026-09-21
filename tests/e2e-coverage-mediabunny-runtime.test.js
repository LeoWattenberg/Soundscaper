/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	makeFixture,
	readJson,
	recordBrowserEvidence,
	v8Entry,
	write,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

const WORKER_FUNCTION = `()=>{
	const timeouts = new Map();
	const intervals = new Map();
	self.onmessage = (event) => {
		const message = event.data;
		switch (message.type) {
			case 'set-timeout': timeouts.set(message.timerId, setTimeout(() => {
				timeouts.delete(message.timerId);
				self.postMessage({ type: 'fire', timerId: message.timerId });
			}, message.delay)); break;
			case 'set-interval': intervals.set(message.timerId, setInterval(() => {
				self.postMessage({ type: 'fire', timerId: message.timerId });
			}, message.delay)); break;
			case 'clear-timeout': clearTimeout(timeouts.get(message.timerId)); break;
			case 'clear-interval': clearInterval(intervals.get(message.timerId)); break;
		}
	};
}`;
const WORKER_SOURCE = `(${WORKER_FUNCTION})();`;
const VENDOR_CHUNK = `const timerWorker = ${WORKER_FUNCTION};
export function timer() {
	const source = \`(\${timerWorker.toString()})();\`;
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	const worker = new Worker(url);
	URL.revokeObjectURL(url);
	return worker;
}
`;

after(cleanupE2ECoverageAssemblerFixtures);

test('browser and packaged profiles exclude only the exact attested Mediabunny Blob worker', () => {
	const fixture = makeFixture();
	installVendorEvidence(fixture);
	const browserUrl = 'blob:http://127.0.0.1:4322/timer-worker';
	addBrowserBlob(fixture, browserUrl, WORKER_SOURCE);
	const packagedUrl = 'blob:null/timer-worker';
	addPackagedBlob(fixture, packagedUrl, WORKER_SOURCE);

	const assembled = assembleE2ECoverageCapture(fixture);
	assert.equal(
		assembled.captureIndex.scripts.some(({ coverageUrl }) => coverageUrl.startsWith('blob:')),
		false,
		'third-party dynamic bytes stay outside the first-party denominator',
	);
	assert.equal(
		assembled.captureIndex.sources.some(({ path }) => path.includes('timer-worker')),
		false,
	);
});

test('browser assembly rejects spoofed bytes, a missing cache entry, and the wrong product origin', () => {
	for (const [mutate, expected] of [
		[({ profile, url }) => { profile['script-source-cache'][url] = `${WORKER_SOURCE} `; }, /unmapped first-party browser script blob:/iu],
		[({ profile, url }) => { delete profile['script-source-cache'][url]; }, /unmapped first-party browser script blob:/iu],
		[({ entry }) => { entry.url = 'blob:http://127.0.0.1:4323/timer-worker'; }, /captured source bytes without a V8 entry/iu],
	]) {
		const fixture = makeFixture();
		installVendorEvidence(fixture);
		const url = 'blob:http://127.0.0.1:4322/timer-worker';
		const { entry, profile, path } = addBrowserBlob(fixture, url, WORKER_SOURCE);
		mutate({ entry, profile, url });
		writeJson(path, profile);
		assert.throws(
			() => assembleE2ECoverageCapture(fixture),
			expected,
		);
	}
});

test('browser assembly rejects captured Blob bytes without a V8 entry', () => {
	const fixture = makeFixture();
	installVendorEvidence(fixture);
	const path = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(path);
	profile['script-source-cache']['blob:http://127.0.0.1:4322/unobserved'] = WORKER_SOURCE;
	writeJson(path, profile);

	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/captured source bytes without a V8 entry.*unobserved/iu,
	);
});

test('packaged assembly rejects a Blob source absent from browser and renderer evidence', () => {
	const fixture = makeFixture();
	installVendorEvidence(fixture);
	addPackagedBlob(fixture, 'blob:null/timer-worker', `${WORKER_SOURCE} `);

	assert.throws(
		() => assembleE2ECoverageCapture(fixture),
		/unmapped first-party packaged script blob:null/iu,
	);
});

function installVendorEvidence(fixture) {
	const browserRoot = join(fixture.evidenceRoot, 'browser/soundscaper');
	write(join(browserRoot, 'site/assets/vendor-mediabunny-fixture.js'), VENDOR_CHUNK);
	writeJson(join(browserRoot, 'source-maps/vendor-mediabunny-fixture.js.map'), {
		version: 3,
		file: 'vendor-mediabunny-fixture.js',
		sourceRoot: '',
		sources: ['file:///fixture/node_modules/mediabunny/dist/modules/src/misc.js'],
		names: [],
		mappings: Array.from({ length: VENDOR_CHUNK.split('\n').length }, () => 'AAAA').join(';'),
		x_soundscaper_source_sha256: [null],
	});
	recordBrowserEvidence(
		join(browserRoot, 'site'),
		'soundscaper',
		fixture.expectedRevision,
	);
}

function addBrowserBlob(fixture, url, source) {
	const path = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const profile = readJson(path);
	const entry = v8Entry(url);
	profile.result.push(entry);
	profile['script-source-cache'][url] = source;
	writeJson(path, profile);
	return { entry, path, profile };
}

function addPackagedBlob(fixture, url, source) {
	const path = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
	const profile = readJson(path);
	profile.result.push(v8Entry(url));
	profile['script-source-cache'][url] = source;
	writeJson(path, profile);
}
