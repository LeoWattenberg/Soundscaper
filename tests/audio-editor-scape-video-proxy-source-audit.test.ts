/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { scapeVideoProxySourceReferences } from './helpers/scape-video-proxy-source-audit.ts';

const STEM = 'scape-video-proxy-archive-plan';
const REQUIRED = ['src/framescaper/editor-professional-media-archive-plan.ts',
	'tests/audio-editor-scape-video-proxy-archive-plan.test.ts'];

test('the source guard inspects required owners and deprecated full paths without reading unrelated sources', async () => {
	const deprecated = ['src/scape-video-proxy-archive-plan-v2/nested/owner.tsx',
		'desktop/scape-video-proxy-archive-plan-v2.cjs',
		'scripts/scape-video-proxy-archive-plan-v2.mjs',
		'tests/scape-video-proxy-archive-plan-v2.js'];
	const unrelated = 'src/common/unrelated.ts';
	const files = [REQUIRED[0]!, unrelated, ...deprecated, REQUIRED[1]!];
	const reads: string[] = [];
	const references = await scapeVideoProxySourceReferences(files, REQUIRED, STEM, async file => {
		reads.push(file);
		assert.notEqual(file, unrelated, 'unrelated content cannot affect any of the guard assertions');
		return file === deprecated[2] ? 'no reference here' : `export { plan } from '${STEM}.ts';`;
	});
	assert.deepEqual(reads, files.filter(file => file !== unrelated));
	assert.deepEqual(references, [REQUIRED[0], deprecated[0], deprecated[1], deprecated[3], REQUIRED[1]]);
	assert.equal(references.every(file => !file.includes(`${STEM}-v2`)), false);
});

test('required ownership still depends on both the source inventory and its literal module reference', async () => {
	const references = await scapeVideoProxySourceReferences([REQUIRED[0]!], REQUIRED, STEM,
		async () => 'export const unrelated = true;');
	assert.deepEqual(references, []);
	const missing = await scapeVideoProxySourceReferences([], REQUIRED, STEM, async () => {
		throw new Error('a path outside the source inventory must not be read');
	});
	assert.deepEqual(missing, []);
});
