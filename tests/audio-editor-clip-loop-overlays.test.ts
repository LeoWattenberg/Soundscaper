/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { ClipLoopOverlays } from '../src/common/editor/ui/timeline/ClipLoopOverlays.tsx';
import { clipLoopUpdateFields, type LoopAudioClip } from '../src/common/editor/audio-clip-loop.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const clip = {
	id: 'clip', kind: 'audio', anchor: 'samples', timelineStartFrame: 0,
	durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
};
type Clip = typeof clip & LoopAudioClip;
type LoopChanges = { loop: {
	periodFrames: number; durationFrames: number; offsetFrames?: number; sourceStartFrame?: number; sourceDurationFrames?: number;
} };

function OverlayFixture({ current, selected = true, onChange }: {
	current: Clip; selected?: boolean; onChange: (id: string, changes: LoopChanges) => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	return React.createElement('div', { ref: rootRef },
		React.createElement('div', { 'data-clip-id': current.id },
			React.createElement('button', { className: 'clip-display__handle--trim-right' })),
		React.createElement(ClipLoopOverlays, {
			rootRef, clips: [current], startFrame: 0, endFrame: 480_000, pixelsPerSecond: 100,
			sampleRate: 48_000, blocked: false, selectedIds: new Set(selected ? [current.id] : []), copy: {}, onChange,
		}),
	);
}

test('selected single-pass clips expose the loop icon and keyboard handle without opting in', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: LoopChanges[] = [];
	const onChange = (_id: string, change: LoopChanges) => { changes.push(change); };
	try {
		await act(async () => root.render(React.createElement(OverlayFixture, { current: clip, onChange })));
		const handle = dom.one('.clip-display__handle--loop-right');
		assert.equal(handle.getAttribute('aria-label'), 'Looped clip length');
		assert.equal(handle.textContent, '\uEF1F');
		assert.equal(dom.container.querySelectorAll('[data-loop-boundary-frame]').length, 0);
		await act(async () => reactProps(handle).onKeyDown({ key: 'ArrowRight', stopPropagation() {}, preventDefault() {} }));
		assert.deepEqual(changes, [{ loop: { periodFrames: 48_000, durationFrames: 96_000 } }]);
		await act(async () => root.render(React.createElement(OverlayFixture, { current: clip, selected: false, onChange })));
		assert.equal(dom.container.querySelector('.clip-display__handle--loop-right'), null);
		const legacyPartial = { ...clip, sourceDurationFrames: 96_000, opaqueExtensions: {
			'org.soundscaper.clip-loop/v1': { periodFrames: 96_000, offsetFrames: 24_000 },
		} };
		await act(async () => root.render(React.createElement(OverlayFixture, { current: legacyPartial, onChange })));
		await act(async () => reactProps(dom.one('.clip-display__handle--loop-right')).onKeyDown({ key: 'ArrowRight', stopPropagation() {}, preventDefault() {} }));
		assert.deepEqual(changes[1], { loop: { periodFrames: 48_000, durationFrames: 96_000,
			offsetFrames: 0, sourceStartFrame: 24_000, sourceDurationFrames: 48_000 } });
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('trim stays at its native position for a single pass and returns there after repeats shrink', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const onChange = () => {};
	const repeated = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 48_000, durationFrames: 192_000 }) };
	try {
		await act(async () => root.render(React.createElement(OverlayFixture, { current: clip, onChange })));
		const trim = dom.one('.clip-display__handle--trim-right');
		const style = trim.style as unknown as CSSStyleDeclaration;
		assert.equal(style.right, '');
		await act(async () => root.render(React.createElement(OverlayFixture, { current: repeated, onChange })));
		assert.equal(style.right, '300px');
		assert.equal(dom.container.querySelectorAll('[data-loop-boundary-frame]').length, 3);
		const singlePass = { ...repeated, durationFrames: clip.durationFrames };
		await act(async () => root.render(React.createElement(OverlayFixture, { current: singlePass, onChange })));
		assert.equal(style.right, '');
		assert.equal(style.visibility, '');
		assert.equal(dom.container.querySelectorAll('[data-loop-boundary-frame]').length, 0);
		assert.ok(dom.container.querySelector('.clip-display__handle--loop-right'));
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
