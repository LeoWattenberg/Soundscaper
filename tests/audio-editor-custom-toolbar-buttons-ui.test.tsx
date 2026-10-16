/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { CustomToolbarButtonGroup, CustomToolbarButtonSettings } from '../src/common/editor/ui/toolbar/CustomToolbarButtons.tsx';
import CustomToolbarButtonDialog from '../src/common/editor/ui/dialogs/CustomToolbarButtonDialog.tsx';

const button = { id: 'custom-cut', name: 'My cut', icon: 'CUT', actionId: 'cut' };
const actions = [{ actionId: 'cut', label: 'Cut', path: ['Edit', 'Cut'], disabled: true }];

test('custom buttons use the full font glyph and retain the user name when unavailable', () => {
	const markup = renderToStaticMarkup(<CustomToolbarButtonGroup buttons={[button]} actions={actions} copy={ENGLISH_COPY} run={(operation) => operation()} />);
	assert.match(markup, /aria-label="My cut"/u);
	assert.match(markup, /disabled=""/u);
	assert.ok(markup.includes('\uF39A'));
	assert.match(markup, /currently unavailable/u);
});

test('the toolbar adds no custom button controls until a user saves one', () => {
	assert.equal(renderToStaticMarkup(<CustomToolbarButtonGroup buttons={[]} actions={actions} copy={ENGLISH_COPY} run={(operation) => operation()} />), '');
});

test('hidden custom buttons remain editable and discoverable in customization', () => {
	const markup = renderToStaticMarkup(<CustomToolbarButtonSettings buttons={[button]} toolbarButtons={{ 'custom-cut': false }} copy={ENGLISH_COPY} onCustomize={() => undefined} onToggle={() => undefined} />);
	assert.match(markup, /role="menuitem"/u);
	assert.match(markup, /Custom button/u);
	assert.match(markup, /aria-checked="false"/u);
	assert.match(markup, /aria-label="Edit My cut"/u);
});

test('a new dialog requires a name and action but lists unavailable actions for future use', () => {
	const markup = renderToStaticMarkup(<CustomToolbarButtonDialog copy={ENGLISH_COPY} actions={actions} onSave={async () => undefined} onClose={() => undefined} />);
	assert.match(markup, /aria-label="Name"/u);
	assert.match(markup, /aria-label="Action"/u);
	assert.match(markup, /value="cut">Edit › Cut/u);
	assert.match(markup, /type="submit"[^>]*disabled=""/u);
	assert.match(markup, /aria-label="ACCIACCATURA"/u);
});

test('editing preserves the assigned action and symbol and offers removal', () => {
	const markup = renderToStaticMarkup(<CustomToolbarButtonDialog button={button} copy={ENGLISH_COPY} actions={actions} onSave={async () => undefined} onRemove={async () => undefined} onClose={() => undefined} />);
	assert.match(markup, /value="My cut"/u);
	assert.match(markup, /value="cut" selected=""/u);
	assert.match(markup, /aria-label="CUT" aria-pressed="true"/u);
	assert.match(markup, /Remove button/u);
});

test('custom button copy is available in English and German', () => {
	assert.equal(ENGLISH_COPY.customToolbarButton, 'Custom button');
	for (const key of ['customToolbarButton', 'customToolbarButtonName', 'customToolbarButtonAction', 'customToolbarButtonSymbol', 'customToolbarButtonEdit', 'customToolbarButtonRemove']) {
		assert.equal(typeof GERMAN_COPY[key], 'string');
		assert.ok(GERMAN_COPY[key]);
	}
});
