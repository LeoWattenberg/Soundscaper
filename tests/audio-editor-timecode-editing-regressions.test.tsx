/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AudioEditorTimeCodeInput from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { timeCodeWholeUnits } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-precision.ts';

function displayedDigits(markup: string): string {
	return [...markup.matchAll(/class="timecode-digit[^"]*"[^>]*>(\d)<\/span>/gu)]
		.map((match) => match[1]).join('');
}

test('sample timecode does not truncate an exact sample after seconds conversion', () => {
	assert.equal(timeCodeWholeUnits(15 / 44_100, 44_100), 15);
	const markup = renderToStaticMarkup(<TimeCode value={15 / 44_100} format="samples" sampleRate={44_100} />);
	assert.equal(displayedDigits(markup), '000000000015');
});

test('timecode total formats provide editable leading zeroes', () => {
	assert.equal(displayedDigits(renderToStaticMarkup(<TimeCode value={0} format="samples" />)).length, 12);
	assert.equal(displayedDigits(renderToStaticMarkup(<TimeCode value={0} format="film-frames" />)).length, 12);
	assert.equal(displayedDigits(renderToStaticMarkup(<TimeCode value={0} format="seconds+milliseconds" />)).length, 9);
});

test('timecode format buttons never submit the containing form and disabled fields skip Tab', () => {
	const markup = renderToStaticMarkup(<TimeCode value={0} disabled />);
	assert.match(markup, /<button type="button"[^>]*class="timecode__format-button"/u);
	assert.match(markup, /aria-disabled="true"[^>]*tabindex="-1"/u);
});

test('seconds inputs honor a supplied project sample rate in a sample display', () => {
	const markup = renderToStaticMarkup(<AudioEditorTimeCodeInput label="Duration" value={1}
		format="samples" sampleRate={44_100} />);
	assert.equal(Number(displayedDigits(markup)), 44_100);
});
