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

test('Milestone 7 policy activates only implemented assistance while qualification stays open', async () => {
	const [matrix, threatModel, roadmap, plan, activation, historicalEvidence] = await Promise.all([
		readJson('config/production-security-matrix.json'),
		readText('docs/production-threat-model.md'),
		readText('roadmap.md'),
		readText('docs/milestone-7-plan.md'),
		readText('docs/milestone-7-8a-activation-plan.md'),
		readText('docs/milestone-7-local-model-evidence.md'),
	]);
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = ipcRisk?.currentControls.find(
		({ id }) => id === 'local-assistance-pathless-operation-bridge',
	);
	const threatClaims = compact(threatModel);
	const roadmapClaims = compact(roadmap);
	const planClaims = compact(plan);
	const activationClaims = compact(activation);
	const historicalClaims = compact(historicalEvidence);

	assert.ok(control);
	assert.match(control.summary,
		/only.*authenticated Parakeet.*speech-recognition.*every other.*adapter-unavailable/isu);
	assert.match(control.summary,
		/explicit reviewed acceptance.*AssistanceProposalSession.*content-addressed transcript body.*label track.*one undoable.*rolls back/isu);
	assert.match(control.summary,
		/manual.*owner-lab qualification.*documentary.*nonblocking.*pending.*unprovisioned/isu);
	assert.match(control.summary,
		/licensing.*catalog signature.*artifact digest.*runtime.*selected-media.*consent.*fail[- ]closed/isu);
	for (const path of [
		'src/common/editor/controller/local-assistance-transcript-acceptance.ts',
		'src/common/editor/assistance/transcript-scape-asset-extension-v1.ts',
		'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
	]) assert.ok(control.evidence.some(({ path: evidencePath }) => evidencePath === path), path);

	assert.match(threatClaims,
		/Only authenticated Parakeet speech recognition.*every other closed operation.*typed unavailable/isu);
	assert.match(threatClaims,
		/explicit reviewed acceptance.*content-addressed transcript body.*label track.*one undoable.*stale.*rolls back/isu);
	assert.match(threatClaims,
		/manual.*owner-lab.*documentary.*nonblocking.*pending.*unprovisioned/isu);

	assert.match(roadmapClaims,
		/Status:.*Active on selected Soundscaper S30 and Framescaper F31.*operation coverage is partial/isu);
	assert.match(roadmapClaims,
		/only.*Parakeet.*speech-recognition.*reviewed Parakeet transcript.*content-addressed.*label track.*one undoable/isu);
	assert.match(roadmapClaims,
		/every other operation.*typed unavailable.*manual.*nonblocking.*qualification.*open/isu);
	assert.match(planClaims,
		/Activation status \(2026-08-26\).*partial.*Parakeet.*review.*accept.*content-addressed.*label track/isu);
	assert.match(planClaims,
		/other.*operation.*unavailable.*manual.*nonblocking.*hard fail-closed/isu);
	assert.match(activationClaims,
		/Delivered boundary \(2026-08-26\).*does not complete every 7A and 7B workflow/isu);
	assert.match(activationClaims,
		/Parakeet.*speech[- ]recognition.*reviewed acceptance.*transcript.*label track.*other.*adapter-unavailable/isu);
	assert.match(historicalClaims,
		/Historical slice record.*local-models.*enabled.*thirteen.*permitted/isu);
});

function compact(value) {
	return value.replace(/\s+/gu, ' ');
}

test('capability inventory records the shared Electron-only assistance surface for both products', async () => {
	const inventory = await readJson('config/production-capabilities.json');
	assert.equal(inventory.groundedAt, '2026-08-25');
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
