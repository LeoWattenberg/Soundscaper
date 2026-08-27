/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

async function readRuntimeSupplyChainRisk() {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	return matrix.risks.find(({ id }) => id === 'runtime-supply-chain');
}
test('legacy FFmpeg WASM publication remains blocked and absent from production browsers', async () => {
	const runtimeSupplyChain = await readRuntimeSupplyChainRisk();
	assert.ok(runtimeSupplyChain);
	const legacyRuntime = runtimeSupplyChain.currentControls.find(
		({ id }) => id === 'validated-ffmpeg-runtime-publication',
	);
	assert.ok(legacyRuntime);
	for (const path of [
		'THIRD_PARTY_LICENSES.md',
		'config/ffmpeg-runtime-manifest.json',
		'config/ffmpeg-runtime-publication-policy.json',
		'config/production-licensing-matrix.json',
		'scripts/lib/ffmpeg-runtime-manifest.mjs',
		'scripts/lib/ffmpeg-runtime-publisher.mjs',
		'scripts/publish-runtime-assets.mjs',
		'scripts/audit-ffmpeg-runtime.mjs',
		'scripts/lib/browser-bundle-codec-audit.mjs',
		'scripts/check-build-chunks.mjs',
		'scripts/lib/offline-service-worker.mjs',
		'tests/ffmpeg-runtime-manifest.test.js',
		'tests/ffmpeg-runtime-publisher.test.js',
		'tests/browser-bundle-codec-audit.test.js',
		'tests/offline-service-worker.test.js',
		'tests/browser/offline-ffmpeg-runtime-download.spec.js',
	]) assert.ok(legacyRuntime.evidence.some((item) => item.path === path), path);
	assert.equal(legacyRuntime.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
	assert.match(
		legacyRuntime.summary,
		/retained solely as legacy development and reproducibility tooling.*development-only dependencies.*no production artifact surface/isu,
	);
	assert.match(
		legacyRuntime.summary,
		/No production browser imports.*derives a runtime URL.*fetches.*caches.*executes FFmpeg WebAssembly/isu,
	);
	assert.match(
		legacyRuntime.summary,
		/bundle audit rejects.*package specifiers.*ffmpeg-core.*old loader.*legacy cache namespace.*service worker.*no FFmpeg.*preferences.*no runtime download/isu,
	);
	assert.match(
		legacyRuntime.summary,
		/stable publication and browser reactivation remain blocked.*independent approval attestation.*deliberate audit change/isu,
	);
	assert.match(
		legacyRuntime.summary,
		/Desktop external FFmpeg.*alternate Chromium `libffmpeg`.*distinct.*unchanged/isu,
	);

	const reactivation = runtimeSupplyChain.residualRisks.find(
		({ id }) => id === 'served-external-runtime-authentication',
	);
	assert.ok(reactivation);
	assert.match(
		reactivation.exposure,
		/development-only legacy audit machinery.*no production browser consumes.*dormant.*blocked by the bundle audit/isu,
	);
	assert.match(reactivation.requiredControl, /Before any.*reactivation.*protected approval attestation/isu);
	const attestation = runtimeSupplyChain.residualRisks.find(
		({ id }) => id === 'runtime-manifest-review-attestation',
	);
	assert.ok(attestation);
	assert.match(attestation.exposure, /self-declared.*blocked-reactivation risk.*rather than an active runtime exposure/isu);
	assert.ok(runtimeSupplyChain.residualRisks.some(({ id }) => id === 'signed-update-qualification'));
});
