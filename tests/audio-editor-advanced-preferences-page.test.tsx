/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';

(globalThis as unknown as { React: unknown }).React = React;

function renderPage(initialPage: string, productId = 'soundscaper'): string {
	return renderToStaticMarkup(<WorkspacePreferencesDialog
		controller={{ actions: { preferences: {} } }}
		snapshot={{ preferences: createAudioEditorPreferencesV1() }}
		copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]}
		run={() => undefined} initialPage={initialPage} productId={productId}
		onTogglePanel={() => undefined} onClose={() => undefined}
	/>);
}

test('Advanced offers an accessible server setting with audio.com as the default', () => {
	const markup = renderPage('advanced');
	assert.match(markup, /role="tabpanel"[^>]*aria-label="Advanced"/u);
	assert.match(markup, /type="url"[^>]*value="https:\/\/api\.audio\.com"/u);
	assert.match(markup, /Server URL/u);
	assert.match(markup, /Save server/u);
	assert.match(markup, /Use audio\.com/u);
	assert.match(markup, /connect again/u);
});

test('the audio server setting stays within the optional Soundscaper Advanced page', () => {
	assert.doesNotMatch(renderPage('general'), /Save server|Server URL/u);
	assert.doesNotMatch(renderPage('general', 'framescaper'), /dialog-panel-advanced/u);
});
