/* SPDX-License-Identifier: AGPL-3.0-only */


import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_EXPECTED_RUNTIME_FILES,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	// The compile fails closed on its own manifest, so a second hand-maintained
	// copy of the same 450-line list here carried no independent signal — both
	// copies are written by the same change — and a slice that added five
	// runtime members left this one behind and broke the quality gate. Pin the
	// reported set to the shipped manifest and keep the checks below, which say
	// something the manifest cannot: that the output actually imports.
	assert.deepEqual(result.files, [...DESKTOP_EXPECTED_RUNTIME_FILES]);
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const packagedRuntimePrefix = './desktop/project-library-runtime/';
	for (const [specifier, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		assert.ok(target.startsWith(packagedRuntimePrefix),
			`${specifier} must resolve inside the packaged desktop runtime`);
		assert.ok(result.files.includes(target.slice(packagedRuntimePrefix.length)),
			`${specifier} must resolve to a compiled desktop runtime member`);
	}
	assert.ok(result.files.includes('src/common/editor/project-hierarchy-document-validation.js'));
	assert.ok(result.files.includes('src/common/editor/project-effect-tail-v21.js'));
	assert.equal(result.files.includes('src/common/editor/engine/types.js'), false,
		'type-only engine shapes must not become packaged runtime members');
	assert.ok(result.files.includes('src/common/editor/track-folder-v12.js'));
	assert.ok(result.files.includes('src/common/editor/track-hierarchy-v12.js'));
	assert.ok(result.files.includes('src/common/editor/timeline-annotation.js'));
	assert.ok(result.files.includes('desktop/assistance-float32-mono-wave-file-reader.js'));
	assert.equal(result.files.includes('src/common/editor/project-current.js'), false);
	assert.equal(result.files.includes('src/common/editor/pffft.js'), true);
	const soundMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/soundscaper-project-library-main.js')).href}?test=${Date.now()}`);
	const soundIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/soundscaper-project-library-main-ipc.js')).href}?test=${Date.now()}`);
	const frameMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/framescaper-project-library-main.js')).href}?test=${Date.now()}`);
	const frameIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/framescaper-project-library-main-ipc.js')).href}?test=${Date.now()}`);
	const exactMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-exact-generation-main.js')).href}?test=${Date.now()}`);
	const exactIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-exact-generation-main-ipc.js')).href}?test=${Date.now()}`);
	assert.equal(typeof soundMain.SoundscaperDesktopProjectLibraryMain?.start, 'function');
	assert.equal(typeof soundIpc.registerSoundscaperDesktopProjectLibraryMainIpc, 'function');
	assert.equal(typeof frameMain.FramescaperDesktopProjectLibraryMain?.start, 'function');
	assert.equal(typeof frameIpc.registerFramescaperDesktopProjectLibraryMainIpc, 'function');
	assert.equal(typeof exactMain.FramescaperDesktopProjectLibraryExactGenerationMain?.start, 'function');
	assert.equal(typeof exactIpc.registerFramescaperDesktopProjectLibraryExactGenerationMainIpc, 'function');
	assert.equal(result.files.some((file) => /(?:^|\/)project-library-v\d+(?:-|\.)/u.test(file)), false);
	for (const retired of [
		'desktop/project-library-host.js',
		'desktop/project-library-editor-service.js',
		'desktop/project-library-editor-media-service.js',
		'desktop/project-library-media.js',
	]) assert.equal(result.files.includes(retired), false, `${retired} must not ship`);
});
