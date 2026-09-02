/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationOverlay } from '../src/common/editor/ui/timeline/TrackAutomationOverlay.tsx';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('inline automation exposes keyboard insertion, explicit deletion, and one-command Bézier drags', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const props = overlayProps(commands);
	try {
		await act(async () => root.render(<TrackAutomationOverlay {...props} />));
		const svg = dom.one('[data-track-automation-overlay]');
		(svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
			left: 0, top: 0, width: 112, height: 100,
		});
		assert.equal(svg.querySelectorAll('[data-automation-bezier-control]').length, 2);

		await act(async () => reactProps(dom.one('[data-automation-insert-point]')).onKeyDown?.({
			key: 'i', preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 1);
		assert.equal(command(commands[0]).type, 'automation-lane/set');
		assert.equal(array(command(command(commands[0]).lane).points).length, 3);

		commands.length = 0;
		await act(async () => reactProps(dom.one('[data-automation-insert-point]')).onContextMenu?.({
			clientX: 50, clientY: 45, preventDefault() {}, stopPropagation() {},
		}));
		const deleteButton = dom.one('button').parentNode?.childNodes
			.find((node) => node.textContent === 'Delete automation lane');
		assert.ok(deleteButton);
		await act(async () => reactProps(deleteButton as never).onClick?.({}));
		assert.equal(commands.length, 1);
		assert.equal(command(commands[0]).lane, null);

		commands.length = 0;
		const handle = dom.one('[data-automation-bezier-control="0:control1"]');
		await act(async () => reactProps(handle).onPointerDown?.({
			button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerMove?.({
			clientX: 72, clientY: 45, preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerUp?.({
			pointerId: 1, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 1);
		const replacement = command(command(commands[0]).lane);
		const firstSegment = command(array(replacement.segments)[0]);
		const firstControl = command(firstSegment.control1);
		assert.equal(command(firstControl.position).num, 60);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('clip gain keeps the selected lane visible but owns every pointer hit', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			{...overlayProps([])}
			clipGainToolEnabled
		/>));
		const svg = dom.one('[data-track-automation-overlay]');
		assert.equal(svg.getAttribute('data-clip-gain-precedence'), 'true');
		assert.ok(dom.one('.audio-editor-track-automation-curve'));
		assert.equal(dom.find('[data-automation-insert-point]'), null);
		assert.equal(dom.find('[data-track-automation-interactive]'), null);
		assert.equal(reactProps(svg).onClick, undefined);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('the first pointer edit uses pointer height while retaining the frame-zero baseline', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			{...overlayProps(commands)}
			target={{ ...TARGET, lane: null, currentValue: 0 }}
		/>));
		const svg = dom.one('[data-track-automation-overlay]');
		(svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
			left: 0, top: 0, width: 112, height: 100,
		});
		await act(async () => reactProps(dom.one('[data-automation-insert-point]')).onPointerDown?.({
			button: 0, pointerId: 1, clientX: 62, clientY: 20,
			preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerUp?.({
			pointerId: 1, preventDefault() {}, stopPropagation() {},
		}));
		const lane = command(command(commands[0]).lane);
		assert.deepEqual((lane.points as Array<{ position: number; value: number }>).map(
			({ position, value }) => [position, value],
		), [[0, 0], [50, 1]]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('invalid discrete curve shortcuts announce feedback without committing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	const muteAddress = Object.freeze({
		kind: 'strip' as const,
		strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
		parameterId: 'mute' as const,
	});
	const muteDescriptor = stripParameterDescriptor(muteAddress);
	const target = Object.freeze({
		...TARGET,
		key: muteDescriptor.id,
		address: muteAddress,
		descriptor: muteDescriptor,
		label: 'Mute',
		lane: Object.freeze({
			id: 'mute-lane',
			address: muteAddress,
			timebase: 'absolute-samples' as const,
			points: Object.freeze([
				Object.freeze({ id: 'origin', position: 0, value: 0 }),
				Object.freeze({ id: 'end', position: 100, value: 1 }),
			]),
			segments: Object.freeze([Object.freeze({ kind: 'hold' as const })]),
		}),
	}) satisfies TrackAutomationTargetV21;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			{...overlayProps(commands)}
			target={target}
		/>));
		await act(async () => reactProps(dom.one('[data-automation-point-id="origin"]')).onKeyDown?.({
			key: 'b', preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 0);
		assert.match(dom.one('[role="status"]').textContent ?? '', /discrete|hold/iu);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('pointer cancellation discards its draft and a later release creates one history entry', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TrackAutomationOverlay {...overlayProps(commands)} />));
		const svg = dom.one('[data-track-automation-overlay]');
		(svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
			left: 0, top: 0, width: 112, height: 100,
		});
		await act(async () => reactProps(dom.one('[data-automation-point-id="origin"]')).onPointerDown?.({
			button: 0, pointerId: 1, clientX: 12, clientY: 90,
			preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerMove?.({
			clientX: 32, clientY: 70, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 0);
		await act(async () => reactProps(svg).onPointerCancel?.({
			pointerId: 1, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 0);

		await act(async () => reactProps(dom.one('[data-automation-point-id="origin"]')).onPointerDown?.({
			button: 0, pointerId: 2, clientX: 12, clientY: 90,
			preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerMove?.({
			clientX: 34, clientY: 65, preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerMove?.({
			clientX: 36, clientY: 60, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 0);
		await act(async () => reactProps(svg).onPointerUp?.({
			pointerId: 2, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(commands.length, 1);
		assert.equal(command(commands[0]).expected, TARGET.lane);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a stale drag release is announced without adding a history entry', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const attempts: unknown[] = [];
	const history: unknown[] = [];
	let currentLane: unknown = TARGET.lane;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<TrackAutomationOverlay
			{...overlayProps(history)}
			controller={{ actions: { edit: { commit: (value: unknown) => {
				attempts.push(value);
				if (command(value).expected !== currentLane) throw new Error('Stale automation command.');
				history.push(value);
			} } } }}
		/>));
		const svg = dom.one('[data-track-automation-overlay]');
		(svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
			left: 0, top: 0, width: 112, height: 100,
		});
		await act(async () => reactProps(dom.one('[data-automation-point-id="origin"]')).onPointerDown?.({
			button: 0, pointerId: 1, clientX: 12, clientY: 90,
			preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => reactProps(svg).onPointerMove?.({
			clientX: 30, clientY: 70, preventDefault() {}, stopPropagation() {},
		}));
		currentLane = { ...TARGET.lane };
		await act(async () => reactProps(svg).onPointerUp?.({
			pointerId: 1, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(attempts.length, 1);
		assert.equal(history.length, 0);
		assert.match(dom.one('[role="status"]').textContent ?? '', /stale automation/iu);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function overlayProps(commands: unknown[]) {
	return {
		controller: { actions: { edit: { commit: (value: unknown) => commands.push(value) } } },
		target: TARGET,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 100 }],
		renderViewportStartFrame: 0,
		viewportDurationFrames: 100,
		overscanStartFrame: 0,
		overscanEndFrame: 100,
		pixelsPerSecond: 100,
		sampleRate: 100,
		width: 112,
		height: 100,
		copy: {},
		run: (operation: () => unknown) => operation(),
	};
}

const address = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'pan' as const,
});
const descriptor = stripParameterDescriptor(address);
const TARGET = Object.freeze({
	key: descriptor.id,
	address,
	descriptor,
	label: 'Pan',
	groupLabel: 'Track',
	effectId: null,
	edgeId: null,
	currentValue: 0,
	disabledReason: null,
	lane: Object.freeze({
		id: 'pan-lane',
		address,
		timebase: 'absolute-samples' as const,
		points: Object.freeze([
			Object.freeze({ id: 'origin', position: 0, value: -1 }),
			Object.freeze({ id: 'end', position: 100, value: 1 }),
		]),
		segments: Object.freeze([Object.freeze({
			kind: 'bezier' as const,
			control1: Object.freeze({ position: Object.freeze({ num: 25, den: 1 }), value: -0.5 }),
			control2: Object.freeze({ position: Object.freeze({ num: 75, den: 1 }), value: 0.5 }),
		})]),
	}),
}) satisfies TrackAutomationTargetV21;

function command(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object');
	return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
	assert.ok(Array.isArray(value));
	return value;
}
