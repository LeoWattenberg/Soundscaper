/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import releaseLines from '../config/product-release-lines.json' with { type: 'json' };

test('product-owned previews exclude the Soundscaper stable tag and any release-admission step', async () => {
	assert.equal(releaseLines.products.soundscaper.candidate.version, '1.0.0-rc.1');
	assert.equal(releaseLines.products.framescaper.releaseChannel, 'deferred');
	assert.equal(releaseLines.products.soundscaper.stable.tagPrefix, 'v');
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /'soundscaper-v\*-beta\.\*'/u);
	assert.match(workflow, /'soundscaper-v\*-rc\.\*'/u);
	assert.match(workflow, /'framescaper-v\*-rc\.\*'/u);
	assert.doesNotMatch(workflow, /- 'v\*'/u);
	assert.match(workflow, /resolveProductReleaseTag\(tag/u);
	assert.doesNotMatch(workflow, /release admission|qualification|stable-1:admission/iu);
	const stable = await readFile(new URL('../.github/workflows/soundscaper-stable-1.yml', import.meta.url), 'utf8');
	assert.match(stable, /tags:\s*\n\s*- 'v1\.0\.0'/u);
});
