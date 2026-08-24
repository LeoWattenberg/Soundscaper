/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptionDeliveryAdapterV28,
	framescaperCaptionDeliveryAvailabilityV28,
} from '../src/framescaper/video-caption-delivery-v28.ts';

const SHA256 = /^[a-f0-9]{64}$/u;

test('V28 adapts an explicit caption track to deterministic mov_text and loss-reporting legacy burn authority', () => {
	const adapted = createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: true, burnIn: true, sidecar: 'vtt',
	}, {
		profileId: 'encode-mov-prores-422-hq', sampleRate: 48_000,
		range: { startFrame: 24_000, endFrame: 96_000 },
		canvas: { width: 1_920, height: 1_080 },
	});

	assert.deepEqual(adapted.delivery, {
		stage: 'post-finishing-delivery',
		trackId: 'captions-en', cueSetSha256: adapted.delivery.cueSetSha256,
		mux: { codec: 'mov_text', documentSha256: adapted.muxDocument!.sha256 },
		burnIn: {
			planSha256: adapted.delivery.burnIn!.planSha256,
			fontSubsetIds: adapted.delivery.burnIn!.fontSubsetIds,
			alphaDisposition: 'opaque-output',
		},
		sidecar: { format: 'vtt', documentSha256: adapted.sidecarDocument!.sha256 },
	});
	assert.match(adapted.delivery.cueSetSha256, SHA256);
	assert.match(adapted.delivery.burnIn!.planSha256, SHA256);
	assert.match(adapted.muxDocument!.sha256, SHA256);
	assert.equal(adapted.muxDocument!.format, 'srt');
	assert.match(adapted.muxDocument!.text, /00:00:00,000 --> 00:00:00,500/u);
	assert.equal(adapted.sidecarDocument?.format, 'webvtt');
	assert.equal(adapted.burnInStage?.cues[0]?.startSeconds, 0);
	assert.equal(adapted.burnInStage?.cues[0]?.endSeconds, 0.5);
	assert.equal(adapted.burnInPlan?.sourceCaptionSha256, adapted.delivery.cueSetSha256);
	assert.equal(adapted.burnInPlan?.renderingMode, 'legacy-fixed-style-v1');
	assert.ok(adapted.interchangeOmissions.mux.some(({ code }) => code === 'style-omitted'));
	assert.ok(adapted.interchangeOmissions.mux.some(({ code }) => code === 'word-timing-omitted'));
	assert.deepEqual(
		createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
			trackId: 'captions-en', mux: true, burnIn: true, sidecar: 'vtt',
		}, {
			profileId: 'encode-mov-prores-422-hq', sampleRate: 48_000,
			range: { startFrame: 24_000, endFrame: 96_000 },
			canvas: { width: 1_920, height: 1_080 },
		}).delivery,
		adapted.delivery,
	);
	const restyled = structuredClone(captionTrack());
	restyled.styles[0]!.foregroundColor = '#ffff00ff';
	const restyledAdapter = createFramescaperCaptionDeliveryAdapterV28(restyled, {
		trackId: 'captions-en', mux: true, burnIn: true, sidecar: 'vtt',
	}, {
		profileId: 'encode-mov-prores-422-hq', sampleRate: 48_000,
		range: { startFrame: 24_000, endFrame: 96_000 },
		canvas: { width: 1_920, height: 1_080 },
	});
	assert.notEqual(restyledAdapter.delivery.cueSetSha256, adapted.delivery.cueSetSha256);
	assert.notEqual(restyledAdapter.delivery.burnIn?.planSha256, adapted.delivery.burnIn?.planSha256);
	assert.equal(restyledAdapter.muxDocument?.sha256, adapted.muxDocument?.sha256,
		'mov_text omits authored color, so only the source/burn authority changes');
});

