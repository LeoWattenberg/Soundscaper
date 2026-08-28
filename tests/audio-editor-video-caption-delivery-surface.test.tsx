/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import { VIDEO_CAPTION_COPY_BY_LOCALE } from '../src/common/i18n/video-caption-copy.js';
import VideoDeliveryFields from '../src/common/editor/ui/VideoDeliveryFields.jsx';
import { framescaperCaptionDeliveryUnavailable } from '../src/common/editor/ui/video-caption-delivery-surface.ts';

Reflect.set(globalThis, 'React', React);
const RenderableVideoDeliveryFields = VideoDeliveryFields as React.ComponentType<Readonly<{
	copy: Readonly<Record<string, string>>;
	disabled: boolean;
	labelTracks: readonly Readonly<{ id: string; name: string }>[];
	settings: Readonly<Record<string, string | boolean>>;
	onChange(name: string, value: unknown): void;
	captionDeliveryUnavailable?: boolean;
}>>;

test('caption delivery gate follows the current Framescaper identity', () => {
	assert.equal(framescaperCaptionDeliveryUnavailable('framescaper', {
		schemaFamily: 'framescaper', schemaVersion: 1,
	}), true);
	assert.equal(framescaperCaptionDeliveryUnavailable('framescaper', {
		schemaFamily: 'framescaper', schemaVersion: 2,
	}), false);
	assert.equal(framescaperCaptionDeliveryUnavailable('framescaper', { schemaVersion: 31 }), false);
	assert.equal(framescaperCaptionDeliveryUnavailable('soundscaper', {
		schemaFamily: 'framescaper', schemaVersion: 1,
	}), false);
	assert.equal(framescaperCaptionDeliveryUnavailable('framescaper', null), false);
});

test('selected Framescaper visibly refuses video-file caption delivery without hiding generic ownership', () => {
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

	const framescaper = renderToStaticMarkup(<RenderableVideoDeliveryFields
		copy={COPY}
		disabled={false}
		labelTracks={[{ id: 'labels-1', name: 'English labels' }]}
		settings={SETTINGS}
		onChange={() => undefined}
		captionDeliveryUnavailable
	/>);
	assert.match(framescaper, /data-export-field="captionDeliveryUnavailable"/u);
	assert.match(framescaper, /Caption burn-in and mux are unavailable.*Caption Tracks/u);
	assert.doesNotMatch(framescaper, /Captions from|Deliver captions|Draw the captions into the picture/u);
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
