/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('V16 security evidence limits video retime to preservation and refusal', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'v16-video-retime-preservation-admission',
	);
	assert.ok(control);
	assert.deepEqual(control.evidence, [
		{ kind: 'implementation', path: 'src/common/editor/project-v16.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-v16-validation.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-v17.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-v17-validation.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-v16.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-curve.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-owned-feature-requirements.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-feature-capabilities.ts' },
		{ kind: 'implementation', path: 'src/common/editor/commands/video-retime-preservation-admission.ts' },
		{ kind: 'implementation', path: 'src/common/editor/commands.js' },
		{ kind: 'implementation', path: 'src/common/editor/commands/clipboard-runtime.js' },
		{ kind: 'implementation', path: 'desktop/project-library-current-project.ts' },
		{ kind: 'implementation', path: 'desktop/project-library-editor-service.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-v16.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-project-v16.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-project-v17.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-command-preservation.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-preservation-admission.test.ts' },
		{ kind: 'test', path: 'tests/desktop-project-library-v16-video-retime-roundtrip.test.ts' },
		{ kind: 'test', path: 'tests/browser/audio-editor-scape-open-compatibility.spec.js' },
	]);
	assert.match(control.summary, /Exact schema 17.*closed V2 video-retime wire.*schema V16.*1 through 4,096.*timeline and Project Bin.*null remains writable.*V15 breakpoint map.*typed re-import/iu);
	assert.match(control.summary, /framescaper\.video-retime.*org\.soundscaper\.capability\.video-retime.*fallback null.*publisher substitution.*rendered fallback rejects.*videoRetime.*false for both products.*read-only-or-cancel.*intrinsically read-only/iu);
	assert.match(control.summary, /clone, history, clipboard codec.*format-1 \.scape.*desktop-v9.*direct and arbitrarily nested command boundary.*focused Chromium fixture.*exact curve preservation.*\.scape re-export.*no authoring, evaluator, playback, preview, export, nested sequence, fallback, or native timing claim/iu);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /v16-video-retime-preservation-admission.*V16.*wire.*current schema 17.*1 through 4,096.*timeline and Project Bin.*null remains writable.*V15 breakpoint maps require typed re-import/iu);
	assert.match(threatModel, /framescaper\.video-retime.*bypass\/no-fallback.*publisher substitution.*rendered fallback reject.*videoRetime.*false in both products.*read-only-or-cancel.*intrinsically read-only/iu);
	assert.match(threatModel, /No authoring, evaluator, playback, preview, export, nested-sequence, fallback, or native-timing correctness is qualified/iu);
});
