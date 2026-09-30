/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { aup4CompatibilityEffectPath } from '../src/common/editor/ui/dialogs/editor-dialog-model.js';

test('missing effect report items expose their decoded plug-in path', () => {
	assert.equal(aup4CompatibilityEffectPath({
		code: 'MISSING_REALTIME_EFFECT',
		disposition: 'missing',
		data: {
			name: 'Super_Verb',
			nativeId: 'Effect_VST3_Acme_Super\\_Verb_/plugins/super_verb.vst3',
		},
	}), '/plugins/super_verb.vst3');
});

test('compatibility entries without a valid missing effect ID have no path tooltip', () => {
	for (const item of [
		null,
		{},
		{ code: 'MISSING_REALTIME_EFFECT', disposition: 'missing', data: { nativeId: 'malformed' } },
		{ code: 'MISSING_REALTIME_EFFECT', disposition: 'preserved', data: { nativeId: 'Effect_VST3_Acme_Name_/plugin' } },
		{ code: 'OTHER_ITEM', disposition: 'missing', data: { nativeId: 'Effect_VST3_Acme_Name_/plugin' } },
	]) {
		assert.equal(aup4CompatibilityEffectPath(item), '');
	}
});
