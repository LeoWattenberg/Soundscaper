/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoClipFadeHandles } from '../src/common/editor/ui/timeline/VideoClipFadeHandles.tsx';
import { createVideoFadeKeyframes } from '../src/common/editor/ui/timeline/video-fade-envelope.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const mutation of ['opacity Undo', 'equivalent publication', 'title update'] as const) {
	test(`video fade keeps its field authority through ${mutation}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const base = { id: 'video', title: 'Camera', sequenceFrameCount: 120, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [], videoKeyframes: createDefaultVideoKeyframeCurves(120) };
		let clip = { ...base, videoKeyframes: createVideoFadeKeyframes(base, 'in', 15) };
		const commits: ReturnType<typeof createSetVideoKeyframesCommand>[] = [];
		const root = createRoot(dom.container as unknown as Element);
		const render = async () => act(async () => { root.render(<VideoClipFadeHandles
			controller={{ actions: { edit: { commit: command => { commits.push(command); } } } }} project={{ clips: [clip] }}
			clip={{ id: clip.id, kind: 'video', timelineStartFrame: 0, durationFrames: 96_000 }}
			selected visibleStartFrame={0} visibleEndFrame={96_000} pixelsPerSecond={100} sampleRate={48_000}
			blocked={false} copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out' }} run={operation => operation()} />); });
		try {
			await render();
			const fade = dom.one('[data-video-clip-fade-handle="in"]');
			let captured = false;
			Object.assign(fade, { setPointerCapture() { captured = true; }, hasPointerCapture: () => captured,
				releasePointerCapture() { captured = false; } });
			const pointer = { currentTarget: fade, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 50,
				preventDefault() {}, stopPropagation() {} };
			await act(async () => { reactProps(fade).onPointerDown(pointer); });
			await act(async () => { reactProps(fade).onPointerMove({ ...pointer, clientX: 75 }); });
			assert.equal(Number(fade.getAttribute('aria-valuenow')), 0.5);
			clip = mutation === 'opacity Undo' ? { ...base } : mutation === 'title update'
				? { ...clip, title: 'Renamed' } : structuredClone(clip);
			await render();
			await act(async () => { reactProps(fade).onPointerMove({ ...pointer, clientX: 85 }); });
			await act(async () => { reactProps(fade).onPointerUp({ ...pointer, buttons: 0, clientX: 85 }); });
			assert.equal(commits.length, mutation === 'opacity Undo' ? 0 : 1);
			if (mutation === 'opacity Undo') {
				assert.equal(fade.getAttribute('aria-valuenow'), '0');
				assert.equal(captured, false, 'retired opacity also releases native capture');
				await act(async () => { reactProps(fade).onPointerDown(pointer); });
				await act(async () => { reactProps(fade).onPointerMove({ ...pointer, clientX: 75 }); });
				await act(async () => { reactProps(fade).onPointerUp({ ...pointer, buttons: 0, clientX: 75 }); });
				assert.equal(commits.length, 1, 'a subsequent native gesture still commits');
				assert.deepEqual(commits[0]?.expectedKeyframes, clip.videoKeyframes);
			} else {
				assert.deepEqual(commits[0]?.expectedKeyframes, clip.videoKeyframes);
			}
		} finally {
			await act(async () => { root.unmount(); });
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		}
	});
}
