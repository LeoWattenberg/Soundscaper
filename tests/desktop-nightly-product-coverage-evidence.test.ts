/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPackage } from '@electron/asar';

import {
	preserveDesktopNightlyProductCoverageEvidence,
} from '../scripts/lib/desktop-nightly-product-coverage-evidence.mjs';

const REVISION = '0123456789abcdef0123456789abcdef01234567';

test('nightly product coverage evidence preserves every executable and renderer map', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-evidence-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const buildRoot = join(workspace, '.desktop-build');
	const productOutput = join(workspace, 'release', 'soundscaper');
	const files = new Map([
		['app/desktop/main.mjs', 'export const main = true;\n'],
		['app/desktop/preload.cjs', 'module.exports = true;\n'],
		['app/desktop/ignored.json', '{}\n'],
		['renderer/assets/editor-abc.js', 'globalThis.editor = true;\n'],
		['renderer/index.html', '<main></main>\n'],
		['renderer-source-maps/editor-abc.js.map', JSON.stringify({ version: 3, sources: [] })],
	]);
	for (const [name, contents] of files) {
		await mkdir(join(buildRoot, name, '..'), { recursive: true });
		await writeFile(join(buildRoot, name), contents);
	}
	const resources = join(productOutput, 'linux-unpacked/resources');
	await mkdir(join(resources, 'renderer/assets'), { recursive: true });
	await writeFile(
		join(resources, 'renderer/assets/editor-abc.js'),
		files.get('renderer/assets/editor-abc.js') ?? '',
	);
	await createPackage(join(buildRoot, 'app'), join(resources, 'app.asar'));

	const manifest = await preserveDesktopNightlyProductCoverageEvidence({
		buildRoot,
		productId: 'soundscaper',
		productOutput,
		sourceRevision: REVISION,
	});

	assert.equal(manifest.schemaVersion, 2);
	assert.equal(manifest.productId, 'soundscaper');
	assert.equal(manifest.sourceRevision, REVISION);
	assert.match(manifest.packageArchive.sha256, /^[0-9a-f]{64}$/u);
	assert.deepEqual(manifest.scripts.map(({ realm, packagedPath, artifactPath }) => ({
		realm, packagedPath, artifactPath,
	})), [
		{
			realm: 'main',
			packagedPath: 'app.asar/desktop/main.mjs',
			artifactPath: 'app/desktop/main.mjs',
		},
		{
			realm: 'preload',
			packagedPath: 'app.asar/desktop/preload.cjs',
			artifactPath: 'app/desktop/preload.cjs',
		},
		{
			realm: 'renderer',
			packagedPath: 'renderer/assets/editor-abc.js',
			artifactPath: 'renderer/assets/editor-abc.js',
		},
	]);
	for (const script of manifest.scripts) {
		const contents = await readFile(join(productOutput, 'e2e-coverage', script.artifactPath));
		assert.equal(script.byteLength, contents.byteLength);
		assert.equal(script.sha256, createHash('sha256').update(contents).digest('hex'));
	}
	assert.deepEqual(manifest.sourceMaps, [{
		artifactPath: 'renderer-source-maps/editor-abc.js.map',
		byteLength: files.get('renderer-source-maps/editor-abc.js.map')?.length,
		sha256: createHash('sha256')
			.update(files.get('renderer-source-maps/editor-abc.js.map') ?? '')
			.digest('hex'),
	}]);
	assert.deepEqual(
		JSON.parse(await readFile(join(productOutput, 'e2e-coverage/manifest.json'), 'utf8')),
		manifest,
	);
	await writeFile(join(buildRoot, 'app/desktop/main.mjs'), 'changed after packaging\n');
	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot,
			productId: 'soundscaper',
			productOutput,
			sourceRevision: REVISION,
		}),
		/packaged app\.asar\/desktop\/main\.mjs differs/u,
	);
});

test('nightly product coverage evidence refuses a renderer build without maps', async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-coverage-maps-'));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const buildRoot = join(workspace, '.desktop-build');
	await mkdir(join(buildRoot, 'app/desktop'), { recursive: true });
	await mkdir(join(buildRoot, 'renderer/assets'), { recursive: true });
	await writeFile(join(buildRoot, 'app/desktop/main.mjs'), 'void 0;\n');
	await writeFile(join(buildRoot, 'renderer/assets/editor.js'), 'void 0;\n');

	await assert.rejects(
		preserveDesktopNightlyProductCoverageEvidence({
			buildRoot,
			productId: 'framescaper',
			productOutput: join(workspace, 'release', 'framescaper'),
			sourceRevision: REVISION,
		}),
		/renderer source maps/iu,
	);
});
