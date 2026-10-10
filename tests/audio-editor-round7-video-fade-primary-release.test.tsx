/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves, normalizeVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import { VideoClipFadeHandles } from '../src/common/editor/ui/timeline/VideoClipFadeHandles.tsx';
import { readVideoFadeEnvelope } from '../src/common/editor/ui/timeline/video-fade-envelope.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const edge of ['in', 'out'] as const) {
	for (const mode of ['middle release', 'right release', 'auxiliary held', 'foreign move', 'pen', 'touch'] as const) {
		test(`video ${edge} opacity completes only its primary mouse release: ${mode}`, async () => {
			const dom = installReactTestDom();
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const commits: ReturnType<typeof createSetVideoKeyframesCommand>[] = [];
			const clip = { id: 'video', sequenceFrameCount: 120, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [], videoKeyframes: createDefaultVideoKeyframeCurves(120) };
			try {
				await act(async () => root.render(<VideoClipFadeHandles
					controller={{ actions: { edit: { commit: command => { commits.push(command); } } } }}
					project={{ clips: [clip] }} clip={{ id: clip.id, kind: 'video', timelineStartFrame: 0, durationFrames: 96_000 }}
					selected visibleStartFrame={0} visibleEndFrame={96_000} pixelsPerSecond={100}
					sampleRate={48_000} blocked={false} copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out' }}
					run={operation => operation()} />));
				const fade = dom.one(`[data-video-clip-fade-handle="${edge}"]`);
				Object.assign(fade, { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
				const pointerType = mode === 'pen' || mode === 'touch' ? mode : 'mouse';
				const pointer = { currentTarget: fade, pointerId: 1, pointerType, button: 0, buttons: 1, clientX: 50,
					preventDefault() {}, stopPropagation() {} };
				const final = { ...pointer, clientX: edge === 'in' ? 75 : 25 };
				await act(async () => { reactProps(fade).onPointerDown?.(pointer); });
				await act(async () => { reactProps(fade).onPointerMove?.(final); });
				assert.equal(Number(fade.getAttribute('aria-valuenow')), 0.25);
				const release = mode === 'middle release' || mode === 'right release';
				await act(async () => { reactProps(fade).onPointerMove?.({ ...final,
					button: release ? 0 : -1,
					buttons: mode === 'right release' ? 2 : mode === 'middle release' ? 4 : mode === 'auxiliary held' ? 5 : 0,
					pointerId: mode === 'foreign move' ? 2 : 1,
				}); });
				assert.equal(commits.length, release ? 1 : 0);
				if (release) {
					await act(async () => { reactProps(fade).onLostPointerCapture?.({ ...final, buttons: 4, button: -1 }); });
					await act(async () => { reactProps(fade).onPointerMove?.({ ...final, buttons: 4, button: -1,
						clientX: edge === 'in' ? 100 : 0 }); });
					await act(async () => { reactProps(fade).onPointerUp?.({ ...final, button: 1, buttons: 0 }); });
				} else {
					await act(async () => { reactProps(fade).onPointerUp?.({ ...final, buttons: 0 }); });
				}
				assert.equal(commits.length, 1);
				const keyframes = normalizeVideoKeyframeCurves(commits[0]!.keyframes,
					{ duration: clip.sequenceFrameCount, composition: clip.videoComposition, videoEffects: [] });
				const envelope = readVideoFadeEnvelope({ ...clip, videoKeyframes: keyframes });
				assert.equal(edge === 'in' ? envelope?.fadeInFrames : envelope?.fadeOutFrames, 15);
				assert.equal(edge === 'in' ? envelope?.fadeOutFrames : envelope?.fadeInFrames, 0);
				assert.deepEqual(clip.videoKeyframes, createDefaultVideoKeyframeCurves(120));
			} finally {
				await act(async () => root.unmount());
				globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
				dom.restore();
			}
		});
	}
}
