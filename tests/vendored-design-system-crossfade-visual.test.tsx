/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackCrossfadeVisual } from '../vendor/audacity-design-system/components/src/Track/TrackCrossfadeVisual.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const keyboardAdjustment = () => undefined;

test('the design-system crossfade visual paints both veils before both gain curves', () => {
	const markup = renderToStaticMarkup(<TrackCrossfadeVisual
		left={112} top={21} width={80} height={91}
		outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
		intersectionPosition={0.5} intersectionGain={Math.SQRT1_2}
		outgoingClipId="A" incomingClipId="B"
		outgoingSelected incomingSelected={false} label="Automatic crossfade between A and B"
		minimumPosition={0.16} maximumPosition={0.84}
		onKeyboardAdjust={keyboardAdjustment} />);
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
	assert.match(markup, /data-crossfade-handle="A-B"/u);
	assert.match(markup, /role="slider"/u);
	assert.equal((markup.match(/aria-label="Automatic crossfade between A and B"/gu) || []).length, 2);
	assert.match(markup, /aria-orientation="horizontal"/u);
	assert.match(markup, /aria-valuetext="50%"/u);
	assert.match(markup, /tabindex="0"/u);
	assert.match(markup, /class="audacity-track-crossfade-handle__dot"/u);
});

test('a two-pixel crossfade keeps one painted pixel inside the clip outlines', () => {
	const markup = renderToStaticMarkup(<TrackCrossfadeVisual
		left={10} top={21} width={2} height={91}
		outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
		intersectionPosition={0.5} intersectionGain={Math.SQRT1_2}
		outgoingClipId="A" incomingClipId="B"
		outgoingSelected={false} incomingSelected={false} label="Tiny crossfade" />);
	assert.match(markup, /style="left:10\.5px;top:21px;width:1px;height:91px"/u);
});

test('the crossfade slider owns accessible keyboard adjustment and disabled focus semantics', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const adjustments: Array<[string, boolean]> = [];
	const tabs: boolean[] = [];
	const render = (disabled = false) => <TrackCrossfadeVisual
		left={0} top={0} width={80} height={80}
		outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
		intersectionPosition={0.5} intersectionGain={Math.SQRT1_2}
		minimumPosition={0.16} maximumPosition={0.84}
		outgoingClipId="A" incomingClipId="B"
		outgoingSelected={false} incomingSelected={false} label="Crossfade"
		disabled={disabled}
		onKeyboardAdjust={(key, fine) => adjustments.push([key, fine])}
		onTabOut={backwards => tabs.push(backwards)} />;
	try {
		await act(async () => root.render(render()));
		const slider = dom.one('[data-crossfade-handle]');
		assert.equal(slider.getAttribute('tabindex'), '0');
		const props = reactProps(slider);
		let prevented = 0;
		let stopped = 0;
		props.onKeyDown({
			key: 'ArrowRight', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
			preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; },
		});
		props.onKeyDown({
			key: 'Tab', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
			preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; },
		});
		props.onKeyDown({
			key: 'ArrowLeft', shiftKey: false, altKey: true, ctrlKey: false, metaKey: false,
			preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; },
		});
		assert.deepEqual(adjustments, [['ArrowRight', true]]);
		assert.deepEqual(tabs, [true]);
		assert.equal(prevented, 2);
		assert.equal(stopped, 2);

		await act(async () => root.render(render(true)));
		const disabled = dom.one('[data-crossfade-handle]');
		assert.equal(disabled.getAttribute('tabindex'), '-1');
		assert.equal(disabled.getAttribute('aria-disabled'), 'true');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('multiple crossfades render as separate labeled overlays', () => {
	const markup = renderToStaticMarkup(<>
		<TrackCrossfadeVisual left={0} top={21} width={40} height={91}
			outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
			intersectionPosition={0.5} intersectionGain={Math.SQRT1_2}
			outgoingClipId="A" incomingClipId="B"
			outgoingSelected={false} incomingSelected={false} label="First" />
		<TrackCrossfadeVisual left={40} top={21} width={40} height={91}
			outgoingPath="M 0,0 L 100,100" incomingPath="M 0,100 L 100,0"
			intersectionPosition={0.5} intersectionGain={Math.SQRT1_2}
			outgoingClipId="C" incomingClipId="D"
			outgoingSelected={false} incomingSelected label="Second" />
	</>);
	assert.equal((markup.match(/data-automatic-crossfade="true"/gu) || []).length, 2);
	assert.equal((markup.match(/data-fade-overlay=/gu) || []).length, 4);
	assert.equal((markup.match(/data-fade-curve=/gu) || []).length, 4);
	assert.match(markup, /aria-label="First"/u);
	assert.match(markup, /aria-label="Second"/u);
});
