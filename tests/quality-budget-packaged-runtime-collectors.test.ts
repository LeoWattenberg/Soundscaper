/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createPendingM4ProductionParityResult } from '../scripts/collect-m4-production-parity-quality.mjs';
import { createPendingM4B2KeyframeParityResult } from '../scripts/collect-m4b2-keyframe-parity-quality.mjs';
import { makeM4ProductionParityDiagnostic } from './helpers/m4-production-parity-fixture.ts';
import { makeM4B2KeyframeParityDiagnostic } from './helpers/m4b2-keyframe-parity-fixture.ts';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;

test('the M4 collector admits packaged-runtime diagnostics without treating them as qualification', () => {
	const diagnostic = makeM4ProductionParityDiagnostic();
	diagnostic.environmentId = 'packaged-runtime-win32-x64';
	const result = createPendingM4ProductionParityResult(diagnostic, config);

	assert.equal(result.environmentId, diagnostic.environmentId);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
});

test('the keyed collector admits packaged-runtime diagnostics without treating them as qualification', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic();
	diagnostic.environmentId = 'packaged-runtime-win32-x64';
	const result = createPendingM4B2KeyframeParityResult(diagnostic, config);

	assert.equal(result.environmentId, diagnostic.environmentId);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.evaluation.verdicts.length, 5);
});
