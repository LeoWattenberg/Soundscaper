/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { framescaperCaptionDeliveryUnavailable } from '../src/common/editor/ui/video-caption-delivery-surface.ts';
import VideoDeliveryFields from '../src/common/editor/ui/VideoDeliveryFields.jsx';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

Reflect.set(globalThis, 'React', React);
const project = createSoundscaperProject();
const settings = { format: 'video-webm', range: 'project', deliveryTarget: '',
	canvasWidth: '', canvasHeight: '', canvasFit: 'contain', canvasFrameRate: '', canvasBackgroundColor: '',
	videoQuality: 'balanced', videoAudioLayout: 'preserve', captionTrackId: 'dialogue',
	captionDelivery: 'mux+srt', captionBurnIn: true };

test('the selected ordinary Soundscaper document cannot advertise video-file captions', () => {
	assert.equal(framescaperCaptionDeliveryUnavailable('soundscaper', project), true);
});

test('the video surface explains the independent Soundscaper caption export in maintained locales', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		const markup = renderToStaticMarkup(<VideoDeliveryFields copy={copy} productId="soundscaper"
			disabled={false} labelTracks={[{ id: 'dialogue', name: 'Dialogue' }]} settings={settings}
			onChange={() => undefined} captionDeliveryUnavailable={framescaperCaptionDeliveryUnavailable('soundscaper', project)} />);
		assert.match(markup, /data-export-field="captionDeliveryUnavailable"/u);
		assert.match(markup, /Soundscaper/u);
		assert.ok(!markup.includes('data-effect-field="captionTrack"'));
		assert.ok(!markup.includes('data-effect-field="captionDelivery"'));
		assert.ok(!markup.includes('data-export-field="captionBurnIn"'));
	}
});

test('latent old caption choices cannot enter a selected product request that refuses them', () => {
	const before = structuredClone(settings);
	const request = createExportDialogRequest(settings, { captionDeliveryUnavailable: true });
	assert.equal(request.format, 'video-webm');
	assert.equal(Object.hasOwn(request, 'captions'), false);
	assert.deepEqual(settings, before);
});

test('the generic caption profile retains its existing explicit delivery request', () => {
	const request = createExportDialogRequest(settings);
	assert.deepEqual(request.captions, { trackId: 'dialogue', mux: true, sidecar: 'srt', burnIn: true });
});
