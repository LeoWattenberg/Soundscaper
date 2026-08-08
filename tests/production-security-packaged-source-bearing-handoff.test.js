/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	PACKAGED_HANDOFF_CLAIMS,
	PACKAGED_HANDOFF_EVIDENCE,
} from './helpers/packaged-handoff-claims.js';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('packaged source-bearing handoff evidence stays fixed to its two Electron workflows', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-source-bearing-project-library-handoff',
	);

	assert.ok(control);
	assert.deepEqual(control.evidence, PACKAGED_HANDOFF_EVIDENCE);
	assert.match(control.summary, PACKAGED_HANDOFF_CLAIMS.matrixSummary);
	assert.match(control.summary, PACKAGED_HANDOFF_CLAIMS.matrixQualification);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(threatModel, PACKAGED_HANDOFF_CLAIMS.threatModel);
});
