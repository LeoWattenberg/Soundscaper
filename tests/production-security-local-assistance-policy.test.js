/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertOrderedClaim } from './helpers/ordered-evidence-claim.js';

const repositoryUrl = new URL('../', import.meta.url);

async function readJson(path) {
	return JSON.parse(await readFile(new URL(path, repositoryUrl), 'utf8'));
}

async function readText(path) {
	return readFile(new URL(path, repositoryUrl), 'utf8');
}

test('local-assistance policy records conditional workflow activation and its machine gates', async () => {
	const [matrix, threatModel, activation, historicalEvidence] = await Promise.all([
		readJson('config/production-security-matrix.json'),
		readText('docs/policies/security.md'),
		readText('docs/architecture/local-assistance.md'),
		readText('docs/reference/local-model-provenance.md'),
	]);
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = ipcRisk?.currentControls.find(
		({ id }) => id === 'local-assistance-pathless-operation-bridge',
	);
	const threatClaims = compact(threatModel);
	const activationClaims = compact(activation);
	const historicalClaims = compact(historicalEvidence);
	const supplyControl = matrix.risks.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'digest-pinned-local-model-catalog-and-authenticated-store');
	const diagnosticsRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'local-assistance-runtime-diagnostics');
	const externalExecutableRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'external-ffmpeg-selected-executable-authority');

	assert.match(matrix.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.ok(matrix.groundedAt >= '2026-10-02');
	assert.ok(control);
	assertOrderedClaim(control.summary,
		/Parakeet.*speech-recognition.*Silero.*voice-activity-detection.*Pyannote.*ERes2Net.*speaker-diarization.*authenticated Sherpa/isu);
	assertOrderedClaim(control.summary,
		/model-free shot-detection.*current.*external FFmpeg.*exact.*pair.*scdet.*canary/isu);
	assert.match(control.summary,
		/AssistanceWorkflow.*aggregate fence.*guided recipes.*Advanced.*fifteen primitive operations/isu);
	assertOrderedClaim(control.summary,
		/Whisper.*alignment.*enhancement.*TIGER.*PANNs.*Beat This.*TransNetV2.*embedding.*OCR.*reframe.*highlight.*Qwen/isu);
	assertOrderedClaim(control.summary,
		/Retained Linux x64 conversions.*both Beat This checkpoints.*passing source-framework parity.*selected-target.*immutable R2 archive.*distribution manifest.*packages omit.*Model Manager installation.*first execution.*exact catalog entry/isu);
	assert.match(control.summary,
		/EU R2 release gates.*immutable publication.*full-digest public read-back.*model and target runtime archive/isu);
	assertOrderedClaim(control.summary,
		/explicit reviewed acceptance.*content-addressed transcript body.*cleanup.*speaker attribution.*derived audio.*reactions.*beats.*tempo.*shot.*indexes.*reframe.*secondary sequences/isu);
	assert.match(control.summary,
		/owner-device observations.*unrecorded.*owner QA.*optional.*nonblocking/isu);
	assertOrderedClaim(control.summary,
		/licensing.*catalog publication.*artifact digest.*runtime.*selected-media.*consent.*fail[- ]closed/isu);
	for (const path of [
		'desktop/assistance-workflow-service.ts',
		'desktop/assistance-runtime-family-manifest.ts',
		'desktop/assistance-workflow-operation-stage-runtime.ts',
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'desktop/external-ffmpeg-shot-detector.ts',
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/assistance/workflow-fence-v1.ts',
		'src/common/editor/assistance/workflow-recipes.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-transcript-acceptance.ts',
		'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts',
		'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-index-publication.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-cleanup-acceptance.ts',
		'src/common/editor/assistance/transcript-scape-asset-extension-v1.ts',
		'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		'tests/audio-editor-local-assistance-range-label-acceptance.test.ts',
		'tests/audio-editor-local-assistance-shot-acceptance.test.ts',
		'tests/audio-editor-local-assistance-cleanup-acceptance.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
	]) assert.ok(control.evidence.some(({ path: evidencePath }) => evidencePath === path), path);

	assertOrderedClaim(threatClaims,
		/Parakeet.*speech[- ]recognition.*Silero.*voice[- ]activity.*diarization.*Pyannote.*ERes2Net/isu);
	assertOrderedClaim(threatClaims,
		/external FFmpeg.*shot.*admission.*scdet.*canary.*typed unavailable/isu);
	assertOrderedClaim(threatClaims,
		/AssistanceWorkflow.*aggregate.*fence.*Guided.*Advanced.*runtime families/isu);
	assertOrderedClaim(threatClaims,
		/GPU-capable runtime families.*Whisper.*TIGER.*PANNs.*Beat This.*TransNetV2.*OCR.*Qwen.*selected-target GPU\/CPU engine.*generated file manifest/isu);
	assertOrderedClaim(threatClaims,
		/semantic review.*explicit acceptance.*transcript.*cleanup.*speaker.*derived audio.*reactions.*beats.*tempo.*shots.*indexes.*reframe.*highlight/isu);
	assert.match(threatClaims,
		/No complete five-target packaged privacy\/cancellation workload or owner-device observation set.*Optional owner QA does not grant runtime authority/isu);
	assert.ok(supplyControl);
	assertOrderedClaim(supplyControl.summary,
		/stream.*disk.*multipart.*public.*SHA-256 read-back.*machine-verified catalog output.*recorded per artifact.*unit tests.*do not establish remote availability/isu);
	assertOrderedClaim(supplyControl.summary,
		/reviewed wav2vec2.*TIGER.*PANNs.*Beat This.*TransNetV2.*Qwen3.*Dereverb.*complete versioned notices.*immutable public read-back.*catalog tasks recompute.*canonical offered entry.*ready.*all five selected-target runtime closures.*no assistance native payloads/isu);
	for (const path of [
		'config/milestone-7-model-catalog-tasks.json',
		'scripts/models/milestone-7-model-catalog-tasks.mjs',
		'tests/milestone-7-model-catalog-tasks.test.mjs',
	]) assert.ok(supplyControl.evidence.some(({ path: evidencePath }) =>
		evidencePath === path), path);
	assert.ok(diagnosticsRisk);
	assertOrderedClaim(diagnosticsRisk.exposure,
		/Retained Linux x64 conversions.*TIGER.*both Beat This checkpoints.*passing source-framework\/ONNX comparisons.*direct production-worker smoke.*target closures.*ASAR distribution manifest.*packages omit.*Model Manager installation.*first use/isu);
	assert.match(diagnosticsRisk.exposure,
		/do not create an operating-system sandbox.*No complete five-target.*Optional owner QA does not grant runtime authority/isu);
	assertOrderedClaim(diagnosticsRisk.requiredControl,
		/digest-pinned catalog entries.*verified converted artifacts and parity.*exact selected-target native runtime closure.*artifact.*platform.*selected-media.*consent check/isu);
	assert.ok(externalExecutableRisk);
	assertOrderedClaim(externalExecutableRisk.exposure,
		/assistance shot.*scdet.*canary.*path-based runners.*replacement.*dynamically loaded libraries/isu);
	assertOrderedClaim(activationClaims,
		/workflow becomes available only when all of these agree.*missing or mismatched condition returns a typed unavailable result.*never causes.*implicit installation.*substitute model.*fail closed.*Owner-device observations are optional QA/isu);
	assertOrderedClaim(historicalClaims,
		/local-models.*distribution gate is enabled.*only a complete evidence row.*distributionStatus.*permitted.*catalog contains 22 published identities/isu);
});

