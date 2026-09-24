/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackFadeShapeHandle } from '../vendor/audacity-design-system/components/src/Track/TrackFadeShapeHandle.tsx';

test('fade shape handle uses the upstream midpoint dot and host position', () => {
	const markup = renderToStaticMarkup(<TrackFadeShapeHandle edge="out" left={125} top={48}
		aria-label="Fade out shape" aria-valuemin={0.15} aria-valuemax={6}
		aria-valuenow={2} tabIndex={-1} data-clip-fade-shape-handle="out" />);
	assert.match(markup, /<button[^>]*type="button"[^>]*role="slider"/u);
	assert.match(markup, /class="audacity-track-fade-shape-handle"/u);
	assert.match(markup, /data-fade-shape-handle="out"/u);
	assert.match(markup, /data-clip-fade-shape-handle="out"/u);
	assert.match(markup, /aria-label="Fade out shape"/u);
	assert.match(markup, /aria-valuenow="2"/u);
	assert.match(markup, /tabindex="-1"/u);
	assert.match(markup, /style="left:125px;top:48px"/u);
	assert.match(markup, /<span class="audacity-track-fade-shape-handle__dot" aria-hidden="true"><\/span>/u);
});

test('fade shape handle forwards button props while keeping its slider identity', () => {
	const markup = renderToStaticMarkup(<TrackFadeShapeHandle edge="in" left={0} top="calc(50% - 8px)"
		className="custom" style={{ opacity: 0.5 }} disabled title="Shape" role="button" />);
	assert.match(markup, /type="button"/u);
	assert.match(markup, /role="slider"/u);
	assert.match(markup, /class="audacity-track-fade-shape-handle custom"/u);
	assert.match(markup, /data-fade-shape-handle="in"/u);
	assert.match(markup, /disabled=""/u);
	assert.match(markup, /title="Shape"/u);
	assert.match(markup, /style="opacity:0.5;left:0;top:calc\(50% - 8px\)"/u);
});
