/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createContributionSnapshot, createTranslationDraft } from '../src/common/i18n/community-translations.ts';
import { communityTranslationMessageKeys } from '../src/common/editor/ui/community-translations/community-translation-message-filter.ts';

test('missing translations exclude current same-source Audacity and bundled translations', () => {
	const snapshot = createContributionSnapshot('de', {
		pause: 'Pause', untranslated: 'English fallback', bundled: 'OK',
	}, { pause: 'Pause', untranslated: 'English fallback', bundled: 'OK' }, {
		locale: 'de', entries: { pause: ['audacity', 'Pause', 'Pause'] },
	});
	const keys = communityTranslationMessageKeys(snapshot, createTranslationDraft(snapshot), {
		query: '', filter: 'missing', reviewKeys: new Set(), locale: 'de',
	}, { bundled: { bundledGerman: 'OK' } });
	assert.deepEqual(keys, ['untranslated']);
});
