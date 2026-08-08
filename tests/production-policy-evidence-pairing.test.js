/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);

// Security-matrix controls and compatibility rules that qualify the same
// behavior must cite the same evidence files in the same order, so an
// evidence edit that reaches only one register fails here instead of
// drifting silently.
const PAIRED_EVIDENCE = [
	{
		control: 'packaged-linux-x64-source-bearing-project-library-handoff',
		rule: 'current-desktop-packaged-source-bearing-handoff',
	},
	{
		control: 'chromium-scape-mixed-media-handoff',
		rule: 'current-web-scape-mixed-media-handoff',
	},
	{
		control: 'rendered-fallback-asset-integrity',
		rule: 'current-scape-rendered-fallback-integrity',
	},
];

function findEvidenceCarrier(value, id) {
	if (Array.isArray(value)) {
		for (const entry of value) {
			const found = findEvidenceCarrier(entry, id);
			if (found) return found;
		}
		return null;
	}
	if (!value || typeof value !== 'object') return null;
	if (value.id === id && Array.isArray(value.evidence)) return value;
	for (const entry of Object.values(value)) {
		const found = findEvidenceCarrier(entry, id);
		if (found) return found;
	}
	return null;
}

test('paired security-matrix controls and compatibility rules cite identical evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const compatibility = JSON.parse(await readFile(compatibilityUrl, 'utf8'));

	for (const { control: controlId, rule: ruleId } of PAIRED_EVIDENCE) {
		const control = findEvidenceCarrier(matrix, controlId);
		const rule = findEvidenceCarrier(compatibility, ruleId);
		assert.ok(control, `security-matrix control ${controlId} exists`);
		assert.ok(rule, `compatibility rule ${ruleId} exists`);
		for (const entry of control.evidence) {
			assert.equal(typeof entry.kind, 'string', `${controlId} evidence entries carry a kind`);
			assert.equal(typeof entry.path, 'string', `${controlId} evidence entries carry a path`);
		}
		assert.deepEqual(
			rule.evidence,
			control.evidence.map(({ path }) => path),
			`${ruleId} evidence must mirror ${controlId} evidence in order`,
		);
	}
});
