/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	ParametricEqNumericInput,
	resolveParametricEqNumericCommit,
} from '../src/common/editor/ui/ParametricEqNumericInput.jsx';

test('parametric EQ numeric commits preserve valid input and restore invalid or cancelled input', () => {
	assert.deepEqual(resolveParametricEqNumericCommit(' 2.75 ', '1', false), {
		commit: true,
		value: 2.75,
	});
	assert.deepEqual(resolveParametricEqNumericCommit('', '1', false), {
		commit: false,
		replacement: '1',
	});
	assert.deepEqual(resolveParametricEqNumericCommit('not-a-number', '1', false), {
		commit: false,
		replacement: '1',
	});
	assert.deepEqual(resolveParametricEqNumericCommit('2.75', '1', true), {
		commit: false,
		replacement: '1',
	});
});

test('parametric EQ numeric control keeps its bounded decimal input contract', () => {
	const markup = renderToStaticMarkup(React.createElement(ParametricEqNumericInput, {
		value: 1.234,
		disabled: true,
		min: 0.1,
		max: 30,
		step: '0.01',
		onCommit() {},
	}));

	assert.match(markup, /^<input disabled="" type="number" inputMode="decimal"/u);
	assert.match(markup, /min="0\.1" max="30" step="0\.01" value="1\.23"/u);
});
