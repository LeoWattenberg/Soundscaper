/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, useRef } from 'react';
import { useTimelineNavigation } from '../src/common/editor/ui/timeline/useTimelineNavigation.js';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

interface Project {
	readonly id: string;
	readonly clips: readonly { readonly id: string; readonly timelineStartFrame: number; readonly durationFrames: number }[];
	readonly tracks: readonly { readonly id: string; readonly type: string; readonly clipIds: readonly string[] }[];
	readonly automationLanes?: readonly unknown[];
}
interface View {
	readonly project: Project | null;
	readonly revision: number;
	readonly clipId?: string;
	readonly pixelsPerSecond?: number;
	readonly viewportWidth?: number;
	readonly mounted?: boolean;
}
const project: Project = {
	id: 'project', clips: [{ id: 'clip', timelineStartFrame: 48_000, durationFrames: 48_000 }],
	tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
};
const idle = () => {};
const controller = { actions: { timeline: { setVisibleTrackHeights: idle } } };
const visibleTrackIds = new Set<string>();

test('completed search reveal does not steal point focus or scroll after a lane, zoom, or viewport change', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	await fixture.frame();
	assert.equal(fixture.active(), fixture.clip());
	const point = fixture.point();
	point.focus();
	for (const change of [
		{ project: { ...project, automationLanes: [{ id: 'lane' }] } },
		{ pixelsPerSecond: 240 }, { viewportWidth: 600 },
	]) {
		fixture.scroll.scrollLeft = 37;
		await fixture.render(change);
		await fixture.flush();
		assert.equal(fixture.active(), point);
		assert.equal(fixture.scroll.scrollLeft, 37);
	}
});

test('a new revision of the same clip request still reveals and focuses it', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	await fixture.frame();
	fixture.point().focus();
	await fixture.render({ revision: 2 });
	await fixture.frame();
	assert.equal(fixture.active(), fixture.clip());
});

test('a reveal waits for its project and exact clip node to be ready', async context => {
	const fixture = await mount(context, { project: null, revision: 1, mounted: false });
	assert.equal(fixture.pending(), 0);
	await fixture.render({ project });
	await fixture.frame();
	assert.notEqual(fixture.active(), fixture.otherClip());
	assert.equal(fixture.pending(), 1);
	await fixture.render({ mounted: true });
	await fixture.frame();
	assert.equal(fixture.active(), fixture.clip());
});

test('a project publication before the first reveal frame does not consume the canceled frame', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	await fixture.render({ project: { ...project, automationLanes: [] } });
	await fixture.frame();
	assert.equal(fixture.active(), fixture.clip());
});

test('pending search focus respects a deliberate connected SVG point focus', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	const point = fixture.point();
	point.focus();
	await fixture.render({ project: { ...project, automationLanes: [] } });
	await fixture.flush();
	assert.equal(fixture.active(), point);
	assert.equal(fixture.pending(), 0);
	await fixture.render({ viewportWidth: 500 });
	await fixture.flush();
	assert.equal(fixture.active(), point);
});

test('an unmounted search result can yield focus to the requested clip', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	const old = fixture.otherClip();
	old.focus();
	await fixture.render({ revision: 2 });
	old.parentNode?.removeChild(old);
	await fixture.frame();
	assert.equal(fixture.active(), fixture.clip());
});

test('unmount cancels the pending reveal frame', async context => {
	const fixture = await mount(context, { project, revision: 1 });
	assert.equal(fixture.pending(), 1);
	await fixture.unmount();
	assert.equal(fixture.pending(), 0);
});

async function mount(context: TestContext, initial: View) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const callbacks = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = ++nextFrame; callbacks.set(id, callback); return id;
	});
	context.mock.method(globalThis, 'cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let view = initial;
	let disposed = false;
	const unmount = async () => {
		if (disposed) return;
		disposed = true;
		await act(async () => root.unmount());
	};
	context.after(async () => { await unmount(); actGlobal.IS_REACT_ACT_ENVIRONMENT = beforeAct; dom.restore(); });
	function Harness(props: View) {
		const navigationRootRef = useRef<HTMLElement | null>(null);
		const scrollRef = useRef<HTMLDivElement | null>(null);
		const navigation = useTimelineNavigation({
			controller, showArmControls: false, automationVisibleTrackIds: visibleTrackIds,
			searchRevealRequest: { clipId: props.clipId ?? 'clip', revision: props.revision },
			state: { navigationRootRef, scrollRef, setScrollX: idle, timelineRef: idle },
			model: {
				project: props.project, pixelsPerSecond: props.pixelsPerSecond ?? 120,
				sampleRate: 48_000, timelineWidth: 2_000,
				viewportWidth: props.viewportWidth ?? 120, visualTrackHeight: () => 240,
			},
		});
		return <main ref={navigation.setTimelineNode}>
			<div ref={scrollRef} data-scroll="">
				<div className="audio-editor-track-row" data-track-index="0">
					<div data-clip-id="other" role="group" tabIndex={0} />
					{props.mounted !== false && <div data-clip-id="clip" role="group" tabIndex={0} />}
					<svg><circle data-automation-point-id="point" role="slider" tabIndex={0} /></svg>
				</div>
			</div>
		</main>;
	}
	await act(async () => root.render(<Harness {...view} />));
	// The lightweight mounted DOM deliberately supports simple selectors; give
	// this real navigation hook its two compound selectors without changing it.
	const navigationRoot = dom.one('main');
	const row = dom.one('[data-track-index="0"]');
	const query = navigationRoot.querySelector.bind(navigationRoot);
	context.mock.method(navigationRoot, 'querySelector', (selector: string) => (
		selector === '.audio-editor-track-row[data-track-index="0"]' ? row : query(selector)
	));
	const queryAll = row.querySelectorAll.bind(row);
	context.mock.method(row, 'querySelectorAll', (selector: string): ReactTestElement[] => (
		selector === '[data-clip-id][role="group"]'
			? queryAll('[data-clip-id]').filter(element => element.getAttribute('role') === 'group')
			: queryAll(selector)
	));
	const scroll = dom.one('[data-scroll]') as ReactTestElement & { scrollLeft: number };
	Object.assign(scroll, { scrollLeft: 0, scrollWidth: 2_000, clientWidth: 120 });
	const frame = async () => {
		const next = callbacks.entries().next().value;
		assert.ok(next, 'The requested focus frame must remain pending.');
		callbacks.delete(next[0]);
		await act(async () => next[1](0));
	};
	return {
		scroll, frame, unmount, pending: () => callbacks.size,
		active: () => dom.container.ownerDocument.activeElement,
		clip: () => dom.one('[data-clip-id="clip"]'),
		otherClip: () => dom.one('[data-clip-id="other"]'),
		point: () => dom.one('[data-automation-point-id]'),
		render: async (changes: Partial<View>) => {
			view = { ...view, ...changes };
			await act(async () => root.render(<Harness {...view} />));
		},
		flush: async () => { for (let i = 0; callbacks.size && i < 8; i += 1) await frame(); },
	};
}
