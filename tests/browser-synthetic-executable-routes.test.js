/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const BROWSER_SPECS = new URL('browser/', import.meta.url);
const COVERAGE_FIXTURE = /from\s+['"]\.\/(?:audio-editor-test-fixtures|helpers\/browser-coverage-fixture)\.js['"]/u;
const COVERAGE_OPTOUT = /test\.(?:extend|use)\(\{\s*browserCoverage:\s*false(?:\s*,|\s*\})/u;
const EXECUTABLE_MIME = /contentType:\s*['"](?:application|text)\/(?:ecmascript|javascript)(?:;[^'"]*)?['"]/gu;
const EXECUTABLE_SCRIPT_TAG = /<script\b(?![^>]*\btype\s*=\s*['"]importmap['"])[^>]*>/iu;
const EXECUTABLE_HTML_ATTRIBUTE = /<[^>]+\s(?:on[a-z]+|srcdoc)\s*=/iu;
const JAVASCRIPT_HTML_URL = /<[^>]+\s(?:href|src)\s*=\s*['"]javascript:/iu;
const LOCAL_IMPORT = /(?:\bfrom\s+|^\s*import\s+)['"](\.[^'"]+)['"]/gmu;

test('coverage-bearing browser specs opt out when they serve test-only executable code', async () => {
	const names = (await readdir(BROWSER_SPECS))
		.filter((name) => name.endsWith('.spec.js'))
		.sort();
	const violations = [];
	for (const name of names) {
		const url = new URL(name, BROWSER_SPECS);
		const source = await readFile(url, 'utf8');
		if (!COVERAGE_FIXTURE.test(source)) continue;
		assertDirectSyntheticTestsAreExcluded(name, source);
		assertStrictHarnessCallsAreExcluded(name, source);
		const executableSources = await sourceWithLocalBrowserHelpers(url, source);
		const executableMimes = [...executableSources.matchAll(EXECUTABLE_MIME)].length
			- authenticatedProductionRouteCount(name, source);
		const signals = [
			executableMimes > 0,
			EXECUTABLE_SCRIPT_TAG.test(executableSources),
			EXECUTABLE_HTML_ATTRIBUTE.test(executableSources),
			JAVASCRIPT_HTML_URL.test(executableSources),
		];
		if (signals.some(Boolean) && !hasCoverageOptOutBeforeTests(source)) violations.push(name);
	}
	assert.deepEqual(violations, [], [
		'Test-only executable routes cannot enter portable browser coverage.',
		'Add test.use({ browserCoverage: false }) to these specs:',
		...violations,
	].join('\n'));
});

async function sourceWithLocalBrowserHelpers(entryUrl, entrySource) {
	const pending = [{ source: entrySource, url: entryUrl }];
	const sources = [];
	const visited = new Set();
	while (pending.length > 0) {
		const { source, url } = pending.pop();
		if (visited.has(url.href)) continue;
		visited.add(url.href);
		sources.push(source);
		for (const match of source.matchAll(LOCAL_IMPORT)) {
			const dependency = new URL(match[1], url);
			if (!dependency.href.startsWith(BROWSER_SPECS.href)
				|| !dependency.pathname.endsWith('.js')) continue;
			pending.push({ source: await readFile(dependency, 'utf8'), url: dependency });
		}
	}
	return sources.join('\n');
}

function hasCoverageOptOutBeforeTests(source) {
	const optOutAt = source.search(COVERAGE_OPTOUT);
	const firstTestAt = source.search(/^test(?:\.describe)?\s*\(/mu);
	return optOutAt >= 0 && (firstTestAt < 0 || optOutAt < firstTestAt);
}

function assertDirectSyntheticTestsAreExcluded(name, source) {
	if (!source.includes('test.extend({ browserCoverage: false })')) return;
	const declarations = [...source.matchAll(/^\s*(test|syntheticRouteTest)\(['"]/gmu)];
	for (const [index, declaration] of declarations.entries()) {
		const end = declarations[index + 1]?.index ?? source.length;
		const body = source.slice(declaration.index, end);
		const executable = [...body.matchAll(EXECUTABLE_MIME)].length > 0
			|| EXECUTABLE_SCRIPT_TAG.test(body) || EXECUTABLE_HTML_ATTRIBUTE.test(body)
			|| JAVASCRIPT_HTML_URL.test(body);
		if (!executable) continue;
		assert.equal(declaration[1], 'syntheticRouteTest', `${name} serves synthetic code under coverage.`);
	}
}

function assertStrictHarnessCallsAreExcluded(name, source) {
	if (!source.includes('video-retime-preview-harness.js')
		|| !source.includes('strictModules: true')
		|| /test\.use\(\{\s*browserCoverage:\s*false/u.test(source)) return;
	const declarations = [...source.matchAll(/^\s*(test|syntheticRouteTest)\(['"]/gmu)];
	for (const [index, declaration] of declarations.entries()) {
		const end = declarations[index + 1]?.index ?? source.length;
		if (!source.slice(declaration.index, end).includes('strictModules: true')) continue;
		assert.equal(declaration[1], 'syntheticRouteTest', `${name} serves strict synthetic modules under coverage.`);
	}
}

function authenticatedProductionRouteCount(name, source) {
	if (name !== 'audio-editor-project-management-menu.spec.js') return 0;
	assert.match(source, /page\.route\('https:\/\/assets\.soundscaper\.org\/runtime\/ffmpeg\/0\.12\.10\/\*\*'/u);
	assert.match(source, /node_modules\/@ffmpeg\/core\/dist\/esm\/ffmpeg-core\.js/u);
	assert.match(source, /route\.fulfill\(\{\n\t\t\t\.\.\.descriptor,/u);
	assert.equal([...source.matchAll(EXECUTABLE_MIME)].length, 1);
	return 1;
}
