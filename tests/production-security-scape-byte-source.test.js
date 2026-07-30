/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('production evidence pins bounded random-access .scape admission', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const archiveExpansion = matrix.risks.find(({ id }) => id === 'scape-archive-expansion');
	const control = archiveExpansion?.currentControls.find(
		({ id }) => id === 'bounded-random-access-archive-reading',
	);
	assert.ok(control);
	assert.match(
		control.summary,
		/lower-only.*33 MiB.*native `Uint8Array`.*69,271,649-byte.*comments.*conflicting overlaps.*payload gaps.*Blob.*not yet.*desktop/iu,
	);
	for (const path of [
		'src/common/editor/scape-archive-byte-source.ts',
		'src/common/editor/scape-archive-layout-witness.ts',
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-reader.ts',
		'tests/audio-editor-scape-archive-byte-source.test.ts',
	]) {
		assert.ok(control.evidence.some((item) => item.path === path), `Missing evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/scape-archive-structure-integrity.*branded random-access byte-source.*lower.*33 MiB.*native typed-array.*69,271,649-byte.*central comments.*conflicting overlaps.*payload gaps.*bounded structural snapshot.*not whole-archive atomicity.*not yet connected.*desktop selected-file capabilities/isu,
	);
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/random-access byte source.*69,271,649 bytes.*canonical writer profile.*payload gaps.*not yet wired.*desktop selected-file capabilities.*512 MiB/isu,
	);
});
