/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import {
	absoluteSourceMapSources,
	buildSourceMapsRequested,
	relocateBuildSourceMaps,
	relocateEmittedSourceMaps,
	sourceMapDirectoryFor,
} from '../scripts/lib/build-source-map-relocation.mjs';

const workspaces: string[] = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('only a build that was asked for maps emits them', () => {
	assert.equal(buildSourceMapsRequested({ SCAPE_BUILD_SOURCE_MAPS: '1' }), true);
	assert.equal(buildSourceMapsRequested({ SCAPE_BUILD_SOURCE_MAPS: '0' }), false);
	assert.equal(buildSourceMapsRequested({ SCAPE_BUILD_SOURCE_MAPS: '' }), false);
	assert.equal(buildSourceMapsRequested({}), false);
});

test('the maps land in a sibling of the output directory, never inside it', () => {
	assert.equal(sourceMapDirectoryFor('dist'), 'dist-source-maps');
	assert.equal(sourceMapDirectoryFor('.wrangler/browser-products/framescaper/'), '.wrangler/browser-products/framescaper-source-maps');
	assert.throws(() => sourceMapDirectoryFor('/'), /source-map directory/u);
});

test('relocation empties the build of maps and leaves its bytes alone', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'dist');
	writeBuiltChunk(built, 'assets/app-abc123.js', 'console.log(1);\n');
	writeSourceMap(built, 'assets/app-abc123.js.map', {
		version: 3,
		sources: ['../../src/common/measured.ts'],
		sourcesContent: ['export const measured = 1;\n'],
		mappings: 'AAAA',
	});
	writeBuiltChunk(built, 'assets/worker-def456.js', 'self.postMessage(1);\n');
	writeSourceMap(built, 'assets/worker-def456.js.map', { version: 3, sources: [], mappings: '' });
	// A directory left over from an earlier build must not survive into this one.
	mkdirSync(sourceMapDirectoryFor(built), { recursive: true });
	writeFileSync(join(sourceMapDirectoryFor(built), 'stale-000000.js.map'), '{}');

	const relocated: string[] = await relocateEmittedSourceMaps(built);

	assert.deepEqual(relocated, ['app-abc123.js.map', 'worker-def456.js.map']);
	assert.deepEqual(readdirSync(join(built, 'assets')).sort(), ['app-abc123.js', 'worker-def456.js']);
	assert.equal(readFileSync(join(built, 'assets/app-abc123.js'), 'utf8'), 'console.log(1);\n');
	assert.deepEqual(
		readdirSync(sourceMapDirectoryFor(built)).sort(),
		['app-abc123.js.map', 'worker-def456.js.map'],
	);
});

test('a relocated map names its sources absolutely and drops their embedded text', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'dist');
	writeBuiltChunk(built, 'assets/app-abc123.js', 'console.log(1);\n');
	writeSourceMap(built, 'assets/app-abc123.js.map', {
		version: 3,
		sources: ['../../src/common/measured.ts', '\u0000vite/preload-helper', 'https://example.invalid/vendor.js'],
		sourcesContent: ['export const measured = 1;\n', null, null],
		mappings: 'AAAA',
	});

	await relocateEmittedSourceMaps(built);

	const map = JSON.parse(
		readFileSync(join(sourceMapDirectoryFor(built), 'app-abc123.js.map'), 'utf8'),
	) as { sources: string[], sourceRoot: string, sourcesContent: unknown };
	assert.deepEqual(map.sources, [
		pathToFileURL(resolve(workspace, 'src/common/measured.ts')).href,
		'\u0000vite/preload-helper',
		'https://example.invalid/vendor.js',
	]);
	assert.equal(map.sourceRoot, '');
	// c8 reads the text of an absolute source from disk, so the relocated map
	// carries no copy of it.
	assert.equal(map.sourcesContent, undefined);
});

test('a sourceRoot is folded into the absolute sources rather than dropped', () => {
	const rewritten = absoluteSourceMapSources(
		{ version: 3, sourceRoot: '../..', sources: ['src/common/measured.ts'], mappings: '' },
		'/build/dist/assets',
	);

	assert.deepEqual(rewritten.sources, [pathToFileURL('/build/src/common/measured.ts').href]);
});

test('two maps that would overwrite each other stop the build', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'dist');
	writeSourceMap(built, 'assets/app.js.map', { version: 3, sources: [], mappings: '' });
	writeSourceMap(built, 'workers/app.js.map', { version: 3, sources: [], mappings: '' });

	await assert.rejects(
		relocateEmittedSourceMaps(built),
		/Two emitted source maps share the file name app\.js\.map/u,
	);
});

test('an unreadable map is a build failure, not a silently skipped one', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'dist');
	mkdirSync(join(built, 'assets'), { recursive: true });
	writeFileSync(join(built, 'assets/app.js.map'), '{"version"');

	await assert.rejects(relocateEmittedSourceMaps(built), /is not readable JSON/u);
});

test('the build plugin only ever runs on a build, and after everything that writes', () => {
	const plugin = relocateBuildSourceMaps();

	assert.equal(plugin.name, 'kw-relocate-build-source-maps');
	assert.equal(plugin.apply, 'build');
	assert.equal(plugin.enforce, 'post');
	assert.equal(typeof plugin.writeBundle, 'function');
});

function writeBuiltChunk(built: string, relativePath: string, contents: string): void {
	const path = join(built, relativePath);
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, contents);
}

function writeSourceMap(built: string, relativePath: string, map: unknown): void {
	writeBuiltChunk(built, relativePath, JSON.stringify(map));
}

function makeWorkspace(): string {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-source-map-relocation-'));
	workspaces.push(workspace);
	return workspace;
}
