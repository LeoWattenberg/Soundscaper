/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TIMELINE_MAX_SCROLL_PIXELS,
	createTimelineScrollSpace,
	readTimelineContentScrollX,
	readTimelineScrollScale,
	timelineContentLeft,
	timelineContentScrollX,
	timelineDomScrollForElement,
	timelineDomScrollX,
	timelineRenderOriginX,
} from '../src/common/editor/ui/timeline/timeline-scroll-space.ts';

const VIEWPORT = 1_200;

test('a project that fits under the cap is laid out at its true width', () => {
	const space = createTimelineScrollSpace({ contentWidth: 240_000, viewportWidth: VIEWPORT });
	assert.equal(space.scrollWidth, 240_000);
	assert.equal(space.scale, 1);
	assert.equal(timelineContentScrollX(space, 8_000), 8_000);
	assert.equal(timelineDomScrollX(space, 8_000), 8_000);
	assert.equal(timelineRenderOriginX(space, 8_000), 0);
	assert.equal(timelineContentLeft(512), 'calc(512px + var(--timeline-render-origin-x, 0px))');
});

test('a timeline narrower than its viewport still scrolls nowhere', () => {
	const space = createTimelineScrollSpace({ contentWidth: 400, viewportWidth: VIEWPORT });
	assert.equal(space.scrollWidth, VIEWPORT);
	assert.equal(space.contentWidth, VIEWPORT);
	assert.equal(space.scale, 1);
	assert.equal(timelineContentScrollX(space, 900), 0);
});

test('sample-depth zoom caps the surface and scales the scroll offset onto it', () => {
	// Ten minutes at Audacity's deepest zoom: far wider than a browser lays out.
	const contentWidth = 600 * 6_000_000;
	const space = createTimelineScrollSpace({ contentWidth, viewportWidth: VIEWPORT });
	assert.equal(space.scrollWidth, TIMELINE_MAX_SCROLL_PIXELS);
	assert.ok(space.scale > 1);

	const domTravel = space.scrollWidth - VIEWPORT;
	assert.equal(timelineContentScrollX(space, 0), 0);
	assert.equal(timelineContentScrollX(space, domTravel), contentWidth - VIEWPORT);
	assert.equal(timelineDomScrollX(space, contentWidth - VIEWPORT), domTravel);

	// Content drawn at its coordinate plus the origin lands under the scroll box.
	const domScrollLeft = domTravel / 3;
	const origin = timelineRenderOriginX(space, domScrollLeft);
	assert.ok(Math.abs(timelineContentScrollX(space, domScrollLeft) + origin - domScrollLeft) < 1e-6);
	assert.ok(origin < 0);
});

test('positions round-trip through the scaled scroll space', () => {
	const space = createTimelineScrollSpace({ contentWidth: 4_000_000_000, viewportWidth: VIEWPORT });
	for (const contentScrollX of [0, 1_000, 1_500_000, 3_999_998_800]) {
		const dom = timelineDomScrollX(space, contentScrollX);
		assert.ok(dom >= 0 && dom <= space.scrollWidth - VIEWPORT);
		assert.ok(Math.abs(timelineContentScrollX(space, dom) - contentScrollX) < 1e-3);
	}
});

test('scroll spaces reject impossible geometry', () => {
	assert.throws(() => createTimelineScrollSpace({ contentWidth: 0, viewportWidth: VIEWPORT }), /contentWidth/u);
	assert.throws(() => createTimelineScrollSpace({ contentWidth: 10, viewportWidth: 0 }), /viewportWidth/u);
	assert.throws(
		() => createTimelineScrollSpace({ contentWidth: 10, viewportWidth: 5, maximumScrollWidth: Number.NaN }),
		/maximumScrollWidth/u,
	);
});

test('live scroll elements publish their scale for DOM-level navigation', () => {
	const element = { scrollLeft: 4_000, scrollWidth: 16_000, clientWidth: 1_000, dataset: { timelineScrollScale: '2.5' } };
	assert.equal(readTimelineScrollScale(element as never), 2.5);
	assert.equal(readTimelineContentScrollX(element as never), 10_000);
	assert.equal(timelineDomScrollForElement(element as never, 10_000), 4_000);
	// Requests beyond the surface clamp to its end rather than overscrolling.
	assert.equal(timelineDomScrollForElement(element as never, 10_000_000), 15_000);

	const unscaled = { scrollLeft: 320, scrollWidth: 4_000, clientWidth: 1_000, dataset: {} };
	assert.equal(readTimelineScrollScale(unscaled as never), 1);
	assert.equal(readTimelineContentScrollX(unscaled as never), 320);
	assert.equal(timelineDomScrollForElement(unscaled as never, 320), 320);
	assert.equal(readTimelineContentScrollX(null), 0);
});
