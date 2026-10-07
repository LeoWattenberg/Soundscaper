/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';

test('the initial photo shell offers its library and other products through menus', () => {
	const markup = renderToStaticMarkup(<LightscaperApp locale="en" />);
	assert.match(markup, /data-lightscaper-bound="true"/u);
	assert.match(markup, /<summary[^>]*>File<\/summary>/u);
	assert.match(markup, /<summary[^>]*>View<\/summary>/u);
	assert.match(markup, /https:\/\/soundscaper\.org\/en\//u);
	assert.match(markup, /https:\/\/framescaper\.org\/en\//u);
	assert.match(markup, /Show photo library/u);
	assert.doesNotMatch(markup, /data-photo-library="true"/u);
	assert.doesNotMatch(markup, /data-audio-editor-bound|<canvas|<input/u);
});

test('the photo shell renders authored German copy without an audio-workspace fallback', () => {
	const markup = renderToStaticMarkup(<LightscaperApp locale="de" />);
	assert.match(markup, /Fotobibliothek anzeigen/u);
	assert.match(markup, /https:\/\/framescaper\.org\/de\//u);
	assert.doesNotMatch(markup, /Audio editor|Video editor/u);
});
