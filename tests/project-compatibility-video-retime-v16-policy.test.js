/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('V17 policy preserves the historical V16 video-retime wire without a timing consumer', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-video-retime-v16-preservation');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.deepEqual(rule.evidence, [
		'src/common/editor/project-v17.ts',
		'src/common/editor/project-v17-validation.ts',
		'src/common/editor/project-retime-factory.ts',
		'src/common/editor/video-retime-v16.ts',
		'src/common/editor/video-retime-curve.ts',
		'src/common/editor/project-foundation-validation.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/commands/video-retime-preservation-admission.ts',
		'src/common/editor/commands.js',
		'src/common/editor/commands/clipboard-runtime.js',
		'src/common/editor/scape-project.js',
		'desktop/project-library-contract.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-current-project.ts',
		'desktop/project-library-editor-service.ts',
		'tests/audio-editor-video-retime-v16.test.ts',
		'tests/audio-editor-project-v16.test.ts',
		'tests/audio-editor-project-v17.test.ts',
		'tests/audio-editor-video-retime-command-preservation.test.ts',
		'tests/audio-editor-video-retime-preservation-admission.test.ts',
		'tests/desktop-project-library-v16-video-retime-roundtrip.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]);
	assert.match(rule.currentBehavior, /V17 accepts and preserves.*closed JSON-safe video-retime V2 wire introduced by V16.*timeline and Project Bin.*historical raw V16 documents.*re-import.*Null.*writable default.*1 through 4,096 segments.*one more dense point.*canonical reduced nonnegative number rationals.*safe integers.*outer frame zero.*sequenceFrameCount.*sourceInFrame.*sourceFrameCount/iu);
	assert.match(rule.currentBehavior, /adapter removes feature.*delegates direction.*freeze.*ramp velocity.*integral endpoint.*zero-crossing.*direction-change.*denominator.*bounded BigInt work.*exact V2 algebra.*deeply frozen.*rejects V15 breakpoint maps.*without guessing or migration/iu);
	assert.match(rule.currentBehavior, /framescaper\.video-retime.*org\.soundscaper\.capability\.video-retime.*Video retime maps.*bypass.*fallback null.*publisher-authored same-feature.*cannot suppress or replace.*reserved-ID conflict.*rendered fallback rejects/iu);
	assert.match(rule.currentBehavior, /videoRetime remains false in both product profiles.*production capability register.*explicit read-only-or-cancel.*intrinsically read-only/iu);
	assert.match(rule.currentBehavior, /clone, load, local history, clipboard descriptor and codec.*current-format \.scape format 1.*fresh desktop library v9 metadata 9.*SQLite user_version 11.*historical v8.*metadata-8.*exact-V16.*user-version-10.*untouched/iu);
	assert.match(rule.currentBehavior, /paste, clip add, and Project Bin add.*refuse.*shared direct-command boundary.*owning bounds.*arbitrarily nested.*before publication or history.*no authoring, playback, preview, export, fallback.*nested sequence/iu);
	assert.match(rule.currentBehavior, /focused Chromium fixture.*cancel.*explicit read-only consent.*unavailable bypass notice.*exact curve preservation.*current-format \.scape re-export/iu);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /V16 video-retime preservation.*V17 preserves.*closed JSON-safe V2 curve wire introduced by V16.*timeline and Project Bin.*historical raw V16 documents.*re-import.*null.*writable default.*1 through 4,096 segments.*exact V2 algebra adapter/iu);
	assert.match(documentation, /framescaper\.video-retime.*org\.soundscaper\.capability\.video-retime.*Video retime maps.*bypass.*fallback: null.*publisher declaration cannot suppress or replace.*videoRetime.*false in both products.*read-only-or-cancel.*intrinsically read-only/iu);
	assert.match(documentation, /current-format \.scape.*fresh desktop v9 library.*tagged-binary formats remain 1.*historical desktop v8.*metadata-8.*exact-V16.*user-version-10.*untouched.*no retime authoring, playback, preview, export, fallback.*nested sequence/iu);
});
