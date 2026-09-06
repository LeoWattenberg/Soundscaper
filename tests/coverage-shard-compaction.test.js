/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import { browserCoverageProfile } from '../scripts/lib/browser-coverage-profile.mjs';
import { compactV8Coverage, coverageUrlFilter } from '../scripts/lib/v8-coverage-compaction.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const C8 = resolve(REPOSITORY_ROOT, 'node_modules/.bin/c8');
const workspaces = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('compaction drops everything the report can never be about', () => {
	const root = makeWorkspace();
	const keep = coverageUrlFilter(root);

	assert.equal(keep(`${pathToFileURL(root).href}/src/kept.ts`), true);
	assert.equal(keep(`${pathToFileURL(root).href}/node_modules/pkg/index.js`), false);
	assert.equal(keep('node:internal/modules/esm/loader'), false);
	assert.equal(keep(`${pathToFileURL(tmpdir()).href}/elsewhere/other.ts`), false);
});

test('compaction sums the ranges every process recorded for the same script', () => {
	const root = makeWorkspace();
	const temporaryDirectory = join(root, 'v8');
	mkdirSync(temporaryDirectory);
	const scriptUrl = `${pathToFileURL(root).href}/src/shared.ts`;
	const sourceMap = { lineLengths: [10], data: { version: 3 }, url: scriptUrl };

	writeProfile(temporaryDirectory, 'first.json', {
		result: [
			profileFor(scriptUrl, [{ startOffset: 0, endOffset: 100, count: 2 }]),
			profileFor('node:internal/bootstrap', [{ startOffset: 0, endOffset: 10, count: 9 }]),
		],
		'source-map-cache': { [scriptUrl]: sourceMap, 'node:internal/bootstrap': sourceMap },
	});
	writeProfile(temporaryDirectory, 'second.json', {
		result: [profileFor(scriptUrl, [{ startOffset: 0, endOffset: 100, count: 3 }])],
		'source-map-cache': { [scriptUrl]: sourceMap },
	});

	const compacted = compactV8Coverage(temporaryDirectory, root);

	assert.deepEqual(compacted.result.map(({ url }) => url), [scriptUrl]);
	assert.equal(compacted.result[0].functions[0].ranges[0].count, 5, 'the two processes must add up');
	assert.deepEqual(Object.keys(compacted['source-map-cache']), [scriptUrl]);
});

test('a partially written profile does not take the whole shard down with it', () => {
	const root = makeWorkspace();
	const temporaryDirectory = join(root, 'v8');
	mkdirSync(temporaryDirectory);
	const scriptUrl = `${pathToFileURL(root).href}/src/shared.ts`;
	writeProfile(temporaryDirectory, 'good.json', {
		result: [profileFor(scriptUrl, [{ startOffset: 0, endOffset: 100, count: 1 }])],
	});
	writeFileSync(join(temporaryDirectory, 'truncated.json'), '{"result":[{"url"');

	assert.deepEqual(compactV8Coverage(temporaryDirectory, root).result.map(({ url }) => url), [scriptUrl]);
});

test('a compacted shard reports exactly what its raw profiles report', () => {
	const root = makeWorkspace();
	mkdirSync(join(root, 'src'));
	writeFileSync(join(root, 'src/measured.mjs'), MEASURED_MODULE);
	// Each entry point also measures a child process, so the fixture exercises the
	// cross-process merge a shard actually performs rather than a single profile.
	writeFileSync(join(root, 'child.mjs'), ENTRY_POINT('0'));
	writeFileSync(join(root, 'left.mjs'), `${ENTRY_POINT('1')}${SPAWN_CHILD}`);
	writeFileSync(join(root, 'right.mjs'), `${ENTRY_POINT('-1')}${SPAWN_CHILD}`);

	const raw = join(root, 'raw');
	mkdirSync(raw);
	const shards = join(root, 'shards');
	mkdirSync(shards);
	for (const entry of ['left', 'right']) {
		const temporaryDirectory = join(root, `v8-${entry}`);
		execFileSync(process.execPath, [join(root, `${entry}.mjs`)], {
			cwd: root,
			env: { ...process.env, NODE_V8_COVERAGE: temporaryDirectory },
		});
		for (const name of readdirSync(temporaryDirectory)) {
			cpSync(join(temporaryDirectory, name), join(raw, `${entry}-${name}`));
		}
		writeFileSync(join(shards, `${entry}.json`), JSON.stringify(compactV8Coverage(temporaryDirectory, root)));
	}

	assert.deepEqual(summarize(root, shards), summarize(root, raw));
	assert.ok(summarize(root, raw).lines.covered > 0, 'the fixture must actually record coverage');
});

const ENTRY_POINT = (argument) =>
	`import { classify } from './src/measured.mjs';\nclassify(${argument});\n`;
const SPAWN_CHILD = [
	"import { execFileSync } from 'node:child_process';",
	"execFileSync(process.execPath, ['child.mjs'], { cwd: import.meta.dirname });",
	'',
].join('\n');

