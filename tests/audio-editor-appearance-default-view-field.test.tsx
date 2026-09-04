/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	AUDIO_EDITOR_DEFAULT_VIEWS,
	createAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

test('the appearance preferences page shows the stored default view in a labelled field', () => {
	const labels: Record<string, string> = {
		waveform: ENGLISH_COPY.waveformView,
		spectrogram: ENGLISH_COPY.spectrogramView,
		multiview: ENGLISH_COPY.multiview,
	};
	for (const defaultView of AUDIO_EDITOR_DEFAULT_VIEWS) {
		const preferences = createAudioEditorPreferencesV1({ appearance: { defaultView } });
		const markup = renderToStaticMarkup(
			<WorkspacePreferencesDialog
				controller={{ actions: { preferences: {} } }}
				snapshot={{ preferences }}
				copy={ENGLISH_COPY}
				locale="en"
				fileService={{ isDesktop: false }}
				menus={[]}
				run={() => undefined}
				initialPage="appearance"
				onTogglePanel={() => undefined}
				onClose={() => undefined}
			/>,
		);
		const field = new RegExp(`role="group" aria-label="${ENGLISH_COPY.defaultTrackView}">.*?</button>`, 'u')
			.exec(markup)?.[0] ?? '';
		assert.ok(field, 'renders the Default view field');
		// The vendored dropdown lists its options only once opened; the closed
		// trigger shows the stored value's label.
		assert.ok(field.includes(labels[defaultView]), `${defaultView} shows ${labels[defaultView]}`);
	}
});
