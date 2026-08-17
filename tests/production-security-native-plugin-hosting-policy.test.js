/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('the native plug-in hosting row describes the out-of-process host that shipped', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.ok(risk);
	assert.doesNotMatch(
		JSON.stringify(risk),
		/no native plug-in discovery, loading, or execution/iu,
		'the hosting row must not claim a surface the helper implements',
	);
	const controls = new Map(risk.currentControls.map((control) => [control.id, control]));

	const fence = controls.get('unreached-plugin-hosting-surface');
	assert.ok(fence, 'the surface fence must say what is and is not reachable');
	assert.match(
		fence.summary,
		/every renderer plug-in channel the preload exposes is discovery-side.*availability, per-format consent, scan, inventory and quarantine clearance.*none of them instantiates, hosts, or renders/iu,
	);
	assert.match(
		fence.summary,
		/no production caller mints a plug-in-host grant.*PluginHostIsolationRegistry.*hostGrantFor.*tests/iu,
	);
	assert.match(fence.summary, /VST3, CLAP, Audio Units and LV2 remain fail-closed.*fixture/iu);
	assertEvidence(fence, [
		'desktop/preload.mjs',
		'desktop/plugin-registration.mjs',
		'desktop/plugin-registry.ts',
		'tests/desktop-protocol.test.js',
		'tests/desktop-plugin-registry.test.ts',
		'tests/production-licensing-matrix.test.js',
	]);

	const execution = controls.get('out-of-process-plugin-host-execution');
	assert.ok(execution, 'the hosting path that exists must be recorded as auditable');
	assert.match(
		execution.summary,
		/plugin-host.*job kind.*absolute traversal-free binary path.*byte length.*lowercase SHA-256.*format.*captured device\/inode identity/iu,
	);
	assert.match(
		execution.summary,
		/re-hashes the granted file.*changed digest.*unreviewed installation.*dlopen.*RTLD_NOW \| RTLD_LOCAL/iu,
	);
	assert.match(
		execution.summary,
		/no native plug-in code loads in main.*preload.*renderer.*AudioWorklet.*scan service does not import the hosting surface/iu,
	);
	assert.match(
		execution.summary,
		/refuses a module with no fixture entry point.*ABI version.*instrument classification.*output channel count outside 1 through 64/iu,
	);
	assert.match(
		execution.summary,
		/offline only.*deterministic ramp block set.*rendered SHA-256 digest.*cannot carry a live stream/iu,
	);
	assertEvidence(execution, [
		'desktop/helper-job-grant.ts',
		'desktop/native-helper-host-job.js',
		'desktop/native-helper-process.js',
		'desktop/plugin-host-isolation.ts',
		'native/soundscaper-helper-addon/src/plugin_host.c',
		'tests/desktop-helper-contract.test.ts',
		'tests/desktop-native-helper-host-job.test.js',
		'tests/desktop-plugin-host-isolation.test.ts',
		'tests/native-fixture-plugin-format.test.js',
	]);

	const containment = controls.get('digest-keyed-plugin-consent-isolation-and-quarantine');
	assert.ok(containment, 'consent, isolation and quarantine are controls that exist');
	assert.match(
		containment.summary,
		/consent is per format.*nothing scans at startup.*main-owned directory picker.*raw roots and binary paths stay main-private/iu,
	);
	assert.match(
		containment.summary,
		/one host process per renderer owner and plug-in binary digest.*revocation kills the matching host and prevents automatic restart/iu,
	);
	assert.match(
		containment.summary,
		/two qualifying host faults.*ten minutes.*written atomically.*survives restart.*explicit rescan or re-enable/iu,
	);
	assert.match(
		containment.summary,
		/user cancellation, device loss and editor shutdown are not faults/iu,
	);
	assert.match(
		containment.summary,
		/oversize.*ineligible without discarding.*renders nothing.*cannot manufacture a freeze/iu,
	);
	assert.match(
		containment.summary,
		/helper-owned top-level window.*no renderer bridge, DOM, Node, filesystem, network, child-process, or embedded child window/iu,
	);
	assertEvidence(containment, [
		'desktop/plugin-consent.ts',
		'desktop/plugin-quarantine.ts',
		'desktop/plugin-instance-state.ts',
		'desktop/plugin-host-isolation.ts',
		'tests/desktop-plugin-consent.test.ts',
		'tests/desktop-plugin-quarantine.test.ts',
		'tests/desktop-plugin-instance-state.test.ts',
		'tests/desktop-plugin-host-isolation.test.ts',
	]);
});

test('the native plug-in hosting row keeps its gaps unsoftened', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.equal(risk.status, 'planned');
	assert.equal(risk.releaseDisposition, 'surface-disabled');
	const residuals = new Map(risk.residualRisks.map((residual) => [residual.id, residual]));

	const authority = residuals.get('hosted-plugin-ambient-authority');
	assert.ok(authority, 'ambient authority must remain a named residual risk');
	assert.match(
		authority.exposure,
		/dlopen.*user account's full authority.*no operating-system sandbox.*crash containment.*not a hostile-code boundary/iu,
	);
	assert.match(authority.exposure, /no signature or publisher-verification channel/iu);

	const unexercised = residuals.get('unexercised-plugin-hosting-gates');
	assert.ok(unexercised, 'the unexercised hosting gates must remain a named residual risk');
	assert.match(
		unexercised.exposure,
		/hosting gates above have no production caller.*exercised only by tests.*real-time hosting.*PDC handoff.*vendor-UI lifecycle.*crash recovery.*unproven end to end/iu,
	);
	assert.match(unexercised.exposure, /linux-x64.*fixture-format host tests skip/iu);
	for (const residual of risk.residualRisks) {
		assert.ok(residual.requiredControl.length > 0, residual.id);
		assert.ok(residual.acceptanceCriteria.length > 0, residual.id);
	}
});

test('the native helper row stops describing hosting and device opening as absent', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const helper = matrix.risks.find(({ id }) => id === 'native-helper-processes');
	const residual = helper.residualRisks.find(({ id }) => id === 'native-helper-supervision');
	assert.ok(residual, 'the helper supervision residual risk must remain recorded');
	assert.doesNotMatch(residual.exposure, /plug-in-scan and plug-in-host helpers remain undesigned/iu);
	assert.doesNotMatch(residual.exposure, /opens no operating-system device/iu);
	assert.match(
		residual.exposure,
		/plug-in scan and plug-in host job kinds are implemented.*no product surface reaches the device-open or hosting path/iu,
	);
	assert.match(residual.acceptanceCriteria.join(' '), /m5-helper-fault-and-loopback-v1/u);
});

test('the threat-model narrative audits the hosting path instead of calling it out of scope', async () => {
	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.doesNotMatch(threatModel, /plug-in hosting remain out of scope/iu);
	assert.doesNotMatch(threatModel, /discovers operating-system audio backends and opens no device/iu);
	assert.match(
		threatModel,
		/planned and surface-disabled.*not offered to users.*not that no hosting code exists/iu,
	);
	assert.match(
		threatModel,
		/desktop\/plugin-host-isolation\.ts.*desktop\/native-helper-host-job\.js.*native\/soundscaper-helper-addon\/src\/plugin_host\.c.*must audit/iu,
	);
	assert.match(threatModel, /`dlopen`s the bytes with `RTLD_NOW \| RTLD_LOCAL` inside its own utility process/iu);
	assert.match(threatModel, /opens PipeWire and ALSA streams through an ordered candidate chain/iu);
	assert.match(threatModel, /no helper job kind reaches that open path yet/iu);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
