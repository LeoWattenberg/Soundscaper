/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CONTROL_ID = 'framescaper-web-vcr-dormant-isolated-guest';
const ENVIRONMENT_ID = 'framescaper-web-vcr-runtime-matrix';
const FIXTURE_ID = 'm8plus-web-vcr-loopback-https-v1';
const WORKLOAD_ID = 'm8plus-web-vcr-long-session';

test('Web VCR software evidence remains behind the false production capability', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.applicationFeatures.framescaperWebVcr, false);
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'not-applicable');
	for (const path of [
		'src/common/editor/web-vcr-domain.ts',
		'src/common/editor/web-vcr-geometry.ts',
		'src/common/editor/controller/framescaper-web-vcr-controller.ts',
		'src/common/editor/controller/framescaper-web-vcr-controller-types.ts',
		'src/common/editor/controller/framescaper-web-vcr-snapshot-order.ts',
		'src/common/editor/controller/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/web-vcr-recorder-factory.ts',
		'src/common/editor/controller/web-vcr-video-frame-crop.ts',
		'src/common/editor/ui/workspace/WebVcrPanel.tsx',
		'src/common/editor/ui/workspace/desktop-editor-close-work.ts',
		'desktop/framescaper-web-vcr-contract.ts',
		'desktop/framescaper-web-vcr-electron-window.ts',
		'desktop/framescaper-web-vcr-host.ts',
		'desktop/framescaper-web-vcr-guest-security.ts',
		'desktop/framescaper-web-vcr-runtime.ts',
		'desktop/framescaper-web-vcr-runtime-support.ts',
		'desktop/framescaper-web-vcr-registration.ts',
		'desktop/framescaper-web-vcr-runtime-snapshot.ts',
		'desktop/framescaper-web-vcr-security-policy.ts',
		'tests/audio-editor-web-vcr-domain.test.ts',
		'tests/audio-editor-web-vcr-geometry.test.ts',
		'tests/audio-editor-framescaper-capture-source-adapter-router.test.ts',
		'tests/desktop-framescaper-web-vcr-host.test.ts',
		'tests/desktop-framescaper-web-vcr-guest-security.test.ts',
		'tests/desktop-framescaper-web-vcr-runtime.test.ts',
		'tests/desktop-framescaper-web-vcr-registration.test.ts',
		'tests/desktop-framescaper-web-vcr-packaged-inventory.test.js',
		'tests/audio-editor-web-vcr-snapshot-order.test.ts',
	]) assert.ok(
		framescaper.platforms['electron-enhanced'].evidence.includes(path),
		`Electron Enhanced inventory needs dormant Web VCR evidence from ${path}`,
	);
	assert.equal(capabilities.products.soundscaper.applicationFeatures.framescaperWebVcr, undefined);
});

test('Web VCR isolated-guest control records the narrow dormant security substrate', async () => {
	const [matrix, threatModel, privacy] = await Promise.all([
		json('config/production-security-matrix.json'),
		text('docs/production-threat-model.md'),
		text('docs/framescaper-capture-privacy.md'),
	]);
	const risk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);
	assert.match(control.summary, /integrated.*dormant.*framescaperWebVcr.*false/isu);
	assert.match(control.summary, /framescaperWebVcr.*false.*normal production artifact.*no.*guest.*capture grant/isu);
	assert.match(control.summary, /unavailable.*roadmap-gate.*without.*handshake.*guest open/isu);
	assert.match(control.summary, /persist:framescaper-web-vcr-v1.*sandbox.*context isolation.*Node.*web security/isu);
	assert.match(control.summary, /HTTPS.*about:blank.*credentials.*downloads.*permissions.*four.*popup/isu);
	assert.match(control.summary, /remote.*no preload.*IPC.*filesystem.*project.*helper.*shell.*DevTools/isu);
	assert.match(control.summary, /closed.*owner.*generation.*10-second.*single-use.*no media bytes/isu);
	assert.match(control.summary, /destroy.*guest.*popup.*before.*cookies.*cache.*site storage/isu);
	assert.match(control.summary, /720p.*1080p.*software.*4K.*unavailable.*no platform claim/isu);
	assert.match(control.summary, /packaged feasibility smoke.*TLS.*authentication.*scaled input.*owned guest.*page audio.*visual marker/isu);
	assert.match(control.summary, /Electron 43.*display.*camera.*preflight.*10-second.*metadata.*no.*camera capture.*guest-partition/isu);
	assert.match(control.summary, /milestone 8.*5B.*packaged.*runtime.*qualification.*fixture.*not qualification/isu);
	assert.match(control.summary, /no activated-product.*packaged-runtime-qualification.*platform-support claim/isu);
	assertEvidence(control, [
		'desktop/framescaper-web-vcr-capture-authority.ts',
		'desktop/framescaper-web-vcr-contract.ts',
		'desktop/framescaper-web-vcr-electron-window.ts',
		'desktop/framescaper-web-vcr-guest-security.ts',
		'desktop/framescaper-web-vcr-host.ts',
		'desktop/framescaper-web-vcr-preload.ts',
		'desktop/framescaper-web-vcr-registration.ts',
		'desktop/framescaper-web-vcr-runtime-snapshot.ts',
		'desktop/framescaper-web-vcr-runtime.ts',
		'desktop/framescaper-web-vcr-runtime-support.ts',
		'desktop/framescaper-web-vcr-security-policy.ts',
		'desktop/framescaper-web-vcr-target-observer.ts',
		'desktop/framescaper-capture-registration.mjs',
		'src/common/editor/web-vcr-domain.ts',
		'src/common/editor/web-vcr-geometry.ts',
		'src/common/editor/controller/framescaper-capture-app-composition.ts',
		'src/common/editor/controller/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/framescaper-web-vcr-snapshot-order.ts',
		'src/common/editor/ui/workspace/desktop-editor-close-work.ts',
		'tests/desktop-framescaper-web-vcr-authority.test.ts',
		'tests/desktop-framescaper-web-vcr-contract.test.ts',
		'tests/desktop-framescaper-web-vcr-guest-security.test.ts',
		'tests/desktop-framescaper-web-vcr-host.test.ts',
		'tests/desktop-framescaper-web-vcr-runtime.test.ts',
		'tests/desktop-framescaper-web-vcr-registration.test.ts',
		'tests/desktop-framescaper-web-vcr-packaged-inventory.test.js',
		'tests/desktop-framescaper-web-vcr-security-policy.test.ts',
		'tests/desktop-framescaper-web-vcr-target-observer.test.ts',
		'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		'tests/audio-editor-framescaper-capture-source-adapter-router.test.ts',
		'tests/audio-editor-web-vcr-snapshot-order.test.ts',
		'tests/audio-editor-desktop-close-capture-work.test.ts',
		'tests/desktop-framescaper-capture-registration.test.js',
		'tests/production-security-framescaper-web-vcr-policy.test.js',
	]);
	assert.match(threatModel, new RegExp(`policy-narrative:${CONTROL_ID}`, 'u'));
	assert.match(privacy, /Web VCR.*software substrate.*disabled.*framescaperWebVcr.*false/isu);
	assert.match(privacy, /persistent profile.*URL.*title.*login.*crop gesture.*diagnostic.*project state/isu);
	assert.match(privacy, /deterministic.*HTTPS fixture.*evidence only.*not.*platform.*qualification/isu);
});

