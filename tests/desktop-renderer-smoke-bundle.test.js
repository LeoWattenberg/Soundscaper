/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	buildDesktopRendererSmokeBundle,
	DESKTOP_RENDERER_SMOKE_BUNDLE,
} from '../scripts/lib/desktop-renderer-smoke-bundle.mjs';

const ROOT = resolve(import.meta.dirname, '..');

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} renderer smoke is a stable inventoried module with an authenticated hidden map`, async (context) => {
		const temporary = await mkdtemp(join(tmpdir(), `desktop-${productId}-renderer-smoke-`));
		context.after(() => rm(temporary, { recursive: true, force: true }));
		const rendererRoot = join(temporary, 'renderer');
		const result = await buildDesktopRendererSmokeBundle({
			repositoryRoot: ROOT,
			rendererRoot,
			productId,
			sourceMaps: true,
		});
		assert.equal(result.outputPath, join(rendererRoot, DESKTOP_RENDERER_SMOKE_BUNDLE));
		assert.equal(result.sourceMapPath,
			join(`${rendererRoot}-source-maps`, `${DESKTOP_RENDERER_SMOKE_BUNDLE}.map`));
		const source = await readFile(result.outputPath, 'utf8');
		assert.match(source, /runDesktopRendererSmoke/u);
		assert.doesNotMatch(source, /sourceMappingURL/u, 'the shipped module must not disclose its map');
		if (productId === 'soundscaper') {
			assert.doesNotMatch(source, /framescaperDesktop|FRAMESCAPER_WEB_VCR_|framescaper-web-vcr/u);
		} else {
			assert.match(source, /web-vcr-packaged/u);
		}
		const map = JSON.parse(await readFile(result.sourceMapPath, 'utf8'));
		assert.equal(map.version, 3);
		assert.equal(map.sourcesContent, undefined);
		assert.equal(map.sources.length, map.x_soundscaper_source_sha256.length);
		assert.ok(map.sources.length >= 7);
		assert.ok(map.sources.every((url) => url.startsWith('file:')));
		assert.ok(map.x_soundscaper_source_sha256.every((digest) => /^[a-f\d]{64}$/u.test(digest)));
	});
}
