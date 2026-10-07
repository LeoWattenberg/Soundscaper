/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import type { CreatePhotoLibrarySessionV1 } from '../src/common/editor/photo-library-session-port-v1.ts';

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

test('photo import and ratings are menu entries and rendering never creates a library session', () => {
	let opened = 0;
	const createSession: CreatePhotoLibrarySessionV1 = async () => { opened += 1; throw new Error('Rendering must remain inert.'); };
	const markup = renderToStaticMarkup(<LightscaperApp locale="en" createSession={createSession} />);
	assert.match(markup, /Import photos/u); assert.match(markup, /<summary[^>]*>Photo<\/summary>/u);
	assert.match(markup, /Rate 5 stars/u);
	assert.equal((markup.match(/name="lightscaper-application-menu"/gu) ?? []).length, 2);
	assert.ok(markup.indexOf('>Photo</summary>') < markup.indexOf('>View</summary>'));
	assert.equal(opened, 0); assert.doesNotMatch(markup, /data-photo-library="true"|<input|role="dialog"/u);
});