test('caption availability derives from the native profile and protects authored alpha', () => {
	assert.deepEqual(framescaperCaptionDeliveryAvailabilityV28('encode-mov-prores-422-hq'), {
		muxCodec: 'mov_text', burnIn: true, burnInRefusal: null,
	});
	assert.deepEqual(framescaperCaptionDeliveryAvailabilityV28('encode-mov-prores-4444'), {
		muxCodec: 'mov_text', burnIn: false,
		burnInRefusal: 'Caption burn-in would replace authored ProRes 4444 alpha.',
	});
	assert.deepEqual(framescaperCaptionDeliveryAvailabilityV28('encode-png-sequence'), {
		muxCodec: null, burnIn: true, burnInRefusal: null,
	});
});

test('WebM mux authority carries WebVTT bytes rather than a mislabeled SubRip document', () => {
	const adapted = createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
	}, {
		profileId: 'encode-webm-vp9', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 96_000 }, canvas: { width: 1_920, height: 1_080 },
	});
	assert.equal(adapted.delivery.mux?.codec, 'webvtt');
	assert.equal(adapted.muxDocument?.format, 'webvtt');
	assert.match(adapted.muxDocument?.text ?? '', /^WEBVTT/u);
});

test('V28 refuses unsupported mux and ProRes 4444 burn before producing an adapter', () => {
	assert.throws(() => createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
	}, {
		profileId: 'encode-png-sequence', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 96_000 }, canvas: { width: 1_920, height: 1_080 },
	}), /image2.*mux|cannot.*mux/iu);
	assert.throws(() => createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: false, burnIn: true, sidecar: null,
	}, {
		profileId: 'encode-mov-prores-4444', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 96_000 }, canvas: { width: 1_920, height: 1_080 },
	}), /ProRes 4444.*alpha/iu);
});

test('PNG burn-in declares that caption pixels are composited into authored alpha', () => {
	const adapted = createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: false, burnIn: true, sidecar: null,
	}, {
		profileId: 'encode-png-sequence', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 96_000 }, canvas: { width: 1_920, height: 1_080 },
	});
	assert.equal(adapted.delivery.burnIn?.alphaDisposition, 'caption-composited');
	for (const profileId of [
		'encode-matroska-ffv1', 'encode-tiff-sequence', 'encode-openexr-sequence',
	] as const) {
		const alpha = createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
			trackId: 'captions-en', mux: false, burnIn: true, sidecar: null,
		}, {
			profileId, sampleRate: 48_000, range: { startFrame: 0, endFrame: 96_000 },
			canvas: { width: 1_920, height: 1_080 },
		});
		assert.equal(alpha.delivery.burnIn?.alphaDisposition, 'caption-composited', profileId);
	}
});

test('V28 refuses detached tracks and ranges with no delivered cues', () => {
	assert.throws(() => createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'another-track', mux: false, burnIn: false, sidecar: 'srt',
	}, {
		profileId: 'encode-mov-prores-422-hq', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 1 }, canvas: { width: 1_920, height: 1_080 },
	}), /track.*does not match/iu);
	assert.throws(() => createFramescaperCaptionDeliveryAdapterV28(captionTrack(), {
		trackId: 'captions-en', mux: false, burnIn: false, sidecar: 'srt',
	}, {
		profileId: 'encode-mov-prores-422-hq', sampleRate: 48_000,
		range: { startFrame: 200_000, endFrame: 300_000 }, canvas: { width: 1_920, height: 1_080 },
	}), /no captions.*range/iu);
});

function captionTrack() {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English', language: 'en',
		styles: [{
			schemaVersion: 1, id: 'style-main', fontFamily: 'soundscaper-sans', fontSizePercent: 5,
			foregroundColor: '#ffffffff', backgroundColor: '#000000cc', fontWeight: 'bold',
			fontStyle: 'normal', textDecoration: 'none', textAlign: 'center',
		}],
		regions: [], speakers: [],
		cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000, text: 'Hello',
			styleId: 'style-main', regionId: null, speakerId: null,
			words: [{ startFrame: 0, endFrame: 48_000, text: 'Hello' }],
		}, {
			schemaVersion: 1, id: 'cue-2', startFrame: 72_000, endFrame: 120_000, text: 'World',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}
