/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	isBrowserMediabunnyBlobCoverage,
	isPackagedMediabunnyBlobCoverage,
	mediabunnyBlobWorkerSources,
	rendererMediabunnyBlobWorkerSources,
} from '../scripts/lib/e2e-mediabunny-dynamic-coverage.mjs';
import { mappedE2ESourceAt } from '../scripts/lib/e2e-coverage-source-maps.mjs';

const EXTERNAL = 'file:///__soundscaper_external__/node_modules/mediabunny/dist/modules/src/';
const TIMER_WORKER = `()=>{
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
const TIMER_SOURCE = `(${TIMER_WORKER})();`;
const TIMER_CHUNK = `const timerWorker = ${TIMER_WORKER};
export function timer() {
	const source = \`(\${timerWorker.toString()})();\`;
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	const worker = new Worker(url);
	URL.revokeObjectURL(url);
	return worker;
}
`;

test('the pinned Mediabunny bundle yields exactly its four closed Blob worker recipes', () => {
	const scripts = ['misc.js', 'media-sink.js', 'media-source.js'].map((name) => {
		const source = readFileSync(new URL(
			`../node_modules/mediabunny/dist/modules/src/${name}`,
			import.meta.url,
		), 'utf8');
		return descriptor(source, [name], name);
	});
	const sources = mediabunnyBlobWorkerSources(scripts, 'pinned Mediabunny fixture');

	assert.equal(sources.length, 4);
	assert.equal(new Set(sources).size, 4);
	assert.ok(sources.every((worker) => worker.startsWith('(') && /\)\(\);?$/u.test(worker)));
});

test('a mixed first-party decoy cannot borrow chunk-wide Mediabunny provenance', () => {
	const source = `const vendorMarker = true;\n${TIMER_CHUNK}`;
	const lines = source.split('\n').length;
	assert.throws(
		() => mediabunnyBlobWorkerSources([descriptor(
			source,
			['misc.js', 'file:///__soundscaper_repo__/src/decoy.ts'],
			'decoy.js',
			['AAAA', 'ACAA', ...Array.from({ length: lines - 2 }, () => 'AAAA')].join(';'),
		)]),
		/no matching mapped provenance/iu,
	);
});

test('first-party mappings inside a vendor worker function invalidate the recipe', () => {
	const worker = TIMER_WORKER.replace('\n}', '\n\tglobalThis.exfiltrateSecrets();\n}');
	const source = TIMER_CHUNK.replace(TIMER_WORKER, worker);
	const lines = source.split('\n');
	const injectedLine = lines.findIndex((line) => line.includes('exfiltrateSecrets'));
	const mappings = lines.map((_, index) => {
		if (index === injectedLine) return 'ACAA';
		if (index === injectedLine + 1) return 'ADAA';
		return 'AAAA';
	}).join(';');
	assert.throws(
		() => mediabunnyBlobWorkerSources([descriptor(
			source,
			['misc.js', 'file:///__soundscaper_repo__/src/evil.ts'],
			'injected.js',
			mappings,
		)]),
		/no matching mapped provenance/iu,
	);
});

test('an unmapped executable line inside a vendor worker invalidates the recipe', () => {
	const worker = TIMER_WORKER.replace('\n}', '\n\tglobalThis.exfiltrateSecrets();\n}');
	const source = TIMER_CHUNK.replace(TIMER_WORKER, worker);
	const mappings = source.split('\n').map((line) => (
		line.includes('exfiltrateSecrets') ? '' : 'AAAA'
	)).join(';');
	assert.throws(
		() => mediabunnyBlobWorkerSources([descriptor(source, ['misc.js'], 'unmapped.js', mappings)]),
		/no matching mapped provenance/iu,
	);
});

test('an unmapped source-map segment ends the preceding provenance range', () => {
	const map = { mappings: 'AAAA,K', sources: [`${EXTERNAL}misc.js`] };
	assert.deepEqual(mappedE2ESourceAt(map, 0, 4), { index: 0, source: `${EXTERNAL}misc.js` });
	assert.equal(mappedE2ESourceAt(map, 0, 5), null);
});

test('an unknown fifth Function-to-string worker fails closed', () => {
	const source = `const unknownWorker = () => { self.postMessage('unknown'); };
export function unknown() {
	const source = \`(\${unknownWorker.toString()})()\`;
	const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
	return new Worker(url);
}
`;
	assert.throws(
		() => mediabunnyBlobWorkerSources([descriptor(source, ['misc.js'])]),
		/unattested Mediabunny Blob worker recipe/iu,
	);
});

