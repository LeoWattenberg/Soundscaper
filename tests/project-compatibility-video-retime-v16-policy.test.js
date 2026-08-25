/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('policy preserves the V16 wire and scopes selected F31 through the V28/V14 foundation', async () => {
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
		'src/framescaper/editor-project-v20-retime-command.ts',
		'src/framescaper/editor-project-v20-retime-actions.ts',
		'src/framescaper/editor-project-v20-commands.ts',
		'src/common/editor/video-retime-web-core-ordinal-authority.ts',
		'src/common/editor/video-retime-web-core-preview.ts',
		'src/common/editor/ui/dialogs/VideoRetimeDialog.tsx',
		'src/common/editor/ui/video-keyframe-offline-video-export.ts',
		'src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx',
		'src/framescaper/editor-project-runtime-v27-selection.ts',
		'src/framescaper/editor-controller-v27.ts',
		'src/framescaper/editor-project-v27-commands.ts',
		'src/framescaper/editor-selected-v27-authoring-controller.ts',
		'src/framescaper/editor-existing-video-proxy-scheduler.ts',
		'src/framescaper/editor-video-proxy-action-runtime-v20.ts',
		'src/framescaper/editor-video-proxy-preview-media-v20.ts',
		'tests/audio-editor-framescaper-video-retime-authoring-v20.test.ts',
		'tests/audio-editor-framescaper-existing-video-proxy-scheduler-v27.test.ts',
		'tests/audio-editor-framescaper-v27-video-proxy.test.ts',
		'tests/audio-editor-framescaper-video-proxy-lifecycle-v20.test.ts',
		'tests/audio-editor-framescaper-video-proxy-preview-media-v20.test.ts',
		'tests/audio-editor-video-retime-web-core-ordinal-authority.test.ts',
		'tests/audio-editor-video-retime-ui.test.ts',
		'tests/browser/audio-editor-framescaper-v27-product-lifecycle.spec.js',
	]);
	assert.match(rule.currentBehavior, /closed JSON-safe V2 curve wire introduced by V16.*timeline and Project Bin.*1 through 4,096.*exact-algebra.*V15 breakpoint maps.*typed re-import/iu);
	assert.match(rule.currentBehavior, /framescaper\.video-retime.*org\.soundscaper\.capability\.video-retime.*bypass.*no fallback.*publisher substitution.*rendered fallback rejects/iu);
	assert.match(rule.currentBehavior, /Soundscaper V17.*unavailable.*read-only-or-cancel.*Framescaper F31.*reimports exact V28.*immutable V28 foundation.*videoRetime consumer.*set, reset, constant, ramp, reverse, and freeze.*lazy Edit-menu dialog.*one-step/iu);
	assert.match(rule.currentBehavior, /ordinal authority.*program preview random seeks.*browser MP4\/WebM.*V14 carrier.*NTSC.*verified VFR.*nested.*same source ordinal/iu);
	assert.match(rule.currentBehavior, /linked audio.*warpMap null.*audioWarp false.*proxy lifecycle.*source domain before occurrence retime/iu);
	assert.match(rule.currentBehavior, /Clipboard V12.*Scape custody.*desktop library V20.*V28\/V14.*foundation.*V25\/V26.*opaque read-only/iu);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /V16 wire preservation and selected F31 web-core retime.*V17 preserves.*closed JSON-safe V2 curve wire introduced by V16.*timeline and Project Bin.*1 through 4,096.*exact V2 algebra/iu);
	assert.match(documentation, /Soundscaper V17.*videoRetime.*unavailable.*read-only-or-cancel.*Framescaper F31.*maintained V20 consumer.*immutable V28 foundation/iu);
	assert.match(documentation, /set, reset, constant, ramp, reverse, and freeze.*one history step.*menu-only lazy dialog.*linked audio.*audioWarp.*false.*program-preview random seeks.*browser MP4\/WebM.*V14 carrier.*NTSC.*verified VFR.*source domain/iu);
});
