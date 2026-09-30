/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CONTROL_ID = 'framescaper-web-vcr-dormant-isolated-guest';
const FIXTURE_ID = 'm8plus-web-vcr-loopback-https-v1';
const WORKLOAD_ID = 'm8plus-web-vcr-long-session';

test('Web VCR is enabled for ordinary Framescaper testing', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.applicationFeatures.framescaperWebVcr, true);
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'partial');
	for (const path of [
		'src/common/editor/web-vcr-domain.ts',
		'src/common/editor/web-vcr-geometry.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-controller.ts',
		'src/common/editor/controller/capture/framescaper-web-vcr-controller-types.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-snapshot-order.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/capture/internal/web-vcr/web-vcr-recorder-factory.ts',
		'src/common/editor/controller/capture/internal/web-vcr/web-vcr-video-frame-crop.ts',
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
		`Electron Enhanced inventory needs Web VCR evidence from ${path}`,
	);
	assert.equal(capabilities.products.soundscaper.applicationFeatures.framescaperWebVcr, undefined);
});

test('Web VCR isolated-guest control records the active lazy security boundary', async () => {
	const [matrix, threatModel, captureDocumentation, webVcrDocumentation] = await Promise.all([
		json('config/production-security-matrix.json'),
		text('docs/policies/security.md'),
		text('docs/features/framescaper-capture.md'),
		text('docs/features/framescaper-web-vcr.md'),
	]);
	const risk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);
	assert.match(control.summary, /integrated.*active.*framescaperWebVcr.*true/isu);
	assert.match(control.summary, /default-hidden.*Record.*no.*guest.*until.*direct user.*summon/isu);
	assert.match(control.summary, /persist:framescaper-web-vcr-v1.*sandbox.*context isolation.*Node.*web security/isu);
	assert.match(control.summary, /HTTPS.*about:blank.*credentials.*downloads.*permissions.*four.*popup/isu);
	assert.match(control.summary, /remote.*no preload.*IPC.*filesystem.*project.*helper.*shell.*DevTools/isu);
	assert.match(control.summary, /closed.*owner.*generation.*10-second.*single-use.*no media bytes/isu);
	assert.match(control.summary, /destroy.*guest.*popup.*before.*cookies.*cache.*site storage/isu);
	assert.match(control.summary, /720p.*1080p.*enabled.*4K.*unavailable.*no platform claim/isu);
	assert.match(control.summary, /packaged feasibility smoke.*TLS.*authentication.*scaled input.*owned guest.*page audio.*visual marker/isu);
	assert.match(control.summary, /Electron 43.*display.*camera.*preflight.*10-second.*metadata.*no.*camera capture.*guest-partition/isu);
	assert.match(control.summary, /optional owner QA.*never disable/isu);
	assert.match(control.summary, /diagnosticOnly.*true.*no broader runtime or platform-support claim/isu);
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
		'src/common/editor/controller/capture/framescaper-capture-app-composition.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-snapshot-order.ts',
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
	assert.match(captureDocumentation,
		/framescaperWebVcr: true.*desktop-only source adapter.*Record menu.*no guest.*direct action.*lazily/isu);
	assert.match(webVcrDocumentation,
		/persistent HTTPS authentication.*URL, page title, login state, crop gestures, and diagnostics stay out of.*project state/isu);
	assert.match(webVcrDocumentation,
		/deterministic Linux x64\/Xvfb packaged smoke.*loopback HTTPS fixture.*diagnosticOnly: true.*proves only the paths it executed.*does not establish behavior.*public providers.*other operating systems/isu);
});

test('Web VCR stays in real tests and owner QA instead of a pseudo quality workload', async () => {
	const quality = await json('config/quality-budgets.json');
	const fixture = quality.fixtures.find(({ id }) => id === FIXTURE_ID);
	const workload = quality.workloads.find(({ id }) => id === WORKLOAD_ID);
	assert.equal(fixture, undefined);
	assert.equal(workload, undefined);
	assert.equal(Object.hasOwn(quality, 'environments'), false);
	assert.equal(Object.hasOwn(quality, 'qualification'), false);
	const qa = await text('docs/operations/qa/framescaper.md');
	assert.match(qa, /Web VCR/iu);
	assert.match(qa, /conditional/iu);
});

test('Web VCR roadmap and feature contract report the current surface truthfully', async () => {
	const [roadmap, contract] = await Promise.all([
		text('roadmap.md'), text('docs/features/framescaper-web-vcr.md'),
	]);
	const section = roadmap.slice(
		roadmap.indexOf('## 8+. Post-milestone-8 Framescaper Web VCR extension'),
		roadmap.indexOf('## 8+C. Framescaper product origin and cross-product storage'),
	);
	assert.match(section, /Status:.*Implemented and enabled for testing/isu);
	assert.match(section, /framescaperWebVcr.*true/isu);
	assert.match(section, /optional Framescaper owner QA/isu);
	assert.match(section, /720p.*1080p.*enabled.*no platform claim/isu);
	assert.match(section, /4K.*unavailable/isu);
	assert.match(section, /deterministic.*HTTPS fixture.*neither establishes.*general real-runtime.*platform claim/isu);
	assert.match(section, /packaged feasibility.*720p.*1080p/isu);
	assert.match(contract, /## Current surface.*framescaperWebVcr: true.*Record flyout.*default-hidden/isu);
	assert.match(contract, /Linux x64\/Xvfb packaged smoke.*720p.*1080p.*diagnosticOnly: true/isu);
	assert.match(contract, /4K choice.*runtime\s+capture probe.*encoder backend.*capability mismatch refuses before\s+recording/isu);
	assert.match(contract, /smoke proves only the paths it executed.*does not establish behavior.*public providers.*other operating systems/isu);
	assert.match(contract, /loopback HTTPS fixture.*public websites are never CI dependencies/isu);
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
