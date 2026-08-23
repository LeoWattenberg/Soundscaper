/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import { VIDEO_CAPTION_COPY_BY_LOCALE } from '../src/common/i18n/video-caption-copy.js';
import VideoDeliveryFields from '../src/common/editor/ui/VideoDeliveryFields.jsx';
import { framescaperV27CaptionDeliveryUnavailable } from '../src/common/editor/ui/video-caption-delivery-surface.ts';

Reflect.set(globalThis, 'React', React);
const RenderableVideoDeliveryFields = VideoDeliveryFields as React.ComponentType<Readonly<{
	copy: Readonly<Record<string, string>>;
	disabled: boolean;
	labelTracks: readonly Readonly<{ id: string; name: string }>[];
	settings: Readonly<Record<string, string | boolean>>;
	onChange(name: string, value: unknown): void;
	captionDeliveryUnavailable?: boolean;
}>>;

test('caption delivery gate is isolated to the selected Framescaper V27 route', () => {
	assert.equal(framescaperV27CaptionDeliveryUnavailable('framescaper', { schemaVersion: 27 }), true);
	assert.equal(framescaperV27CaptionDeliveryUnavailable('framescaper', { schemaVersion: 20 }), false);
	assert.equal(framescaperV27CaptionDeliveryUnavailable('soundscaper', { schemaVersion: 27 }), false);
	assert.equal(framescaperV27CaptionDeliveryUnavailable('framescaper', null), false);
});

test('selected V27 visibly refuses video-file caption delivery without hiding generic ownership', () => {
	const generic = renderToStaticMarkup(<RenderableVideoDeliveryFields
		copy={COPY}
		disabled={false}
		labelTracks={[{ id: 'labels-1', name: 'English labels' }]}
		settings={SETTINGS}
		onChange={() => undefined}
	/>);
	assert.match(generic, /Captions from/u);
	assert.match(generic, /Deliver captions/u);
	assert.match(generic, /Draw the captions into the picture/u);

	const selectedV27 = renderToStaticMarkup(<RenderableVideoDeliveryFields
		copy={COPY}
		disabled={false}
		labelTracks={[{ id: 'labels-1', name: 'English labels' }]}
		settings={SETTINGS}
		onChange={() => undefined}
		captionDeliveryUnavailable
	/>);
	assert.match(selectedV27, /data-export-field="captionDeliveryUnavailable"/u);
	assert.match(selectedV27, /Caption burn-in and mux are unavailable.*Caption Tracks/u);
	assert.doesNotMatch(selectedV27, /Captions from|Deliver captions|Draw the captions into the picture/u);
});

const COPY = Object.freeze({
	...CANONICAL_EXTRA_COPY_BY_LOCALE.en,
	...VIDEO_CAPTION_COPY_BY_LOCALE.en,
	channelMapping: 'Channel mapping', preserveChannels: 'Preserve', mono: 'Mono', stereo: 'Stereo',
});

const SETTINGS = Object.freeze({
	deliveryTarget: '', canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
	canvasFrameRate: '', canvasBackgroundColor: '', videoQuality: 'balanced',
	videoAudioLayout: 'preserve', captionTrackId: 'labels-1', captionDelivery: 'mux',
	captionBurnIn: true,
});
