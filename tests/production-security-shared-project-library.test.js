/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('desktop project-library security is product-isolated at family v1', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const boundary = matrix.boundaries.find(({ id }) => id === 'electron-main-to-shared-project-library');
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'fenced-current-schema-project-catalog-publication',
	);

	assert.ok(boundary);
	assert.match(boundary.data, /Soundscaper-v1 and Framescaper-v1/iu);
	assert.match(boundary.data, /library-schema-1.*SQLite-user_version-1/iu);
	assert.match(boundary.data, /pre-release roots.*never opened.*enumerated.*migrated.*mutated.*deleted/isu);
	assert.ok(risk);
	assert.equal(risk.status, 'partial');
	assert.match(risk.summary, /fresh family-v1 desktop library.*disjoint root and IPC namespace/iu);
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	assert.match(control.summary, /family-v1 handshakes.*library schema 1.*SQLite user_version 1/isu);
	assert.match(control.summary, /SSCP and FSCP application IDs/iu);
	assert.match(control.summary, /pre-release roots.*untouched and invisible/isu);
	for (const { path } of control.evidence) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
});

test('retired cross-product package controls cannot authorize the baseline', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	for (const id of [
		'packaged-linux-x64-source-free-project-library-handoff',
		'packaged-linux-x64-source-bearing-project-library-handoff',
		'chromium-scape-mixed-media-handoff',
	]) {
		const control = risk.currentControls.find((candidate) => candidate.id === id);
		assert.equal(control?.policyAuthority, 'historical-provenance-only', id);
		assert.match(control.summary, /no family-v1.*authority/iu);
		assert.equal(
			control.historicalPreFreezeNarrative?.status,
			'provenance-only-not-runtime-authority',
		);
	}
});

test('threat model names the direct baseline and the historical fence', async () => {
	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(threatModel, /shared-desktop-project-library-integrity.*current authority is product-isolated/isu);
	assert.match(threatModel, /schemaFamily and schemaVersion.*disjoint product:v1:project-library/isu);
	assert.match(threatModel, /Historical pre-freeze provenance.*grants no current project, migration,\s+storage, IPC, or package authority/isu);
});
