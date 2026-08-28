/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);

async function readJson(path) {
	return JSON.parse(await readFile(new URL(path, repositoryUrl), 'utf8'));
}

async function readText(path) {
	return readFile(new URL(path, repositoryUrl), 'utf8');
}

test('Milestone 7 policy records conditional workflow activation and its external evidence gates', async () => {
	const [matrix, threatModel, activation, historicalEvidence] = await Promise.all([
		readJson('config/production-security-matrix.json'),
		readText('docs/production-threat-model.md'),
		readText('docs/milestone-7-8a-activation-plan.md'),
		readText('docs/milestone-7-local-model-evidence.md'),
	]);
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = ipcRisk?.currentControls.find(
		({ id }) => id === 'local-assistance-pathless-operation-bridge',
	);
	const threatClaims = compact(threatModel);
	const activationClaims = compact(activation);
	const historicalClaims = compact(historicalEvidence);
	const supplyControl = matrix.risks.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'signed-local-model-catalog-and-authenticated-store');
	const qualificationRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'local-assistance-runtime-qualification');
	const externalExecutableRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'external-ffmpeg-selected-executable-authority');

	assert.equal(matrix.groundedAt, '2026-08-28');
	assert.ok(control);
	assert.match(control.summary,
		/Parakeet.*speech-recognition.*Silero.*voice-activity-detection.*Pyannote.*ERes2Net.*speaker-diarization.*authenticated Sherpa/isu);
	assert.match(control.summary,
		/model-free shot-detection.*current.*external FFmpeg.*exact.*pair.*scdet.*canary/isu);
	assert.match(control.summary,
		/AssistanceWorkflow.*aggregate fence.*guided recipes.*Advanced.*fifteen primitive operations/isu);
	assert.match(control.summary,
		/Whisper.*alignment.*enhancement.*TIGER.*PANNs.*Beat This.*TransNetV2.*embedding.*OCR.*reframe.*highlight.*Qwen/isu);
	assert.match(control.summary,
		/converted.*parity.*signed catalog.*target payload.*pending-external/isu);
	assert.match(control.summary,
		/explicit reviewed acceptance.*content-addressed transcript body.*cleanup.*speaker attribution.*derived audio.*reactions.*beats.*tempo.*shot.*indexes.*reframe.*secondary sequences/isu);
	assert.match(control.summary,
		/owner-lab evidence.*pending.*nonblocking/isu);
	assert.match(control.summary,
		/licensing.*catalog signature.*artifact digest.*runtime.*selected-media.*consent.*fail[- ]closed/isu);
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
		'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
		'src/common/editor/controller/local-assistance-guided-result-acceptance.ts',
		'src/common/editor/controller/local-assistance-guided-index-publication.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
		'src/common/editor/assistance/transcript-scape-asset-extension-v1.ts',
		'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		'tests/audio-editor-local-assistance-range-label-acceptance.test.ts',
		'tests/audio-editor-local-assistance-shot-acceptance.test.ts',
		'tests/audio-editor-local-assistance-cleanup-acceptance.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
	]) assert.ok(control.evidence.some(({ path: evidencePath }) => evidencePath === path), path);

	assert.match(threatClaims,
		/Parakeet.*speech[- ]recognition.*Silero.*voice[- ]activity.*diarization.*Pyannote.*ERes2Net/isu);
	assert.match(threatClaims,
		/external FFmpeg.*shot.*admission.*scdet.*canary.*typed unavailable/isu);
	assert.match(threatClaims,
		/AssistanceWorkflow.*aggregate.*fence.*Guided.*Advanced.*runtime families/isu);
	assert.match(threatClaims,
		/conditional.*Whisper.*TIGER.*PANNs.*Beat This.*TransNetV2.*OCR.*Qwen.*pending-external/isu);
	assert.match(threatClaims,
		/semantic review.*explicit acceptance.*transcript.*cleanup.*speaker.*derived audio.*reactions.*beats.*tempo.*shots.*indexes.*reframe.*highlight/isu);
	assert.match(threatClaims,
		/owner-lab.*remain absent.*Manual qualification.*documentary.*nonblocking/isu);
	assert.ok(supplyControl);
	assert.match(supplyControl.summary,
		/stream.*disk.*multipart.*public.*SHA-256 read-back.*external.*sign.*no real R2 write.*no remote-availability claim/isu);
	assert.ok(qualificationRisk);
	assert.match(qualificationRisk.exposure,
		/TIGER.*converted artifacts.*parity.*signed catalog.*five target.*payload closures.*Windows ARM64.*No provisioned owner-lab profile.*no five target packaged canary/isu);
	assert.ok(externalExecutableRisk);
	assert.match(externalExecutableRisk.exposure,
		/assistance shot.*scdet.*canary.*path-based runners.*replacement.*dynamically loaded libraries/isu);
	assert.match(activationClaims,
		/Delivered boundary \(2026-08-27\).*conditionally activates.*enabled for testing.*typed machine unavailability rather than substitute inference or an implicit download.*remain fail closed.*Licensing and owner qualification are milestone-9 stable 1\.0 blockers only/isu);
	assert.match(historicalClaims,
		/Historical slice record.*local-models.*enabled.*thirteen.*permitted/isu);
});

function compact(value) {
	return value.replace(/\s+/gu, ' ');
}

test('capability inventory records the shared Electron-only assistance surface for both products', async () => {
	const inventory = await readJson('config/production-capabilities.json');
	assert.equal(inventory.groundedAt, '2026-08-28');
	for (const productId of ['soundscaper', 'framescaper']) {
		const surface = inventory.products[productId].platforms['electron-only'];
		assert.equal(surface.status, 'partial');
		for (const path of [
			'desktop/local-model-catalog-signature.ts',
			'desktop/local-model-store.ts',
			'desktop/assistance-operation-service.ts',
			'desktop/assistance-workflow-service.ts',
			'desktop/assistance-runtime-family-manifest.ts',
			'src/common/editor/assistance/workflow.ts',
			'src/common/editor/controller/local-assistance-guided-result-acceptance.ts',
			'desktop/assistance-sherpa-recognizer.ts',
			'src/common/editor/ui/local-model-manager-menu.ts',
			'src/common/editor/ui/local-assistance-menu.ts',
			'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
			'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		]) assert.ok(surface.evidence.includes(path), `${productId} is missing ${path}`);
	}
});
