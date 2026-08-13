/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const compatibilityDocumentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const inventoryUrl = new URL('../config/milestone-2-closure.json', import.meta.url);
const securityMatrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

const workflowIds = [
	'web-soundscaper-to-framescaper-to-soundscaper-scape',
	'web-framescaper-to-soundscaper-to-framescaper-scape',
];

test('web Scape handoff policy closes both frozen cross-product workflows', async () => {
	const [compatibility, documentation, inventory, matrix, threatModel] = await Promise.all([
		readFile(compatibilityUrl, 'utf8').then(JSON.parse),
		readFile(compatibilityDocumentationUrl, 'utf8'),
		readFile(inventoryUrl, 'utf8').then(JSON.parse),
		readFile(securityMatrixUrl, 'utf8').then(JSON.parse),
		readFile(threatModelUrl, 'utf8'),
	]);
	const rule = compatibility.rules.find(({ id }) => id === 'current-web-scape-mixed-media-handoff');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.deepEqual(rule.evidence, ['tests/browser/audio-editor-scape-product-roundtrip.spec.js']);
	assert.match(
		rule.requiredOutcome,
		/two frozen web workflow IDs.*legacy exact-schema-17 evidence.*isolated browser profiles.*mixed-media project identity.*exact required media.*activation.*playback.*history-visible recipient edit.*save.*return/iu,
	);
	assert.match(
		rule.currentBehavior,
		/maintained Chromium UI spec.*three isolated browser contexts.*Soundscaper.*Framescaper.*Soundscaper.*Framescaper.*Soundscaper.*Framescaper.*canonical PCM.*generated WebM.*browser-download `.scape`.*every manifest asset.*exact byte length and SHA-256.*fresh recipient.*same project ID.*audio and video clips.*starts and stops transport.*native track-name input.*Undo.*explicit.*Save project.*returning archive.*exact asset descriptor set.*fresh origin-product context.*edited track name.*playback/iu,
	);
	assert.match(
		rule.currentBehavior,
		/fixed small first-party fixture.*Chromium.*does not qualify.*File System Access.*Firefox.*WebKit.*Safari.*long-form.*codec coverage.*rendered fallbacks.*linked or unmanaged media.*quota.*eviction.*crash/iu,
	);

	const handoff = inventory.items.find(({ id }) => id === 'm2-handoff-packaged-roundtrip');
	assert.equal(handoff.status, 'implemented');
	assert.deepEqual(handoff.completedWorkflowIds, handoff.workflowIds);
	assert.deepEqual(handoff.completedWorkflowIds.slice(0, 2), workflowIds);

	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(({ id }) => id === 'chromium-scape-mixed-media-handoff');
	assert.ok(control);
	assert.deepEqual(control.evidence, [{
		kind: 'test', path: 'tests/browser/audio-editor-scape-product-roundtrip.spec.js',
	}]);
	assert.match(
		control.summary,
		/maintained Chromium browser workflow.*two frozen web `.scape` workflow IDs.*three isolated browser contexts.*browser-download archive.*exact project ID.*verifies every manifest asset body.*byte length and SHA-256.*activates both clips.*starts and stops transport.*undoable track-name edit.*native input.*explicit save.*return archive/iu,
	);

	assert.match(
		documentation.replace(/\s+/gu, ' '),
		/maintained Chromium browser spec.*two frozen web `.scape` workflow IDs.*three isolated browser contexts.*exact project ID.*manifest asset.*byte length and SHA-256.*starts and stops transport.*track name.*Undo.*explicit save.*fresh origin-product context/isu,
	);
	assert.match(
		threatModel.replace(/\s+/gu, ' '),
		/maintained Chromium browser workflow.*two frozen web `.scape` workflow IDs.*three isolated browser contexts.*exact project ID.*manifest asset.*byte length and SHA-256.*starts and stops transport.*undoable track-name edit.*explicit save.*fresh origin-product context/isu,
	);
	for (const text of [rule.currentBehavior, documentation, control.summary, threatModel]) {
		assert.doesNotMatch(text, /two web `.scape` workflow IDs? remain open/iu);
	}
});
