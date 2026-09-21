/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface Evidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityBoundary {
	readonly id: string;
	readonly entryPoints: readonly string[];
	readonly evidence: readonly Evidence[];
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: readonly Evidence[];
	readonly policyAuthority: string;
}

interface ResidualRisk {
	readonly id: string;
	readonly exposure: string;
	readonly requiredControl: string;
	readonly acceptanceCriteria: readonly string[];
}

interface SecurityRisk {
	readonly id: string;
	readonly boundaryIds: readonly string[];
	readonly status: string;
	readonly surfaceDisposition: string;
	readonly currentControls: readonly SecurityControl[];
	readonly residualRisks: readonly ResidualRisk[];
}

interface SecurityMatrix {
	readonly groundedAt: string;
	readonly boundaries: readonly SecurityBoundary[];
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('Freesound proxy security claims are bounded and retain deployment residuals', async () => {
	const [matrix, threatModel] = await Promise.all([
		readFile(matrixUrl, 'utf8').then((source) => JSON.parse(source) as SecurityMatrix),
		readFile(threatModelUrl, 'utf8'),
	]);
	const boundaries = new Map(matrix.boundaries.map((boundary) => [boundary.id, boundary]));
	const risk = matrix.risks.find(({ id }) => id === 'freesound-proxy-boundary');

	assert.ok(matrix.groundedAt >= '2026-09-21');
	assert.ok(risk);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.surfaceDisposition, 'conditional');
	assert.deepEqual(risk.boundaryIds, [
		'public-client-to-freesound-proxy',
		'freesound-upstream-to-proxy',
	]);

	for (const boundaryId of risk.boundaryIds) {
		const boundary = boundaries.get(boundaryId);
		assert.ok(boundary, boundaryId);
		assert.ok(boundary.entryPoints.some((path) => path.startsWith('functions/api/freesound/')));
		assert.ok(boundary.evidence.some(({ path }) => path === 'tests/freesound-api-handlers.test.ts'));
	}

	const control = risk.currentControls.find(({ id }) => id === 'bounded-freesound-read-proxy');
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	for (const path of [
		'functions/api/freesound/_shared/contracts.ts',
		'functions/api/freesound/_shared/handlers.ts',
		'public/_routes.json',
		'tests/freesound-api-contract.test.ts',
		'tests/freesound-api-handlers.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	assert.match(control.summary, /fixed https:\/\/freesound\.org API.*credential/isu);
	assert.match(control.summary, /exact `?cdn\.freesound\.org`?.*redirects.*disabled/isu);
	assert.match(control.summary, /2 MiB.*256 MiB/isu);
	assert.match(control.summary, /public.*not client authentication/isu);

	assert.deepEqual(risk.residualRisks.map(({ id }) => id), [
		'freesound-proxy-deployment-rate-limiting',
		'freesound-preview-stream-lifecycle',
	]);
	assert.match(risk.residualRisks[0]?.exposure ?? '', /does not provision or verify.*rate-limit/isu);
	assert.match(risk.residualRisks[1]?.exposure ?? '', /no proxy-owned.*body.*deadline.*digest/isu);
	for (const residual of risk.residualRisks) {
		assert.ok(residual.requiredControl.length > 0);
		assert.ok(residual.acceptanceCriteria.length > 0);
	}

	assert.match(threatModel, /### Freesound API proxy/u);
	assert.match(threatModel, /`freesound-proxy-boundary` is \*\*partial\*\*/u);
	assert.match(threatModel, /policy-narrative:bounded-freesound-read-proxy/u);
	assert.match(threatModel, /CORS.*not (?:client\s+)?authentication/isu);
	assert.match(threatModel, /rate-limit.*request volume.*concurrent\s+preview streams/isu);
	assert.match(threatModel, /preview.*body.*deadline.*cryptographic.*authentic/isu);
});

test('Wrangler local secret files cannot be added accidentally', async () => {
	const [gitignore, readme] = await Promise.all([
		readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
		readFile(new URL('../functions/api/freesound/README.md', import.meta.url), 'utf8'),
	]);
	const ignoredEntries = new Set(gitignore.split(/\r?\n/u));

	assert.equal(ignoredEntries.has('.dev.vars'), true);
	assert.equal(ignoredEntries.has('.dev.vars.*'), true);
	assert.match(readme, /ignored `\.dev\.vars`\s+file.*FREESOUND_LOCAL_DEVELOPMENT=1/isu);
	assert.match(readme, /public read API.*CORS.*does\s+not authenticate.*rate-limit/isu);
	assert.match(readme, /freesound\.org\/apiv2\/apply.*HQ OGG preview.*not the original.*does not need.*OAuth/isu);
	assert.match(
		readme,
		/select the \*\*Production\*\* environment.*pages secret put FREESOUND_API_KEY --project-name soundscaper.*Preview.*fail closed with `503`.*\*\*Preview\*\* environment.*does not expose an environment selector/isu,
	);
	assert.doesNotMatch(readme, /pages secret put[^\n]*--env/iu);
	assert.match(readme, /secrets\.required.*does not create a deployed secret/isu);
	assert.match(readme, /Bulk Redirect.*Vary.*`Origin` and `Range`/isu);
});
