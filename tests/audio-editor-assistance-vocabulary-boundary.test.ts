/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * The assistance domain vocabulary is not presentation, so it does not live in `ui/`.
 *
 * `controller/` used to name sixteen types out of `src/common/editor/ui/`, every one of
 * them an `import type`. The rule that should have caught the inversion
 * (`editor-core-does-not-import-ui` in `.dependency-cruiser.cjs`) could not see type-only
 * edges at all, so the whole assistance vocabulary sat behind a presentation directory:
 * a worker, the desktop main process or Node tooling could not name `LocalAssistanceModel`
 * without loading a `ui/` module, which is directly in the path of milestone 7.
 *
 * The cruiser now sees those edges, but the cruise is a separate gate that runs over the
 * whole repository. This file is the cheap, targeted statement of the same invariant: it
 * reads the sources, so it fails in the ordinary suite the moment an editor-core module
 * reaches back into `ui/` for a type.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;
/** Every specifier a module names, whether it imports values, types, or does so lazily. */
const SPECIFIER_PATTERN = /(?:from|import)\s*\(?\s*'(\.[^']+)'|(?:from|import)\s*\(?\s*"(\.[^"]+)"/gu;

function sourcesUnder(directory: string): readonly string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && SOURCE_PATTERN.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

function specifiersInto(directory: string, segment: string): readonly string[] {
	const found: string[] = [];
	for (const path of sourcesUnder(directory)) {
		const source = readFileSync(path, 'utf8');
		for (const match of source.matchAll(SPECIFIER_PATTERN)) {
			const specifier = (match[1] ?? match[2])!;
			if (!specifier.includes(segment)) continue;
			found.push(`${relative(REPOSITORY_ROOT, path).split('\\').join('/')} -> ${specifier}`);
		}
	}
	return found;
}

test('no controller module names a module under ui/, not even for a type', () => {
	// The scan is only as good as the files it reads, so check it read them: an empty
	// result from an empty directory listing would pass this file while proving nothing.
	assert.ok(sourcesUnder(join(EDITOR_DIRECTORY, 'controller')).length > 100);
	assert.ok(specifiersInto(join(EDITOR_DIRECTORY, 'controller'), '/assistance/').length > 10);
	assert.deepEqual(specifiersInto(join(EDITOR_DIRECTORY, 'controller'), '/ui/'), []);
});

test('the assistance domain names no module under ui/, not even for a type', () => {
	// The vocabulary modules moved here out of `ui/`, and the two lazy projections they
	// resolve through moved with them. A specifier back into `ui/` would reinstate the
	// inversion one indirection further out.
	assert.deepEqual(specifiersInto(join(EDITOR_DIRECTORY, 'assistance'), '/ui/'), []);
});

test('the assistance vocabulary modules are where controller and ui can both read them', () => {
	for (const name of [
		'local-assistance-bridge.ts',
		'local-assistance-cleanup.ts',
		'local-assistance-guided-result-review.ts',
		'local-assistance-preparation.ts',
		'local-assistance-result-review.ts',
		'local-assistance-shot-review.ts',
		'local-assistance-workflow-bridge.ts',
	]) {
		const source = readFileSync(join(EDITOR_DIRECTORY, 'assistance', name), 'utf8');
		assert.doesNotMatch(source, /from '(?:react|react-dom)/u, `${name} must import no React`);
	}
});

test('the offline RGBA composition hooks are declared outside the presentation layer', () => {
	const contract = readFileSync(
		join(EDITOR_DIRECTORY, 'video-keyframe-offline-rgba-contract.ts'), 'utf8');
	for (const name of ['VideoKeyframeOfflineRgbaCompositor', 'VideoKeyframeOfflineRgbaPostprocessor']) {
		assert.match(contract, new RegExp(`export type ${name} =`, 'u'));
	}
	// The renderer that consumes them stays in `ui/`, because it drives the WebGL preview
	// compositor the workspace renders through; it re-exports the shapes for its own callers.
	const renderer = readFileSync(
		join(EDITOR_DIRECTORY, 'ui', 'video-keyframe-offline-rgba-renderer.ts'), 'utf8');
	assert.match(renderer, /export type \{[\s\S]*?\} from '\.\.\/video-keyframe-offline-rgba-contract\.ts';/u);
});
