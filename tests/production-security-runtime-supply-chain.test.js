/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

async function readRuntimeSupplyChainRisk() {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	return matrix.risks.find(({ id }) => id === 'runtime-supply-chain');
}

test('runtime publication controls and residual risks stay represented in the security matrix', async () => {
	const runtimeSupplyChain = await readRuntimeSupplyChainRisk();
	assert.ok(runtimeSupplyChain);
	const validatedRuntime = runtimeSupplyChain.currentControls.find(
		({ id }) => id === 'validated-ffmpeg-runtime-publication',
	);
	assert.ok(validatedRuntime);
	for (const path of [
		'.gitattributes',
		'THIRD_PARTY_LICENSES.md',
		'Technical_README.md',
		'config/ffmpeg-runtime-manifest.json',
		'config/ffmpeg-runtime-publication-policy.json',
		'config/production-licensing-matrix.json',
		'config/release-severity-policy.json',
		'desktop/ffmpeg-corresponding-source.json',
		'docs/production-licensing-policy.md',
		'r2-cors.json',
		'scripts/lib/ffmpeg-runtime-manifest.mjs',
		'scripts/lib/ffmpeg-runtime-publisher.mjs',
		'scripts/lib/cloudflare-runtime-cache.mjs',
		'scripts/lib/pages-deploy-preflight.mjs',
		'scripts/configure-ffmpeg-runtime-cache.mjs',
		'scripts/preflight-pages-deploy.mjs',
		'scripts/publish-runtime-assets.mjs',
		'src/common/editor/ffmpeg.js',
		'vite.config.mjs',
		'scripts/audit-ffmpeg-runtime.mjs',
		'tests/ffmpeg-runtime-manifest.test.js',
		'tests/ffmpeg-runtime-publisher.test.js',
		'tests/cloudflare-runtime-cache.test.js',
		'tests/pages-deploy-preflight.test.js',
		'tests/ffmpeg-runtime-public-policy.test.ts',
	]) assert.ok(validatedRuntime.evidence.some((item) => item.path === path));
	assert.match(
		validatedRuntime.summary,
		/self-consistent Web FFmpeg runtime policy manifest.*package and lock identity.*JavaScript and WebAssembly byte lengths.*SHA-256.*R2 bucket and base prefix.*content types.*immutable cache metadata.*CORS policy.*corresponding-source descriptor.*aggregate notice.*licensing and security matrices.*threat model.*LF checkout rules.*central.*public-origin.*cache.*rule-ref policy.*Web publisher.*full-manifest-SHA release prefix and no-store final pointer.*before the publisher invokes Wrangler.*private snapshot.*conditional.*read-back.*strong-ETag.*CAS.*rollback.*stable-ref.*Cache Rules.*Pages.*preflight.*desktop build and release assemblers do not consume this runtime.*separate desktop package-integrity control proves their absence.*do not authenticate independent human approval/isu,
	);
	assert.match(validatedRuntime.summary, /content types.*runtime.*manifest.*notice.*corresponding-source.*pointer/isu);
	assert.match(validatedRuntime.summary, /unavailable marker.*concurrent writer.*without.*unconditional delete/isu);
	assert.match(validatedRuntime.summary, /unrelated rule order.*owned.*rules last.*cannot override/isu);
	assert.match(validatedRuntime.summary, /pointer DYNAMIC or BYPASS.*without Age/isu);
	assert.match(validatedRuntime.summary, /reject.*mutable FFmpeg base override.*full-manifest digest/isu);
	assert.equal(runtimeSupplyChain.residualRisks.some(
		({ id }) => id === 'external-runtime-publication',
	), false);
	assert.ok(runtimeSupplyChain.residualRisks.some(
		({ id }) => id === 'served-external-runtime-authentication',
	));
	assert.ok(runtimeSupplyChain.residualRisks.some(
		({ id }) => id === 'runtime-manifest-review-attestation',
	));
	assert.equal(runtimeSupplyChain.residualRisks.some(
		({ id }) => id === 'desktop-runtime-package-copy-integrity',
	), false);
	assert.ok(runtimeSupplyChain.residualRisks.some(
		({ id }) => id === 'signed-update-qualification',
	));
});
