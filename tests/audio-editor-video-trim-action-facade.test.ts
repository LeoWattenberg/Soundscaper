/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoTrimActionFacade } from '../src/common/editor/controller/video-trim-action-facade.ts';
import type { VideoTrimServices } from '../src/common/editor/controller/video-trim-composition.ts';

test('video trim facade exposes exact step, slip/slide, and rate-stretch paths', () => {
	const events: unknown[][] = [];
	const callable = (name: string) => (request: unknown): unknown => {
		events.push([name, request]);
		return request;
	};
	const facade = createVideoTrimActionFacade({
		videoCompositing: true,
		productName: 'Framescaper',
		services: {
			edge: {
				preview: callable('edge-preview'),
				commit: callable('edge-commit'),
				commitStep: callable('edge-step'),
			},
			rollRipple: { preview: callable('roll-preview'), commit: callable('roll-commit') },
			slipSlide: {
				capturePointerAuthority: callable('slip-slide-pointer'),
				buildStepRequest: callable('slip-slide-step'),
				preview: callable('slip-slide-preview'),
				commit: callable('slip-slide-commit'),
			},
			rateStretch: {
				preview: callable('rate-stretch-preview'),
				commit: callable('rate-stretch-commit'),
				commitStep: callable('rate-stretch-step'),
			},
		} as unknown as VideoTrimServices,
	});
	const step = Object.freeze({
		mode: 'slip' as const,
		activeClipId: 'video-clip',
		direction: 'later' as const,
	});
	const pointer = Object.freeze({
		mode: 'slip' as const,
		activeClipId: 'video-clip',
		pointerDownSample: 24_000,
	});
	const request = Object.freeze({
		mode: 'slip' as const,
		activeClipId: 'video-clip',
		requestedSourceInFrame: 41,
	});
	const rateStretchRequest = Object.freeze({
		activeClipId: 'video-clip',
		edge: 'right' as const,
		requestedBoundarySample: 48_000,
	});
	const clipFocusStep = Object.freeze({
		activeClipId: 'linked-audio',
		edge: 'right' as const,
		direction: 'outward' as const,
	});

	assert.equal(facade.commitStep(clipFocusStep), clipFocusStep);
	assert.equal(facade.slipSlide.capturePointerAuthority(pointer), pointer);
	assert.equal(facade.slipSlide.buildStepRequest(step), step);
	assert.equal(facade.slipSlide.preview(request), request);
	assert.equal(facade.slipSlide.commit(request), request);
	assert.equal(facade.rateStretch.preview(rateStretchRequest), rateStretchRequest);
	assert.equal(facade.rateStretch.commit(rateStretchRequest), rateStretchRequest);
	assert.equal(facade.rateStretch.commitStep(clipFocusStep), clipFocusStep);
	assert.deepEqual(events, [
		['edge-step', clipFocusStep],
		['slip-slide-pointer', pointer],
		['slip-slide-step', step],
		['slip-slide-preview', request],
		['slip-slide-commit', request],
		['rate-stretch-preview', rateStretchRequest],
		['rate-stretch-commit', rateStretchRequest],
		['rate-stretch-step', clipFocusStep],
	]);
	assert.equal(Object.isFrozen(facade), true);
	assert.equal(Object.isFrozen(facade.slipSlide), true);
	assert.equal(Object.isFrozen(facade.rateStretch), true);
});

test('Soundscaper capability rejection reaches every nested trim port before service dispatch', () => {
	let dispatches = 0;
	const unavailable = () => { dispatches += 1; return undefined; };
	const facade = createVideoTrimActionFacade({
		videoCompositing: false,
		productName: 'Soundscaper',
		services: {
			edge: { preview: unavailable, commit: unavailable, commitStep: unavailable },
			rollRipple: { preview: unavailable, commit: unavailable },
			slipSlide: {
				capturePointerAuthority: unavailable,
				buildStepRequest: unavailable,
				preview: unavailable,
				commit: unavailable,
			},
			rateStretch: { preview: unavailable, commit: unavailable, commitStep: unavailable },
		} as unknown as VideoTrimServices,
	});
	const step = Object.freeze({
		mode: 'slide' as const,
		activeClipId: 'video-clip',
		direction: 'earlier' as const,
	});
	const pointer = Object.freeze({
		mode: 'slide' as const,
		activeClipId: 'video-clip',
		pointerDownSample: 48_000,
	});
	const request = Object.freeze({
		mode: 'slide' as const,
		activeClipId: 'video-clip',
		requestedStartSample: 48_000,
	});
	const rateStretchRequest = Object.freeze({
		activeClipId: 'video-clip', edge: 'left' as const, requestedBoundarySample: 24_000,
	});
	const clipFocusStep = Object.freeze({
		activeClipId: 'linked-audio', edge: 'right' as const, direction: 'outward' as const,
	});

	assert.throws(
		() => facade.commitStep(clipFocusStep),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.slipSlide.capturePointerAuthority(pointer),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.slipSlide.buildStepRequest(step),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.slipSlide.preview(request),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.slipSlide.commit(request),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.rateStretch.preview(rateStretchRequest),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.rateStretch.commit(rateStretchRequest),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.throws(
		() => facade.rateStretch.commitStep(clipFocusStep),
		/Soundscaper does not support videoCompositing/u,
	);
	assert.equal(dispatches, 0);
});
