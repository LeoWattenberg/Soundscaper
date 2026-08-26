/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	chunkGroupForModulePath,
	chunkGroups,
} from '../scripts/lib/build-chunk-groups.mjs';

/**
 * Every flat editor domain module must be owned by a named chunk group.
 *
 * A module with no owner is placed by reachability. `video-delivery-frame-rate.ts`
 * arrived that way with the delivery slice: the export dialog reached it first, so
 * it was emitted inside the lazily imported ExportDialog chunk, while the eagerly
 * loaded shell modules that also read it - `ui/export-preset-model.ts` and
 * `ui/VideoDeliveryFields.jsx` - statically imported that chunk to get it. The
 * dialog chunk then initialized during the shell's own import and called a shell
 * initializer that had not been declared yet. Every route failed to mount with
 * `TypeError: y is not a function`, and nothing in the non-browser gate noticed,
 * because the defect only exists in the emitted chunk graph.
 *
 * Ownership is what prevents it: a shared leaf that belongs to a group is never
 * absorbed into a dialog chunk, whichever importer happens to reach it first.
 */

const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const ASSISTANCE_DIRECTORY = fileURLToPath(new URL('../src/common/editor/assistance/', import.meta.url));
const EDITOR_UI_DIRECTORY = fileURLToPath(new URL('../src/common/editor/ui/', import.meta.url));
const MODULE_PATTERN = /\.(?:[cm]?[jt]s)$/u;

test('every flat editor domain module has an owning chunk group', () => {
	const unowned = flatEditorModules()
		.filter((path) => chunkGroupForModulePath(path) === null);
	assert.deepEqual(unowned, [], 'these modules would be placed by reachability alone');
});

test('every assistance domain module has an owning chunk group', () => {
	const unowned = assistanceDomainModules()
		.filter((path) => chunkGroupForModulePath(path) === null);
	assert.deepEqual(unowned, [], 'these modules would be placed in a lazy assistance dialog');
});

test('the shell, controller, and storage groups keep the flat modules they name', () => {
	assert.equal(
		chunkGroupForModulePath('src/common/editor/video-delivery-frame-rate.ts'),
		'editor-domain',
	);
	assert.equal(
		chunkGroupForModulePath('src/common/editor/assistance/transcript.ts'),
		'editor-domain',
	);
	assert.equal(chunkGroupForModulePath('src/common/editor/index.js'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath('src/common/editor/facade.ts'), 'editor-controller-core');
	assert.equal(chunkGroupForModulePath('src/common/editor/history.js'), 'editor-storage-model');
	assert.equal(chunkGroupForModulePath('src/common/editor/video-timeline.js'), 'editor-timeline');
	// A dialog stays outside every path-matched group, so it can be split off and
	// loaded when it is opened rather than when the editor boots.
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/inspector/ExportDialog.jsx'), null);
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/VideoDeliveryFields.jsx'), 'editor-shell');
});

test('the domain group sits below the groups whose modules it would otherwise claim', () => {
	const priority = (name: string): number => {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group, `${name} must exist`);
		return group.priority as number;
	};
	for (const name of ['editor-engine', 'editor-storage-model', 'editor-timeline', 'editor-controller-core', 'editor-shell']) {
		assert.ok(
			priority(name) > priority('editor-domain'),
			`${name} must outrank editor-domain, which matches every flat module`,
		);
	}
});

test('editor groups never absorb shared application dependencies recursively', () => {
	for (const name of [
		'editor-engine',
		'editor-storage-model',
		'editor-timeline',
		'editor-controller-core',
		'editor-shell',
		'editor-domain',
	]) {
		const group = chunkGroups.find((candidate) => candidate.name === name);
		assert.ok(group, `${name} must exist`);
		assert.equal(group.includeDependenciesRecursively, false, `${name} captured a shared site dependency`);
	}
});

test('editor UI imports exact internal design-system modules', () => {
	const broadImporters = sourceModules(EDITOR_UI_DIRECTORY)
		.filter((path) => readFileSync(path, 'utf8').includes("from '@dilsonspickles/components'"));
	assert.deepEqual(broadImporters, [], 'broad design-system imports retain every component stylesheet');
	const viteConfig = readFileSync(fileURLToPath(new URL('../vite.config.mjs', import.meta.url)), 'utf8');
	const tsconfig = readFileSync(fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)), 'utf8');
	assert.match(viteConfig, /@soundscaper\\\/design-system/u);
	assert.match(tsconfig, /"@soundscaper\/design-system\/\*"/u);
});

test('design-system foundation and loaded component modules have separate owners', () => {
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx'),
		'vendor-design-system',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/hooks/useTabOrder.ts'),
		'vendor-design-system',
	);
	assert.equal(
		chunkGroupForModulePath('vendor/audacity-design-system/components/src/Button/Button.tsx'),
		'vendor-design-system-components',
	);
	const components = chunkGroups.find((candidate) => candidate.name === 'vendor-design-system-components');
	assert.ok(components);
	assert.equal(components.includeDependenciesRecursively, false);
});

function flatEditorModules(): readonly string[] {
	return readdirSync(EDITOR_DIRECTORY, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MODULE_PATTERN.test(entry.name))
		.map((entry) => `src/common/editor/${entry.name}`)
		.sort();
}

function assistanceDomainModules(): readonly string[] {
	return readdirSync(ASSISTANCE_DIRECTORY, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MODULE_PATTERN.test(entry.name))
		.map((entry) => `src/common/editor/assistance/${entry.name}`)
		.sort();
}

function sourceModules(directory: string): readonly string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(?:[jt]sx?)$/u.test(entry.name))
		.map((entry) => `${entry.parentPath}/${entry.name}`)
		.sort();
}
