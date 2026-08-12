/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('V17 policy preserves take/comp state behind a bypass-only read-only boundary', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-take-comp-v17-preservation');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/Exact-schema-17 take\/comp state.*closed.*bounded.*canonical.*ownership-validated.*bypass-only no-fallback.*both products.*read-only/iu,
	);
	assert.match(
		rule.currentBehavior,
		/V17 alone.*required root takeGroups.*sequence.*audio track.*positive sample range.*stable lane order.*audio sources.*source ranges.*non-overlapping comp regions.*available take spans/iu,
	);
	assert.match(
		rule.currentBehavior,
		/closed plain-data shapes.*bounded collections.*canonical ordering.*globally unique take\/comp identities.*exact ownership.*source bounds.*group non-overlap.*deeply frozen/iu,
	);
	assert.match(
		rule.currentBehavior,
		/soundscaper\.take-comp.*org\.soundscaper\.capability\.take-comp.*Take lanes and comps.*bypass.*fallback null.*empty state invents no requirement/iu,
	);
	assert.match(
		rule.currentBehavior,
		/initially false in both Soundscaper and Framescaper.*production capability register.*unavailable\/bypassed.*incompatible.*read-only activation.*excluded from both audio and video rendered-fallback.*publisher-authored fallback.*rejects/iu,
	);
	assert.match(
		rule.currentBehavior,
		/Exact-V17 creation, clone, and raw load.*without aliases.*desktop V9 metadata 9.*SQLite user_version 11.*Soundscaper.*Framescaper.*unchanged.*preservation-only.*no take or comp authoring.*current-format \.scape nonempty-state witness/iu,
	);
	assert.deepEqual(rule.evidence, [
		'src/common/editor/take-comp-document-v17.ts',
		'src/common/editor/project-v17.ts',
		'src/common/editor/project-v17-validation.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'config/production-capabilities.json',
		'tests/audio-editor-project-v17.test.ts',
		'tests/audio-editor-foundation-feature-registration.test.ts',
		'tests/desktop-project-library-v17-take-comp-roundtrip.test.ts',
	]);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /V17 take\/comp preservation.*required root takeGroups/iu);
	assert.match(documentation, /soundscaper\.take-comp.*org\.soundscaper\.capability\.take-comp.*bypass.*fallback null/iu);
	assert.match(documentation, /false in both Soundscaper and Framescaper.*unavailable\/bypassed.*read-only activation/iu);
	assert.match(documentation, /excluded from both audio and video rendered-fallback.*publisher-authored fallback.*rejects/iu);
});