test('the merged coverage gate refuses to score a shard that never reported', () => {
	const root = makeWorkspace();
	const shards = join(root, 'shards');
	mkdirSync(shards);
	writeFileSync(join(shards, 'common.json'), '{"result":[]}');

	const outcome = spawnSync(process.execPath, [
		resolve(REPOSITORY_ROOT, 'scripts/check-shard-coverage.mjs'),
		shards,
	], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });

	assert.equal(outcome.status, 1, 'a missing shard must fail the gate rather than score what did arrive');
	assert.match(outcome.stderr, /missing usable coverage for: framescaper, soundscaper/u);
});

// A Chromium shard records the bundled chunk the page actually ran, not the
// sources it was built from, so the whole chain has to hold for a browser
// profile to be worth anything: compaction has to keep an entry addressed by a
// built file, and the report has to put its ranges back on `src/`. The gate
// passes `--exclude-after-remap` for exactly this, because the chunk's own path
// is not one any include pattern names.
test('a browser shard reports on the sources its bundled chunk was built from', () => {
	const root = makeWorkspace();
	mkdirSync(join(root, 'src'));
	writeFileSync(join(root, 'src/measured.mjs'), MEASURED_MODULE);
	const chunkPath = join(root, 'built/assets/app-abc123.js');
	mkdirSync(join(root, 'built/assets'), { recursive: true });
	const chunk = `${BUNDLER_BANNER}${MEASURED_MODULE}`;
	writeFileSync(chunkPath, chunk);

	const temporaryDirectory = join(root, 'v8-browser');
	mkdirSync(temporaryDirectory);
	writeProfile(temporaryDirectory, 'one-test.json', browserCoverageProfile(
		[{
			url: 'http://127.0.0.1:4322/assets/app-abc123.js',
			scriptId: '1',
			source: chunk,
			// Everything after the banner ran once, which is every line of the
			// module the chunk was built from.
			functions: [{
				functionName: '',
				isBlockCoverage: true,
				ranges: [{ startOffset: BUNDLER_BANNER.length, endOffset: chunk.length, count: 1 }],
			}],
		}],
		() => ({ path: chunkPath, sourceMap: bundledSourceMap(root) }),
	));

	const shards = join(root, 'shards');
	mkdirSync(shards);
	writeFileSync(join(shards, 'browser-chromium-1.json'), JSON.stringify(compactV8Coverage(temporaryDirectory, root)));

	const summary = report(root, shards, ['--exclude-after-remap']);
	assert.deepEqual(
		Object.keys(summary).filter((path) => path !== 'total'),
		[join(root, 'src/measured.mjs')],
		'the built chunk must never be reported as a file of its own',
	);
	assert.equal(summary.total.lines.covered, summary.total.lines.total);
	assert.ok(summary.total.lines.total > 0, 'the fixture must actually record coverage');
});

const BUNDLER_BANNER = '/* bundled */\n';

// One generated line per source line, offset by the banner. Each segment is
// base64 VLQ: `AAAA` is (column 0, source 0, line 0, column 0) and `AACA` the
// same with the source line advanced by one.
function bundledSourceMap(root) {
	const sourceLines = MEASURED_MODULE.replace(/\n$/u, '').split('\n');
	return {
		version: 3,
		sources: [pathToFileURL(join(root, 'src/measured.mjs')).href],
		sourcesContent: [MEASURED_MODULE],
		names: [],
		mappings: ['', 'AAAA', ...sourceLines.slice(1).map(() => 'AACA')].join(';'),
	};
}

const MEASURED_MODULE = [
	'export function classify(value) {',
	'\tif (value > 0) return "positive";',
	'\tif (value < 0) return "negative";',
	'\treturn "zero";',
	'}',
	'',
].join('\n');

function summarize(root, temporaryDirectory, extraArguments) {
	return report(root, temporaryDirectory, extraArguments).total;
}

function report(root, temporaryDirectory, extraArguments = ['--merge-async']) {
	const reportDirectory = join(root, `report-${temporaryDirectory.split('/').pop()}`);
	execFileSync(C8, [
		'report',
		`--temp-directory=${temporaryDirectory}`,
		`--report-dir=${reportDirectory}`,
		...extraArguments,
		'--reporter=json-summary',
		'--all',
		'--include=src/**/*.mjs',
	], { cwd: root });
	return JSON.parse(readFileSync(join(reportDirectory, 'coverage-summary.json'), 'utf8'));
}

function profileFor(url, ranges) {
	return { scriptId: '1', url, functions: [{ functionName: '', isBlockCoverage: true, ranges }] };
}

function writeProfile(directory, name, profile) {
	writeFileSync(join(directory, name), JSON.stringify(profile));
}

function makeWorkspace() {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-coverage-shard-'));
	workspaces.push(workspace);
	return workspace;
}
