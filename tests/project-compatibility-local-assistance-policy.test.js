/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('compatibility policy records family-qualified local-assistance custody', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const localAssistance = policy.rules.find(
		(rule) => rule.id === 'current-local-assistance-transcript-custody',
	);
	assert.ok(localAssistance);
	assert.equal(localAssistance.policyAuthority, 'family-v1-active');
	assert.match(
		localAssistance.requiredOutcome,
		/Soundscaper family v1.*Framescaper family v1.*explicitly reviewed.*aggregate-fenced.*ordinary editable state.*bounded assistance bodies and derivatives.*family-qualified custody.*deterministic editing.*unavailable/isu,
	);
	assert.match(
		localAssistance.currentBehavior,
		/Both family-v1 products.*closed assistanceAssets collection.*independently versioned AssistanceWorkflow v1 bridge/isu,
	);
	assert.match(
		localAssistance.currentBehavior,
		/Main-owned consent and publication fences.*schemaFamily, projectId.*project revision.*selected media.*model\/runtime inputs.*accepted output.*ordinary one-step project commands/isu,
	);
	assert.match(
		localAssistance.currentBehavior,
		/Missing model, runtime, platform, conversion, or catalog authority.*typed unavailability/isu,
	);
	assert.match(localAssistance.currentBehavior, /Pre-release numeric product schemas.*not.*authority or custody route/isu);
	for (const reference of localAssistance.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.deepEqual(localAssistance.evidence, [
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/controller/local-assistance-guided-result-acceptance.ts',
		'src/soundscaper/editor-project.ts',
		'src/framescaper/editor-project-assistance.ts',
		'tests/audio-editor-assistance-workflow-contract.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
	]);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /Current local-assistance transcript custody.*Both family-v1 products.*AssistanceWorkflow v1/isu);
	assert.match(documentation, /schemaFamily, projectId.*typed unavailability.*Pre-release numeric product schemas.*not an assistance authority/isu);
});
