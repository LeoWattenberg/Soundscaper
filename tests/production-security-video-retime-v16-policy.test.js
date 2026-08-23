/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('V16 wire custody and selected V20 web-core retime stay route-scoped', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'v16-video-retime-preservation-admission',
	);
	assert.ok(control);
	assert.deepEqual(control.evidence, [
		{ kind: 'implementation', path: 'src/common/editor/project-retime-factory.ts' },
		{ kind: 'implementation', path: 'src/common/editor/project-foundation-validation.ts' },
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
		{ kind: 'implementation', path: 'src/framescaper/editor-project-v20-retime-command.ts' },
		{ kind: 'implementation', path: 'src/framescaper/editor-project-v20-commands.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-web-core-ordinal-authority.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-web-core-preview.ts' },
		{ kind: 'implementation', path: 'src/common/editor/ui/dialogs/VideoRetimeDialog.tsx' },
		{ kind: 'test', path: 'tests/audio-editor-framescaper-video-retime-authoring-v20.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-web-core-ordinal-authority.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-ui.test.ts' },
		{ kind: 'test', path: 'tests/browser/audio-editor-framescaper-v20-product-lifecycle.spec.js' },
	]);
	assert.match(control.summary, /closed V2 video-retime wire.*schema V16.*1 through 4,096.*timeline and Project Bin.*null default.*typed re-import.*V15 map/iu);
	assert.match(control.summary, /framescaper\.video-retime.*bypass\/no-fallback.*publisher substitution.*rendered fallback.*Soundscaper V17.*read-only-or-cancel/iu);
	assert.match(control.summary, /Framescaper V20.*videoRetime available.*maintained web core.*set, reset, constant, ramp, reverse, and freeze.*one-step history.*menu-only lazy dialog/iu);
	assert.match(control.summary, /linked audio.*warpMap null.*audioWarp false/iu);
	assert.match(control.summary, /ordinal authority.*program-preview random seeks.*browser MP4\/WebM.*NTSC.*verified VFR.*nested/iu);
	assert.match(control.summary, /precedes occurrence retime in the source domain.*Scape format 2.*desktop V12.*No V25\/V26 native execution.*qualification/iu);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /v16-video-retime-preservation-admission.*V16.*1 through 4,096.*timeline and Project Bin.*null default.*V15 breakpoint map.*typed re-import/iu);
	assert.match(threatModel, /framescaper\.video-retime.*bypass\/no-fallback.*publisher substitution.*rendered fallback.*Soundscaper V17.*read-only-or-cancel/iu);
	assert.match(threatModel, /Framescaper V20.*videoRetime.*maintained web core.*set, reset, constant, ramp, reverse, and freeze.*ordinal authority.*program-preview random seeks.*MP4\/WebM/iu);
	assert.match(threatModel, /linked audio.*warpMap: null.*audioWarp: false.*source domain.*before occurrence retime.*No V25\/V26 native execution.*qualification/iu);
});
