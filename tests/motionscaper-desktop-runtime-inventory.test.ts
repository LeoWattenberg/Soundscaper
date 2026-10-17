/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
	compileDesktopProjectLibraryRuntime, stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const root = resolve(import.meta.dirname, '..');

test('Motion integration emits its actual shared video runtime closure and retains exact inventory refusal', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-runtime-inventory-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const outputRoot = join(directory, 'runtime');
	// Always compile current sources: a cached fixture would conceal this regression.
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: root, outputRoot });
	const editor = join(outputRoot, 'src/common/editor');
	await context.test('compiled producer imports the admitted AVC and planar color dependencies', async () => {
		await import(pathToFileURL(join(editor, 'video-webcodecs-producer.js')).href);
		const planar: unknown = await import(pathToFileURL(join(editor, 'video-planar-pixels.js')).href);
		assert.ok(planar && typeof planar === 'object' && 'videoRgbaI420Pixels' in planar);
		assert.equal(typeof planar.videoRgbaI420Pixels, 'function');
		if (typeof planar.videoRgbaI420Pixels !== 'function') throw new TypeError('Missing compiled converter');
		const pixels: unknown = planar.videoRgbaI420Pixels(Uint8Array.of(
			0, 0, 0, 255, 255, 255, 255, 255,
			0, 0, 0, 255, 255, 255, 255, 255,
		), 2, 2, { encoding: 'rec709', alphaMode: 'straight', precision: 'unorm8' });
		assert.deepEqual(pixels, Uint8Array.of(16, 235, 16, 235, 128, 128));
		for (const name of ['video-avc-color-description', 'video-avc-native-configuration', 'video-color-transfer', 'video-planar-pixels']) {
			assert.ok(result.files.includes(`src/common/editor/${name}.js`));
			assert.doesNotMatch(await readFile(join(editor, `${name}.js`), 'utf8'), /from ['"].*\.ts['"]/u);
		}
	});
	const stage = () => stageDesktopApplicationSources({
		desktopSourceRoot: join(root, 'desktop'), applicationDesktopRoot: join(directory, 'application'), runtimeRoot: outputRoot,
	});
	await context.test('unexpected old runtime output is still rejected before staging', async () => {
		const stale = join(editor, 'motionscaper-unexpected-stale.js');
		await writeFile(stale, 'export const stale = true;\n', { flag: 'wx' });
		await assert.rejects(stage, /missing: \(none\); unexpected: src\/common\/editor\/motionscaper-unexpected-stale\.js/u);
		await rm(stale);
	});
	await context.test('a missing admitted AVC dependency is still rejected before staging', async () => {
		await rm(join(editor, 'video-avc-native-configuration.js'));
		await assert.rejects(stage, /missing: src\/common\/editor\/video-avc-native-configuration\.js; unexpected: \(none\)/u);
	});
});
