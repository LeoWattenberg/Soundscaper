/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { VideoClipFadeHandles } from '../src/common/editor/ui/timeline/VideoClipFadeHandles.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const edge of ['in', 'out'] as const) test(`Escape cancels the ${edge} video opacity fade without publishing keyframes`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	const clip = { id: 'video', sequenceFrameCount: 120, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [], videoKeyframes: createDefaultVideoKeyframeCurves(120) };
	try {
		await act(async () => root.render(<VideoClipFadeHandles
			controller={{ actions: { edit: { commit: (command: unknown) => commits.push(command) } } }}
			project={{ clips: [clip] }} clip={{ id: 'video', kind: 'video', timelineStartFrame: 0, durationFrames: 96_000 }}
			selected visibleStartFrame={0} visibleEndFrame={96_000} pixelsPerSecond={100}
			sampleRate={48_000} blocked={false} copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out' }}
			run={operation => operation()} />));
		const fade = dom.one(`[data-video-clip-fade-handle="${edge}"]`);
		Object.assign(fade, { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
		const pointer = { currentTarget: fade, pointerId: 1, button: 0, clientX: 50,
			preventDefault() {}, stopPropagation() {} };
		const moved = { ...pointer, clientX: edge === 'in' ? 75 : 25 };
		await act(async () => reactProps(fade).onPointerDown?.(pointer));
		await act(async () => reactProps(fade).onPointerMove?.(moved));
		assert.ok(Number(fade.getAttribute('aria-valuenow')) > 0);
		await act(async () => reactProps(fade).onKeyDown?.({ key: 'Escape', currentTarget: fade,
			preventDefault() {}, stopPropagation() {} }));
		assert.equal(fade.getAttribute('aria-valuenow'), '0');
		await act(async () => reactProps(fade).onPointerUp?.(moved));
		assert.equal(commits.length, 0);
		await act(async () => reactProps(fade).onPointerDown?.(pointer));
		await act(async () => reactProps(fade).onPointerUp?.(moved));
		assert.equal(commits.length, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
