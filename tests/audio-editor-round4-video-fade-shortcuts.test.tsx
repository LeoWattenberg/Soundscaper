/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves, normalizeVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import { readVideoFadeEnvelope } from '../src/common/editor/ui/timeline/video-fade-envelope.ts';
import { VideoClipFadeHandles } from '../src/common/editor/ui/timeline/VideoClipFadeHandles.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('video fade keyboard ownership preserves workspace modifiers and its native arrow edits', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.restore(); });
	const commits: ReturnType<typeof createSetVideoKeyframesCommand>[] = [];
	const clip = { id: 'video', sequenceFrameCount: 120, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [], videoKeyframes: createDefaultVideoKeyframeCurves(120) };
	await act(async () => root.render(<VideoClipFadeHandles
		controller={{ actions: { edit: { commit: command => commits.push(command) } } }}
		project={{ clips: [clip] }} clip={{ id: 'video', kind: 'video', timelineStartFrame: 0, durationFrames: 96_000 }}
		selected visibleStartFrame={0} visibleEndFrame={96_000} pixelsPerSecond={100}
		sampleRate={48_000} blocked={false} copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out' }} run={operation => operation()} />));
	const fade = dom.one('[data-video-clip-fade-handle="in"]');
	for (const fields of [{ key: 'z', ctrlKey: true }, { key: 'ArrowRight', metaKey: true },
		{ key: 'Home', altKey: true }, { key: 'Enter' }, { key: 'Escape' }]) {
		let stopped = 0; let prevented = 0;
		await act(async () => reactProps(fade).onKeyDown?.({ currentTarget: fade, ...fields,
			preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } }));
		assert.equal(stopped, 0, JSON.stringify(fields)); assert.equal(prevented, 0);
	}
	assert.equal(commits.length, 0);
	let stopped = 0; let prevented = 0;
	await act(async () => reactProps(fade).onKeyDown?.({ currentTarget: fade, key: 'ArrowRight',
		preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } }));
	assert.equal(stopped, 1); assert.equal(prevented, 1); assert.equal(commits.length, 1);
	const keyframes = normalizeVideoKeyframeCurves(commits[0]!.keyframes,
		{ duration: 120, composition: clip.videoComposition, videoEffects: [] });
	assert.equal(readVideoFadeEnvelope({ ...clip, videoKeyframes: keyframes })?.fadeInFrames, 1);
});
