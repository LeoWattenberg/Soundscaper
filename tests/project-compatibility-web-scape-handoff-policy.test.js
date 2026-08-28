/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const securityUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('pre-freeze web Scape handoff evidence is provenance only', async () => {
	const [compatibility, security] = await Promise.all([
		readFile(compatibilityUrl, 'utf8').then(JSON.parse),
		readFile(securityUrl, 'utf8').then(JSON.parse),
	]);
	const rule = compatibility.rules.find(({ id }) => id === 'current-web-scape-mixed-media-handoff');
	const risk = security.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(({ id }) => id === 'chromium-scape-mixed-media-handoff');

	for (const row of [rule, control]) {
		assert.ok(row);
		assert.equal(row.policyAuthority, 'historical-provenance-only');
		assert.match(row.requiredOutcome ?? row.summary, /no family-v1.*authority/iu);
		assert.equal(
			row.historicalPreFreezeNarrative?.status,
			'provenance-only-not-runtime-authority',
		);
	}
	assert.match(
		rule.historicalPreFreezeNarrative.currentBehavior,
		/two frozen web workflows.*Soundscaper.*Framescaper.*Chromium/isu,
	);
});

test('current Scape authority is the tuple-routed format-1 baseline', async () => {
	const compatibility = JSON.parse(await readFile(compatibilityUrl, 'utf8'));
	assert.equal(compatibility.portableArchive.currentFormatVersion, 1);
	assert.deepEqual(compatibility.portableArchive.manifestProjectIdentity, [
		'schemaFamily', 'schemaVersion',
	]);
	assert.equal(
		compatibility.forwardReadOnly.portableArchiveStatus,
		'implemented-byte-exact-save-copy',
	);
});
