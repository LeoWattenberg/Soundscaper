/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_ROOT = join(REPOSITORY_ROOT, 'src');
const SOURCE_EXTENSIONS = /\.(?:jsx?|tsx?)$/u;

function sourceFiles(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) found.push(...sourceFiles(path));
		else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) found.push(path);
	}
	return found;
}

const SOURCES = sourceFiles(SOURCE_ROOT).map((path) => ({
	path: relative(REPOSITORY_ROOT, path).replaceAll('\\', '/'),
	text: readFileSync(path, 'utf8'),
}));

test('the retired second composition root and its workspace owner are gone', () => {
	for (const retired of [
		'src/common/editor/ui/AudioEditorBootstrap.jsx',
		'src/common/editor/ui/workspace/DefaultAudioEditorWorkspace.jsx',
	]) {
		assert.equal(existsSync(join(REPOSITORY_ROOT, retired)), false, `${retired} must stay deleted`);
	}

	for (const source of SOURCES) {
		assert.doesNotMatch(source.text, /AudioEditorBootstrap\.jsx/u, source.path);
		assert.doesNotMatch(source.text, /DefaultAudioEditorWorkspace/u, source.path);
	}

	const suppressions = JSON.parse(
		readFileSync(join(REPOSITORY_ROOT, 'eslint-suppressions.json'), 'utf8'),
	) as Record<string, unknown>;
	assert.equal(Object.hasOwn(suppressions, 'src/common/editor/ui/AudioEditorBootstrap.jsx'), false);
	assert.equal(
		Object.hasOwn(suppressions, 'src/common/editor/ui/workspace/DefaultAudioEditorWorkspace.jsx'),
		false,
	);
});

test('the shared editor app is a presentation seam with no self-constructing default export', () => {
	const app = SOURCES.find((source) => source.path === 'src/common/editor/ui/AudioEditorApp.jsx');
	assert.ok(app, 'AudioEditorApp.jsx must remain the shared frame');
	assert.match(app.text, /export function BoundAudioEditorApp\(/u);
	assert.doesNotMatch(app.text, /export default/u);
});

test('only the product editor controllers construct the shared controller', () => {
	const constructors = SOURCES
		.filter((source) => /\bcreateAudioEditorController\s*\(\s*null\b/u.test(source.text))
		.map((source) => source.path)
		.sort();
	assert.deepEqual(constructors, [
		'src/framescaper/editor-controller.ts',
		'src/soundscaper/editor-controller.ts',
	]);
});
