/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Checkbox } from '../vendor/audacity-design-system/components/src/Checkbox/Checkbox.tsx';
import { LabeledCheckbox } from '../vendor/audacity-design-system/components/src/LabeledCheckbox/LabeledCheckbox.tsx';
import { NumberStepper } from '../vendor/audacity-design-system/components/src/NumberStepper/NumberStepper.tsx';

// role="checkbox" carries no native disabled state. Dropping the control out of
// the tab order hides it from Tab but tells a screen reader nothing, and a host
// that passes its own tabIndex — a roving group — keeps it focusable and
// announced as operable.
test('a disabled checkbox announces its state rather than only leaving the tab order', () => {
	const idle = renderToStaticMarkup(<Checkbox checked aria-label="Dither" />);
	assert.match(idle, /role="checkbox"/u);
	assert.doesNotMatch(idle, /aria-disabled/u);

	const disabled = renderToStaticMarkup(<Checkbox checked disabled aria-label="Dither" />);
	assert.match(disabled, /aria-disabled="true"/u);
	assert.match(disabled, /tabindex="-1"/iu);

	const roving = renderToStaticMarkup(<Checkbox disabled tabIndex={0} aria-label="Dither" />);
	assert.match(roving, /aria-disabled="true"/u, 'a host-supplied tabIndex keeps it focusable');
	assert.match(roving, /tabindex="0"/iu);

	assert.match(
		renderToStaticMarkup(<LabeledCheckbox label="Dither" disabled />),
		/aria-disabled="true"/u,
		'the labelled wrapper forwards the state to the role-bearing element',
	);
});

// The arrows print MuseScore private-use codepoints, which are the whole
// accessible name unless one is given: a screen reader otherwise announces the
// raw glyph. BpmStepper names its own arrows in this same tree.
test('the number stepper arrows carry accessible names instead of an icon glyph', () => {
	const markup = renderToStaticMarkup(<NumberStepper value="48000" />);
	assert.match(markup, /aria-label="Increase value"/u);
	assert.match(markup, /aria-label="Decrease value"/u);
	assert.equal((markup.match(/class="number-stepper__icon musescore-icon" aria-hidden="true"/gu) ?? []).length, 2);

	const named = renderToStaticMarkup(
		<NumberStepper value="120" incrementLabel="Erhöhen" decrementLabel="Verringern" />,
	);
	assert.match(named, /aria-label="Erhöhen"/u, 'a host can localize the arrow names');
	assert.match(named, /aria-label="Verringern"/u);
});
