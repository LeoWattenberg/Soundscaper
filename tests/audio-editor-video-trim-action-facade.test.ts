/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoTrimActionFacade } from '../src/common/editor/controller/video-trim-action-facade.ts';
import type { VideoTrimServices } from '../src/common/editor/controller/video-trim-composition.ts';

test('video trim facade exposes the exact nested slip/slide preview and commit path', () => {
	const events: unknown[][] = [];
	const callable = (name: string) => (request: unknown): unknown => {
		events.push([name, request]);
		return request;
	};
	const facade = createVideoTrimActionFacade({
		videoCompositing: true,
		productName: 'Framescaper',
		services: {
			edge: { preview: callable('edge-preview'), commit: callable('edge-commit') },
			rollRipple: { preview: callable('roll-preview'), commit: callable('roll-commit') },
			slipSlide: {
				buildStepRequest: callable('slip-slide-step'),
				preview: callable('slip-slide-preview'),
				commit: callable('slip-slide-commit'),
			},
		} as unknown as VideoTrimServices,
	});
	const step = Object.freeze({
		mode: 'slip' as const,
		activeClipId: 'video-clip',
		direction: 'later' as const,
	});
	const request = Object.freeze({
		mode: 'slip' as const,
		activeClipId: 'video-clip',
		requestedSourceInFrame: 41,
	});

	assert.equal(facade.slipSlide.buildStepRequest(step), step);
	assert.equal(facade.slipSlide.preview(request), request);
	assert.equal(facade.slipSlide.commit(request), request);
	assert.deepEqual(events, [
		['slip-slide-step', step],
		['slip-slide-preview', request],
		['slip-slide-commit', request],
	]);
	assert.equal(Object.isFrozen(facade), true);
	assert.equal(Object.isFrozen(facade.slipSlide), true);
});

test('Soundscaper capability rejection reaches both slip/slide ports before service dispatch', () => {
	let dispatches = 0;
	const unavailable = () => { dispatches += 1; return undefined; };
	const facade = createVideoTrimActionFacade({
		videoCompositing: false,
		productName: 'Soundscaper',
		services: {
			edge: { preview: unavailable, commit: unavailable },
			rollRipple: { preview: unavailable, commit: unavailable },
			slipSlide: { buildStepRequest: unavailable, preview: unavailable, commit: unavailable },
		} as unknown as VideoTrimServices,
	});
	const step = Object.freeze({
		mode: 'slide' as const,
		activeClipId: 'video-clip',
		direction: 'earlier' as const,
	});
	const request = Object.freeze({
		mode: 'slide' as const,
		activeClipId: 'video-clip',
		requestedStartSample: 48_000,
	});

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
	assert.equal(dispatches, 0);
});
