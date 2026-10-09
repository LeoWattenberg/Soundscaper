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
	for (const interrupt of ['same handle', 'opposite handle', 'foreign cancel', 'owning control', 'owning cancel'] as const) {
		test(`video ${edge} opacity retains its pointer through ${interrupt}`, async () => {
			const dom = installReactTestDom();
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const commits: ReturnType<typeof createSetVideoKeyframesCommand>[] = [];
			const captures: number[] = [];
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
				const opposite = dom.one(`[data-video-clip-fade-handle="${edge === 'in' ? 'out' : 'in'}"]`);
				for (const handle of [fade, opposite]) Object.assign(handle, {
					setPointerCapture: (pointerId: number) => { captures.push(pointerId); },
					hasPointerCapture: () => true, releasePointerCapture() {},
				});
				const pointer = { currentTarget: fade, pointerId: 1, pointerType: 'touch', button: 0, clientX: 50,
					preventDefault() {}, stopPropagation() {} };
				const final = { ...pointer, clientX: edge === 'in' ? 75 : 25 };
				await act(async () => { reactProps(fade).onPointerDown?.(pointer); });
				await act(async () => { reactProps(fade).onPointerMove?.({ ...pointer, clientX: edge === 'in' ? 60 : 40 }); });
				assert.equal(Number(fade.getAttribute('aria-valuenow')), 0.1);
				if (interrupt === 'foreign cancel') {
					await act(async () => { reactProps(opposite).onPointerCancel?.({ ...pointer, currentTarget: opposite, pointerId: 2 }); });
				} else if (interrupt === 'owning cancel') {
					await act(async () => { reactProps(fade).onPointerCancel?.(pointer); });
					assert.equal(fade.getAttribute('aria-valuenow'), '0');
					await act(async () => { reactProps(fade).onPointerUp?.(final); });
					assert.equal(commits.length, 0);
					await act(async () => { reactProps(fade).onPointerDown?.({ ...pointer, pointerId: 3 }); });
				} else if (interrupt !== 'owning control') {
					const other = interrupt === 'same handle' ? fade : opposite;
					const secondary = { ...pointer, currentTarget: other, pointerId: 2, clientX: 65 };
					await act(async () => { reactProps(other).onPointerDown?.(secondary); });
					await act(async () => { reactProps(other).onPointerMove?.({ ...secondary, clientX: 80 }); });
					await act(async () => { reactProps(other).onPointerUp?.({ ...secondary, clientX: 80 }); });
				}
				await act(async () => { reactProps(fade).onPointerUp?.({ ...final, pointerId: interrupt === 'owning cancel' ? 3 : 1 }); });
				assert.deepEqual(captures, interrupt === 'owning cancel' ? [1, 3] : [1]);
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