function compact(value) {
	return value.replace(/\s+/gu, ' ');
}

test('capability inventory records the shared Electron-only assistance surface for both products', async () => {
	const inventory = await readJson('config/production-capabilities.json');
	assert.equal(inventory.groundedAt, '2026-08-30');
	for (const productId of ['soundscaper', 'framescaper']) {
		const surface = inventory.products[productId].platforms['electron-only'];
		assert.equal(surface.status, 'partial');
		for (const path of [
			'desktop/local-model-catalog-integrity.ts',
			'desktop/local-model-store.ts',
			'desktop/assistance-operation-service.ts',
			'desktop/assistance-workflow-service.ts',
			'desktop/assistance-runtime-family-manifest.ts',
			'src/common/editor/assistance/workflow.ts',
			'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts',
			'desktop/assistance-sherpa-recognizer.ts',
			'src/common/editor/ui/local-model-manager-menu.ts',
			'src/common/editor/ui/local-assistance-menu.ts',
			'src/common/editor/controller/assistance/internal/local-assistance-transcript-acceptance.ts',
			'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		]) assert.ok(surface.evidence.includes(path), `${productId} is missing ${path}`);
	}
});

test('all-model GPU policy records authenticated providers, CPU fallback, legacy archives, and target-validation limits', async () => {
	const matrix = await readJson('config/production-security-matrix.json');
	const control = matrix.risks.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'authenticated-local-assistance-gpu-execution');
	assert.ok(control);
	assertOrderedClaim(control.summary,
		/GPU option.*CPU fallback.*all 22 catalog models.*all five desktop targets.*Sherpa and ONNX Runtime.*CoreML.*WebGPU.*Windows\/Linux x64 and ARM64/isu);
	assertOrderedClaim(control.summary,
		/Sherpa is source-built.*pinned ONNX Runtime 1\.29\.0 core.*WebGPU plugin.*Linux ARM64 rebuilds its Node-API binding.*Exact generated native files.*MIT licenses.*third-party notices/isu);
	assertOrderedClaim(control.summary,
		/existing menu-invoked operations.*authenticated GPU providers.*CPU fallback.*Cancellation.*authentication failures.*invalid inputs.*invalid outputs.*cleanup failures.*terminal/isu);
	assertOrderedClaim(control.summary,
		/Legacy CPU archives.*compatible.*new builds cannot omit GPU support.*CUDA and DirectML.*not packaged.*performance need separate evidence/isu);
	for (const path of [
		'desktop/assistance-sherpa-acceleration.ts',
		'scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs',
		'scripts/lib/desktop-assistance-onnx-webgpu-binding.mjs',
		'scripts/lib/desktop-assistance-onnx-native-closure.mjs',
		'config/assistance-sherpa-gpu-build.json',
		'config/assistance-onnx-node-api-build.json',
		'config/assistance-onnx-webgpu-plugin.json',
		'tests/desktop-assistance-sherpa-gpu-adapters.test.ts',
		'tests/desktop-assistance-all-model-gpu-capabilities.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
});
