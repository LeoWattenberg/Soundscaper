/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackCrossfadeVisual } from '../vendor/audacity-design-system/components/src/Track/TrackCrossfadeVisual.tsx';

test('the design-system crossfade visual paints both veils before both gain curves', () => {
	const markup = renderToStaticMarkup(<TrackCrossfadeVisual
		left={112} top={21} width={80} height={91}
		outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
		outgoingSelected incomingSelected={false} label="Automatic crossfade between A and B" />);
	assert.match(markup, /role="img"/u);
	assert.match(markup, /data-automatic-crossfade="true"/u);
	assert.match(markup, /aria-label="Automatic crossfade between A and B"/u);
	assert.match(markup, /title="Automatic crossfade between A and B"/u);
	assert.match(markup, /style="left:113px;top:21px;width:78px;height:91px"/u);
	assert.ok(!markup.includes('z-index:'), 'the parent must not create a stacking context');
	const order = [
		markup.indexOf('data-fade-overlay="out"'),
		markup.indexOf('data-fade-overlay="in"'),
		markup.indexOf('data-fade-curve="out"'),
		markup.indexOf('data-fade-curve="in"'),
	];
	assert.ok(order.every(index => index > 0));
	assert.deepEqual(order, [...order].sort((left, right) => left - right));
	assert.match(markup, /rgba\(255, 255, 255, 0\.38\)/u);
	assert.match(markup, /rgba\(255, 255, 255, 0\.2\)/u);
	assert.equal((markup.match(/viewBox="0 0 100 100"/gu) || []).length, 2);
	assert.match(markup, /d="M 0,0 L 100,100"/u);
	assert.match(markup, /d="M 0,100 L 100,0"/u);
	assert.ok(!markup.includes('role="slider"'));
});

test('a two-pixel crossfade keeps one painted pixel inside the clip outlines', () => {
	const markup = renderToStaticMarkup(<TrackCrossfadeVisual
		left={10} top={21} width={2} height={91}
		outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
		outgoingSelected={false} incomingSelected={false} label="Tiny crossfade" />);
	assert.match(markup, /style="left:10\.5px;top:21px;width:1px;height:91px"/u);
});

test('multiple crossfades render as separate labeled overlays', () => {
	const markup = renderToStaticMarkup(<>
		<TrackCrossfadeVisual left={0} top={21} width={40} height={91}
			outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
			outgoingSelected={false} incomingSelected={false} label="First" />
		<TrackCrossfadeVisual left={40} top={21} width={40} height={91}
			outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
			outgoingSelected={false} incomingSelected label="Second" />
	</>);
	assert.equal((markup.match(/data-automatic-crossfade="true"/gu) || []).length, 2);
	assert.equal((markup.match(/data-fade-overlay=/gu) || []).length, 4);
	assert.equal((markup.match(/data-fade-curve=/gu) || []).length, 4);
	assert.match(markup, /aria-label="First"/u);
	assert.match(markup, /aria-label="Second"/u);
});
