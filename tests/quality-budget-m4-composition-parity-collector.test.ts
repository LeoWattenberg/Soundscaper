import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createPendingM4ProductionParityResult } from '../scripts/collect-m4-production-parity-quality.mjs';
import { makeM4ProductionParityDiagnostic } from './helpers/m4-production-parity-fixture.ts';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;

test('one omitted composition operation fails the existing zero-omission parity gate', () => {
	const diagnostic = makeM4ProductionParityDiagnostic();
	const report = diagnostic.videoCases[4]!.renderReport as {
		status: string;
		composition: { rendered: string[]; omitted: string[] };
	};
	const omitted = report.composition.rendered.pop();
	assert.ok(omitted);
	report.composition.omitted.push(omitted);
	report.status = 'fallback';
	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.metrics['parity.silentlyOmittedEffects'], 1);
	assert.equal(result.status, 'failed');
});
