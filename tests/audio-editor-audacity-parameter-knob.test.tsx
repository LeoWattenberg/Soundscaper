/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import AudacityParameterKnob from '../src/common/editor/ui/AudacityParameterKnob.tsx';

test('warped Audacity knob exposes actual threshold units and keeps its native visual slider hidden', () => {
	const markup = renderToStaticMarkup(<ThemeProvider><AudacityParameterKnob
		label="Threshold (dB)" value={-10} min={-60} max={0} step={0.1} defaultValue={-10}
	/></ThemeProvider>);
	assert.match(markup, /role="slider" tabindex="0"[^>]*aria-label="Threshold \(dB\): -10"[^>]*aria-valuemin="-60"[^>]*aria-valuemax="0"[^>]*aria-valuenow="-10"/u);
	assert.match(markup, /--audacity-knob-angle:0deg/u);
	assert.match(markup, /aria-valuenow="-10"[^>]*><\/span><span aria-hidden="true"><button/u);
	assert.match(markup, /<span aria-hidden="true"><button[^>]*tabindex="-1"/u);
});

test('a disabled Audacity knob leaves the tab order and announces its disabled state', () => {
	const markup = renderToStaticMarkup(<ThemeProvider><AudacityParameterKnob
		label="Attack" value={30} min={0} max={200} defaultValue={30} disabled
	/></ThemeProvider>);
	assert.match(markup, /role="slider" tabindex="-1" aria-disabled="true"/u);
});
