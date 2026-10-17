/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
test('AE bridge copy is opt-in, owned and localized with explicit development qualification', () => {
	const key = 'ui.motionscaper-ae.motionscaperAfterEffectsBridge';
	assert.equal(EDITOR_ENGLISH_COPY[key], 'After Effects Bridge');
	assert.equal(EDITOR_GERMAN_COPY[key], 'After-Effects-Austausch');
	assert.match(motionscaperCopy('en').motionscaperAeQualification!, /No installed After Effects version/u);
	assert.equal(motionscaperCopy('de').motionscaperAfterEffectsBridge, 'After-Effects-Austausch');
	assert.equal(motionscaperCopy('fr', { [key]: 'Échange After Effects' }).motionscaperAfterEffectsBridge, 'Échange After Effects');
});

test('reverse Adobe export copy keeps source custody and qualification explicit in English and German', () => {
	for (const locale of ['en', 'de']) {
		const copy = motionscaperCopy(locale);
		assert.ok(copy.motionscaperAeReviewExport); assert.match(copy.motionscaperAeExportCustody!, /original\.mscape/u);
		assert.match(copy.motionscaperAeExportInstructions!, /32/u); assert.match(copy.motionscaperAeExportLimits!, /128 MiB.*256 MiB/u);
	}
});

test('Motion AE camera/light review is localized and states its structural scene limits', () => {
	for (const locale of ['en', 'de']) { const copy = motionscaperCopy(locale); assert.ok(copy.motionscaperAeSceneImport); assert.ok(copy.motionscaperAeSceneExport); assert.ok(copy.motionscaperAeSceneImportColor); assert.ok(copy.motionscaperAeSceneExportColor); }
	assert.match(motionscaperCopy('en').motionscaperAeSceneHint!, /depth of field off/u); assert.match(motionscaperCopy('en').motionscaperAeSceneHint!, /3D picture layers/u);
});
