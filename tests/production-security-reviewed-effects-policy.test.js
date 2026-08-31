/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);

test('reviewed effects qualify only the release-bundled pure-WASM catalog', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-security-matrix.json', import.meta.url),
		'utf8',
	));
	const risk = matrix.risks.find(({ id }) => id === 'reviewed-web-effect-packages');

	assert.ok(risk);
	assert.equal(risk.status, 'enforced');
	assert.equal(risk.surfaceDisposition, 'verified-current-surface');
	assert.deepEqual(risk.residualRisks, []);
	assert.deepEqual(risk.currentControls.map(({ id }) => id), [
		'release-pinned-reviewed-effect-catalog',
		'closed-reviewed-effect-wasm-abi',
		'terminating-reviewed-effect-offline-worker',
		'static-reviewed-effect-realtime-host',
	]);
	for (const control of risk.currentControls) {
		assert.ok(control.evidence.some(({ kind }) => kind === 'implementation'));
		assert.ok(control.evidence.some(({ kind, path }) => kind === 'test'
			&& path === 'tests/audio-editor-reviewed-effects.test.ts'));
		for (const { path } of control.evidence) {
			await assert.doesNotReject(access(new URL(path, repositoryUrl)), `Missing evidence: ${path}`);
		}
	}
	assert.match(
		risk.currentControls[0].summary,
		/exact id and version.*immutable release catalog.*SHA-256.*before compilation.*no URL.*trust override/iu,
	);
	assert.match(
		risk.currentControls[1].summary,
		/zero imports.*exact exports.*one bounded, unshared 32-bit memory.*latency and tail/iu,
	);
	assert.match(
		risk.currentControls[2].summary,
		/dedicated module worker.*closed.*protocol.*timeout.*abort.*terminates/iu,
	);
	assert.match(
		risk.currentControls[3].summary,
		/separately realtime-approved.*static first-party AudioWorklet.*Utility Gain.*does not qualify/iu,
	);
});

test('threat model and licensing evidence preserve the external-package fence', async () => {
	const [threatModel, licensingMatrix] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
	]);
	const gate = licensingMatrix.futureDistributionGates.find(
		({ id }) => id === 'web-effect-packages',
	);

	assert.match(threatModel, /`reviewed-web-effect-packages` is \*\*enforced for the closed release-bundled catalog only\*\*/u);
	assert.match(threatModel, /no arbitrary package URL, user trust override, package JavaScript, network, or same-origin storage authority/iu);
	assert.match(threatModel, /externally authored or non-repository-owned Web effect packages remain disabled/iu);
	assert.equal(gate.status, 'disabled');
	assert.equal(gate.scope, 'externally-authored-or-non-repository-owned-packages');
});
