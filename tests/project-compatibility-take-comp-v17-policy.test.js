/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('V17 policy records native Soundscaper take/comp and read-only Framescaper preservation', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-take-comp-v17-preservation');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/Exact-schema-17 take\/comp state.*closed.*bounded.*canonical.*ownership-validated.*bypass-only no-fallback.*native and writable in Soundscaper.*known unavailable.*read-only in Framescaper.*publisher substitution.*audio or video rendered fallback.*reject.*\.scape collision copy.*fresh-recipient desktop handoff.*take-owned PCM.*source identity remapping/iu,
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
		/refuses publisher substitution.*true in Soundscaper.*production capability register.*available\/native.*compatible.*false but registered in Framescaper.*unavailable\/bypassed.*incompatible.*intrinsically read-only.*excluded from both audio and video rendered-fallback.*publisher-authored substitution or rendered fallback.*rejects/iu,
	);
	assert.match(
		rule.currentBehavior,
		/Soundscaper.*typed take\/comp domain.*group add, update, remove, and flatten command handlers.*exact lane and take audition.*range promotion.*boundary editing.*stale-safe exact flatten publication.*Tracks-menu dialog.*Framescaper.*no take\/comp menu/iu,
	);
	assert.match(
		rule.currentBehavior,
		/clipboard V4.*clips take geometry.*retains take-owned source roots.*independently identified graph.*current-format \.scape collision copy.*take groups.*only logical roots.*exact PCM.*remaps.*take source IDs?.*recipient collisions untouched.*reopen/iu,
	);
	assert.match(
		rule.currentBehavior,
		/fresh desktop V9 metadata 9.*SQLite user_version 11.*Soundscaper.*writable.*fresh Framescaper recipient.*managed PCM.*exact document.*read-only.*fresh Soundscaper recipient.*writable.*no missing sources.*Cycle recording.*interrupted-pass recovery.*outside this policy slice/iu,
	);
	assert.deepEqual(rule.evidence, [
		'src/common/editor/take-comp-domain.ts',
		'src/common/editor/take-comp-document-v17.ts',
		'src/common/editor/project-v17.ts',
		'src/common/editor/project-v17-validation.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/commands/take-comp.ts',
		'src/common/editor/commands/take-comp-runtime.ts',
		'src/common/editor/commands/take-comp-clipboard.ts',
		'src/common/editor/commands/clipboard-codec.ts',
		'src/common/editor/commands/clipboard-runtime.js',
		'src/common/editor/controller/take-comp-service.ts',
		'src/common/editor/controller/take-comp-preview-service.ts',
		'src/common/editor/controller/take-comp-flatten-service.ts',
		'src/common/editor/controller/take-comp-composition.ts',
		'src/common/editor/ui/take-comp-application-menu.ts',
		'src/common/editor/ui/dialogs/TakeCompDialog.tsx',
		'src/common/editor/take-group-source-references.ts',
		'src/common/editor/scape-project.js',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'config/production-capabilities.json',
		'tests/audio-editor-project-v17.test.ts',
		'tests/audio-editor-foundation-feature-registration.test.ts',
		'tests/audio-editor-take-comp-domain.test.ts',
		'tests/audio-editor-take-comp-commands-service.test.ts',
		'tests/audio-editor-take-comp-composition.test.ts',
		'tests/audio-editor-take-comp-clipboard.test.ts',
		'tests/audio-editor-take-comp-ui.test.tsx',
		'tests/browser/audio-editor-take-comp.spec.js',
		'tests/audio-editor-scape-take-comp-roundtrip.test.ts',
		'tests/desktop-project-library-take-comp-handoff.test.ts',
	]);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /V17 take\/comp preservation.*required root takeGroups/iu);
	assert.match(documentation, /soundscaper\.take-comp.*org\.soundscaper\.capability\.take-comp.*bypass.*fallback null/iu);
	assert.match(documentation, /true in Soundscaper.*available\/native.*false but registered in Framescaper.*unavailable\/bypassed.*intrinsically read-only/iu);
	assert.match(documentation, /excluded from both audio and video rendered-fallback.*publisher-authored substitution or rendered fallback.*rejects/iu);
	assert.match(documentation, /Tracks-menu dialog.*clipboard V4.*\.scape collision copy.*fresh desktop V9 metadata 9.*Cycle recording.*outside this policy slice/iu);
});
