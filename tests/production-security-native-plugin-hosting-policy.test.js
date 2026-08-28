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

	const fence = controls.get('menu-reached-plugin-hosting-surface');
	assert.ok(fence, 'the surface control must say what is and is not machine-runnable');
	assert.match(
		fence.summary,
		/Soundscaper family v1.*direct unversioned Soundscaper baseline.*insert.*native-plugin.*persistent supervised host.*real-time and offline.*V21 PDC.*vendor window/iu,
	);
	assert.match(
		fence.summary,
		/Framescaper family v1.*direct unversioned Framescaper baseline.*scan, enable and Add OFX.*context-aware V14 frame graph.*all six contexts.*Interact Suite V1.*DrawSuite V1/iu,
	);
	assert.match(
		fence.summary,
		/VST3, CLAP, Audio Units, LV2 and OpenFX.*enabled for testing.*human.*milestone 9.*stable 1\.0.*never.*execution/iu,
	);
	assert.match(
		fence.summary,
		/no authenticated built target payload\/launcher.*machine.*unavailable/iu,
	);
	assertEvidence(fence, [
		'desktop/preload.mjs',
		'desktop/plugin-registration.mjs',
		'desktop/plugin-registry.ts',
		'desktop/plugin-host-service.ts',
		'desktop/native-audio-session-service.ts',
		'desktop/plugin-vendor-window-authority.mjs',
		'desktop/native-child-isolation-launcher.ts',
		'src/soundscaper/editor-native-plugin-actions.ts',
		'desktop/framescaper-openfx-live-frame-transform.ts',
		'tests/desktop-protocol.test.js',
		'tests/desktop-plugin-registry.test.ts',
		'tests/desktop-plugin-host-service.test.ts',
		'tests/desktop-native-child-isolation-launcher.test.ts',
		'tests/desktop-framescaper-openfx-live-frame-transform.test.ts',
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
		/re-hashes the granted file.*changed digest.*different installation.*dlopen.*RTLD_NOW \| RTLD_LOCAL/iu,
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

test('the native plug-in hosting row enables testing while keeping machine gaps unsoftened', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.equal(risk.status, 'partial');
	assert.equal(risk.releaseDisposition, 'conditional');
	const residuals = new Map(risk.residualRisks.map((residual) => [residual.id, residual]));

	const authority = residuals.get('hosted-plugin-ambient-authority');
	assert.ok(authority, 'ambient authority must remain a named residual risk');
	assert.match(
		authority.exposure,
		/launcher source.*Linux namespaces\/Landlock\/seccomp.*macOS Seatbelt.*Windows AppContainer.*no authenticated built launcher.*machine-unavailable/iu,
	);
	assert.match(authority.exposure, /signature or publisher-verification.*milestone 9.*stable 1\.0/iu);

	const unexercised = residuals.get('unexercised-plugin-hosting-gates');
	assert.ok(unexercised, 'the unexercised hosting gates must remain a named residual risk');
	assert.match(
		unexercised.exposure,
		/product callers.*Soundscaper family v1.*direct unversioned baseline.*real-time and offline hosting.*V21 PDC.*vendor-window lifecycle.*Framescaper family v1.*direct unversioned baseline.*all six contexts/iu,
	);
	assert.match(
		unexercised.exposure,
		/external source audit is 0\/10.*OpenFX payload manifest is empty.*no authenticated built per-OS launcher.*machine payload/iu,
	);
	assert.match(
		unexercised.requiredControl,
		/human.*milestone 9.*stable 1\.0.*not.*(?:execution|testing)/iu,
	);
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
		/Soundscaper family-v1 route.*native audio.*native-effect hosting.*direct unversioned baseline.*Framescaper family-v1 and exact V14-render route.*persistent services V3.*direct unversioned native baseline.*native media.*OpenFX frame graph/iu,
	);
	assert.match(residual.exposure, /0\/10.*all five Soundscaper professional rows.*both Framescaper payload manifests are empty.*zero accepted cohorts/iu);
	assert.match(residual.acceptanceCriteria.join(' '), /m5-helper-fault-and-loopback-v1/u);
});

test('the threat-model narrative separates enabled testing from machine and release admission', async () => {
	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.doesNotMatch(threatModel, /plug-in hosting remain out of scope/iu);
	assert.doesNotMatch(threatModel, /discovers operating-system audio backends and opens no device/iu);
	assert.match(
		threatModel,
		/partial and conditionally admitted.*enabled for testing.*human.*milestone 9.*stable 1\.0/iu,
	);
	assert.match(
		threatModel,
		/1\.0 project-identity boundary.*schemaFamily:'soundscaper'.*schemaFamily:'framescaper'.*native-payload.*release-blocking/isu,
	);
	assert.match(threatModel, /0\/10.*payload.*pending-external.*zero accepted cohorts/iu);
	assert.match(
		threatModel,
		/launcher source.*Landlock.*Seatbelt.*AppContainer.*no authenticated built.*machine payload/iu,
	);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