test('the timer recipe is admitted only with exact provenance, function, callsite and MIME', () => {
	assert.deepEqual(mediabunnyBlobWorkerSources([
		descriptor(TIMER_CHUNK, ['misc.js']),
	]), [TIMER_SOURCE]);
	assert.throws(
		() => mediabunnyBlobWorkerSources([descriptor(TIMER_CHUNK, ['media-source.js'])]),
		/no matching mapped provenance/iu,
	);

	for (const [label, source] of [
		['function', TIMER_CHUNK.replace("'set-interval'", "'set-repeating'")],
		['callsite', TIMER_CHUNK.replace('\tURL.revokeObjectURL(url);\n', '')],
		['MIME', TIMER_CHUNK.replace('text/javascript', 'application/javascript')],
	] as const) {
		assert.throws(
			() => mediabunnyBlobWorkerSources([descriptor(source, ['misc.js'])], label),
			/unattested Mediabunny Blob worker recipe/iu,
		);
	}
});

test('each emitted recipe identity is unique within one product build', () => {
	assert.throws(
		() => mediabunnyBlobWorkerSources([
			descriptor(TIMER_CHUNK, ['misc.js'], 'one.js'),
			descriptor(TIMER_CHUNK, ['misc.js'], 'two.js'),
		]),
		/duplicate Mediabunny unthrottled-timer-v1 recipe/iu,
	);
});

test('packaged renderer evidence cannot borrow a recipe from main or preload', () => {
	const main = { ...descriptor(TIMER_CHUNK, ['misc.js']), realm: 'main' };
	const preload = { ...descriptor(TIMER_CHUNK, ['misc.js']), realm: 'preload' };
	assert.deepEqual(rendererMediabunnyBlobWorkerSources([main, preload]), []);
	assert.deepEqual(rendererMediabunnyBlobWorkerSources([
		main,
		{ ...descriptor(TIMER_CHUNK, ['misc.js']), realm: 'renderer' },
	]), [TIMER_SOURCE]);
});

test('browser admission binds exact source bytes to the Blob origin product', () => {
	const url = 'blob:http://127.0.0.1:4322/worker';
	const evidence = evidenceFixture([TIMER_SOURCE], []);
	assert.equal(isBrowserMediabunnyBlobCoverage({
		entry: { url }, evidence, profile: profileFixture(url, TIMER_SOURCE),
	}), true);
	assert.equal(isBrowserMediabunnyBlobCoverage({
		entry: { url: 'blob:http://127.0.0.1:4323/worker' },
		evidence,
		profile: profileFixture('blob:http://127.0.0.1:4323/worker', TIMER_SOURCE),
	}), false, 'another product origin cannot borrow Soundscaper evidence');
	assert.equal(isBrowserMediabunnyBlobCoverage({
		entry: { url }, evidence, profile: profileFixture(url, `${TIMER_SOURCE} `),
	}), false, 'a one-byte source spoof is not admitted');
	assert.equal(isBrowserMediabunnyBlobCoverage({ entry: { url }, evidence, profile: profileFixture() }), false);
});

test('packaged admission accepts exact browser or renderer evidence for only its product', () => {
	const browserSource = TIMER_SOURCE;
	const rendererSource = TIMER_SOURCE.replace('const timeouts', 'const timeoutHandles');
	const evidence = evidenceFixture([browserSource], [rendererSource]);
	for (const source of [browserSource, rendererSource]) {
		const url = 'blob:null/worker';
		assert.equal(isPackagedMediabunnyBlobCoverage({
			entry: { url }, evidence, productId: 'soundscaper', profile: profileFixture(url, source),
		}), true);
	}
	assert.equal(isPackagedMediabunnyBlobCoverage({
		entry: { url: 'blob:null/worker' },
		evidence,
		productId: 'framescaper',
		profile: profileFixture('blob:null/worker', browserSource),
	}), false);
});

function descriptor(
	source: string,
	mapped: string[],
	artifactPath = 'vendor-mediabunny.js',
	mappings = Array.from({ length: source.split('\n').length }, () => 'AAAA').join(';'),
) {
	return {
		artifactPath,
		source,
		fullSourceMap: {
			version: 3,
			sources: mapped.map((path) => path.startsWith('file:') ? path : `${EXTERNAL}${path}`),
			mappings,
		},
	};
}

function evidenceFixture(browserSources: string[], electronSources: string[]) {
	return {
		browser: new Map([
			['soundscaper', { origin: 'http://127.0.0.1:4322', mediabunnyBlobWorkerSources: browserSources }],
			['framescaper', { origin: 'http://127.0.0.1:4323', mediabunnyBlobWorkerSources: [] }],
		]),
		electron: new Map([
			['soundscaper', { mediabunnyBlobWorkerSources: electronSources }],
			['framescaper', { mediabunnyBlobWorkerSources: [] }],
		]),
	};
}

function profileFixture(url?: string, source?: string) {
	return { 'script-source-cache': url === undefined ? {} : { [url]: source } };
}
