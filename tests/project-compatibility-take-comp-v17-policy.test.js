/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('family-v1 policy records native Soundscaper take/comp and read-only Framescaper preservation', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-take-comp-v17-preservation');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.equal(rule.policyAuthority, 'family-v1-active');
	assert.match(
		rule.requiredOutcome,
		/exact owning-family v1 take\/comp state.*closed.*bounded.*canonical.*native and writable in Soundscaper.*known unavailable and read-only in Framescaper.*Publisher substitution.*rendered fallback reject/isu,
	);
	assert.match(
		rule.currentBehavior,
		/family v1 alone.*takeGroups.*sequence.*audio track.*positive sample range.*stable lane order.*audio sources.*non-overlapping comp regions/isu,
	);
	assert.match(
		rule.currentBehavior,
		/soundscaper\.take-comp.*org\.soundscaper\.capability\.take-comp.*bypass.*fallback null.*empty state invents no requirement/isu,
	);
	assert.match(
		rule.currentBehavior,
		/true in Soundscaper.*available\/native.*false but registered in Framescaper.*unavailable\/bypassed.*intrinsically read-only.*excluded from both audio and video rendered-fallback/isu,
	);
	assert.match(
		rule.currentBehavior,
		/Tracks-menu dialog.*Clipboard V4.*current-format \.scape collision copy.*fresh Soundscaper family-v1 desktop-library reopen.*no foreign-family edit or shared-catalog authority/isu,
	);
	assert.match(
		rule.currentBehavior,
		/Record loop into takes.*writable exact owning-family v1.*complete pass.*interrupted partial final pass.*exact two-lane family-v1.*durable-routed-take-cycle-capture-and-recovery/isu,
	);

	const evidence = new Set(rule.evidence);
	for (const reference of [
		'src/common/editor/take-comp-domain.ts',
		'src/common/editor/take-comp-document-v17.ts',
		'src/soundscaper/editor-project.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/soundscaper/editor-project-commands.ts',
		'src/framescaper/editor-project.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/audio-editor-scape-v1-baseline.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
	]) {
		assert.equal(evidence.has(reference), true, reference);
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.equal([...evidence].some((path) => /project-v17|project-library-v\d+/u.test(path)), false);

	assert.equal(rule.historicalPreFreezeNarrative?.status, 'provenance-only-not-runtime-authority');
	assert.match(rule.historicalPreFreezeNarrative?.currentBehavior ?? '', /V17 alone.*fresh desktop V9/isu);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /policy-narrative:take-comp-v17-preservation.*family v1 alone.*takeGroups/isu);
	assert.match(documentation, /fresh Soundscaper family-v1 desktop-library reopen.*no foreign-family edit or shared-catalog authority/isu);
});
