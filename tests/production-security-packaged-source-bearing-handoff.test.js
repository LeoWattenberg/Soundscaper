/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('packaged cross-product handoff prose is historical provenance', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-source-bearing-project-library-handoff',
	);
	assert.ok(control);
	assert.equal(control.policyAuthority, 'historical-provenance-only');
	assert.match(control.summary, /no family-v1.*authority/iu);
	assert.equal(
		control.historicalPreFreezeNarrative?.status,
		'provenance-only-not-runtime-authority',
	);
	assert.match(
		control.historicalPreFreezeNarrative.summary,
		/Historical pre-V18.*six sequential packaged.*Soundscaper.*Framescaper/isu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/packaged-source-bearing-handoff[\s\S]*?preserves pre-freeze.*no family-v1/iu,
	);
});