test('Web VCR quality records inherit capture budgets without claiming qualification', async () => {
	const quality = await json('config/quality-budgets.json');
	const environment = quality.environments.find(({ id }) => id === ENVIRONMENT_ID);
	const fixture = quality.fixtures.find(({ id }) => id === FIXTURE_ID);
	const workload = quality.workloads.find(({ id }) => id === WORKLOAD_ID);
	assert.equal(environment?.status, 'unprovisioned');
	assert.equal(environment?.qualificationEligible, false);
	assert.equal(fixture?.status, 'provisional');
	assert.equal(fixture?.specification.certificateSha256,
		'338b8e455fa680fbb281823d0d334e58e632f68ecf69c628b2a5583664402f61');
	assert.match(fixture?.limitation, /evidence only.*(?:not|no).*qualification/iu);
	assert.equal(workload?.status, 'provisional');
	assert.deepEqual(workload?.fixtureIds, [FIXTURE_ID]);
	assert.deepEqual(workload?.environmentIds, [ENVIRONMENT_ID]);
	assert.equal(quality.qualification.qualifiedWorkloadIds.includes(WORKLOAD_ID), false);

	const capture = quality.workloads.find(({ id }) => id === 'm8a-capture-long-session');
	const inherited = new Map(capture.thresholds.map(({ metricId, comparison, value, unit }) => [
		metricId.slice('capture.'.length), { comparison, value, unit },
	]));
	const webVcr = new Map(workload.thresholds.map(({ metricId, comparison, value, unit }) => [
		metricId.slice('webVcr.'.length), { comparison, value, unit },
	]));
	for (const metric of [
		'avDriftMaximumMs', 'droppedFrameRatio', 'unreportedDroppedFrames',
		'audioDropoutFrames', 'deviceTeardownP95Ms', 'unrecoverableDurableFragments',
		'unauthorizedDeviceOpens',
	]) assert.deepEqual(webVcr.get(metric), inherited.get(metric), metric);
	assert.deepEqual(webVcr.get('exactSurfaceMismatches'), { comparison: 'eq', value: 0, unit: 'count' });
	assert.deepEqual(webVcr.get('encoderCropMismatches'), { comparison: 'eq', value: 0, unit: 'count' });
	assert.deepEqual(webVcr.get('retainedUncroppedProjectAssets'), {
		comparison: 'eq', value: 0, unit: 'count',
	});
});

test('Web VCR roadmap and owning plan report implemented-but-disabled truthfully', async () => {
	const [roadmap, plan] = await Promise.all([
		text('roadmap.md'), text('docs/post-milestone-8-web-vcr-plan.md'),
	]);
	const section = roadmap.slice(
		roadmap.indexOf('## 8+. Post-milestone-8 Framescaper Web VCR extension'),
		roadmap.indexOf('## 9. Final convergence and qualification'),
	);
	assert.match(section, /Status:.*Implemented.*provisional.*disabled/isu);
	assert.match(section, /framescaperWebVcr.*false/isu);
	assert.match(section, /milestone 8.*milestone-5B.*activation.*blocked/isu);
	assert.match(section, /720p.*1080p.*software substrate.*no platform claim/isu);
	assert.match(section, /4K.*unavailable/isu);
	assert.match(section, /deterministic.*HTTPS fixture.*not.*qualification/isu);
	assert.match(section, /packaged feasibility.*qualification.*false.*720p.*1080p/isu);
	assert.match(plan, /Implementation status.*implemented.*disabled/isu);
	assert.match(plan, /framescaperWebVcr.*false.*normal production/isu);
	assert.match(plan, /packaged feasibility.*720p.*1080p.*qualification.*false/isu);
	assert.match(plan, /real-runtime matrix.*remain open.*4K.*unavailable/isu);
	assert.match(plan, /loopback HTTPS fixture.*evidence only.*not.*qualification/isu);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.ok(evidence.has(path), path);
}
