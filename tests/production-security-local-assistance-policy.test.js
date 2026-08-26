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

test('Milestone 7 policy activates only bounded reviewed assistance while qualification stays open', async () => {
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

	assert.equal(matrix.groundedAt, '2026-08-26');
	assert.ok(control);
	assert.match(control.summary,
		/authenticated Sherpa.*Parakeet.*speech-recognition.*Silero.*voice-activity-detection.*Pyannote.*ERes2Net.*speaker-diarization/isu);
	assert.match(control.summary,
		/model-free shot-detection.*current.*external FFmpeg.*exact.*pair.*scdet.*canary/isu);
	assert.match(control.summary,
		/remaining eleven.*adapter-unavailable.*without.*substitute.*fabricated/isu);
	assert.match(control.summary,
		/explicit reviewed acceptance.*AssistanceProposalSession.*content-addressed transcript body.*label track.*anonymous.*Silences.*Speakers.*shot.*timeline-annotation markers.*transcript cleanup.*link-aware.*ripple-delete.*A\/V link membership/isu);
	assert.match(control.summary,
		/manual.*owner-lab qualification.*documentary.*nonblocking.*pending.*unprovisioned/isu);
	assert.match(control.summary,
		/licensing.*catalog signature.*artifact digest.*runtime.*selected-media.*consent.*fail[- ]closed/isu);
	for (const path of [
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'desktop/external-ffmpeg-shot-detector.ts',
		'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
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
		/Parakeet.*speech[- ]recognition.*Silero.*voice[- ]activity.*Pyannote.*ERes2Net.*speaker[- ]diarization/isu);
	assert.match(threatClaims,
		/external FFmpeg.*shot.*admission.*scdet.*canary.*typed unavailable/isu);
	assert.match(threatClaims,
		/remaining eleven.*typed unavailable.*no substitute.*fabricated/isu);
	assert.match(threatClaims,
		/semantic review.*explicit acceptance.*content-addressed transcript body.*anonymous.*Silences.*Speakers.*timeline-annotation markers.*transcript cleanup.*link-aware.*ripple-delete.*A\/V link membership/isu);
	assert.match(threatClaims,
		/manual.*owner-lab.*documentary.*nonblocking.*pending.*unprovisioned/isu);
	assert.ok(supplyControl);
	assert.match(supplyControl.summary, /no real R2 write or remote read-back.*no remote-availability claim/isu);
	assert.ok(qualificationRisk);
	assert.match(qualificationRisk.exposure,
		/no provisioned owner-lab profile or accepted cohort.*reviewed canonical acceptance.*link-aware cleanup.*anonymous.*speaker regions.*does not qualify/isu);
	assert.ok(externalExecutableRisk);
	assert.match(externalExecutableRisk.exposure,
		/assistance shot.*scdet.*canary.*path-based runners.*replacement.*dynamically loaded libraries/isu);
	assert.match(activationClaims,
		/Delivered boundary \(2026-08-26\).*does not complete every 7A and 7B workflow/isu);
	assert.match(historicalClaims,
		/Historical slice record.*local-models.*enabled.*thirteen.*permitted/isu);
});

function compact(value) {
	return value.replace(/\s+/gu, ' ');
}

test('capability inventory records the shared Electron-only assistance surface for both products', async () => {
	const inventory = await readJson('config/production-capabilities.json');
	assert.equal(inventory.groundedAt, '2026-08-26');
	for (const productId of ['soundscaper', 'framescaper']) {
		const surface = inventory.products[productId].platforms['electron-only'];
		assert.equal(surface.status, 'partial');
		for (const path of [
			'desktop/local-model-catalog-signature.ts',
			'desktop/local-model-store.ts',
			'desktop/assistance-operation-service.ts',
			'desktop/assistance-sherpa-recognizer.ts',
			'src/common/editor/ui/local-model-manager-menu.ts',
			'src/common/editor/ui/local-assistance-menu.ts',
			'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
			'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		]) assert.ok(surface.evidence.includes(path), `${productId} is missing ${path}`);
	}
});
