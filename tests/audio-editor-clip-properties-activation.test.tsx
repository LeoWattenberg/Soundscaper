/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const pending of ['bootstrap', 'project-activation'] as const) {
	test(`restored clip properties wait for ${pending} before reading exact source timing`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const recording = videoTimingProbeMedia.find(({ kind }) => kind === 'vfr');
		assert.ok(recording);
		const publication = createVideoTimingAssetPublication(recording.sourceSha256, {
			timescale: recording.timescale, presentationTicks: recording.presentationTicks,
			finalFrameDurationTicks: recording.finalFrameDurationTicks,
		});
		const source = { id: `source-${pending}`, kind: 'video', name: recording.file.name,
			frameRate: recording.nominalRate, sourceFrameCount: recording.presentationTicks.length,
			contentSha256: recording.sourceSha256, timingAsset: publication.reference,
			timingDecision: { mode: 'exact', rate: recording.nominalRate, backend: 'demuxer' },
		};
		const clip = { id: 'clip', kind: 'video', sourceId: source.id, title: 'Restored clip',
			timelineStartFrame: 0, durationFrames: 19_200, sourceStartFrame: 2, sourceDurationFrames: 4,
			videoEffects: [createVideoEffect('develop-geometry-v1', { id: 'geometry', params: { cropWidth: 0.5 } })],
		};
		const project = { id: 'project', sampleRate: 48_000, sources: [source], clips: [clip],
			tracks: [{ id: 'track', kind: 'video', clipIds: [clip.id] }] };
		const original = JSON.stringify(project), commits: unknown[] = [];
		const controller = { project, actions: { clip: { trim: (...args: unknown[]) => { commits.push(args); } } } };
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let handled = 0;
		const focusRequest = { clipId: clip.id, field: null, onHandled: () => { handled++; } } as const;
		try {
			await act(async () => { root.render(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY}
				focusRequest={focusRequest} snapshot={{ project, selectedClipId: clip.id,
					ready: pending !== 'bootstrap', projectActivationPending: pending === 'project-activation',
					capabilities: { audioEffects: false, videoEffects: true } }} />); });
			assert.equal(dom.one('[role="status"]').textContent, ENGLISH_COPY.loading);
			assert.equal(dom.find('[data-clip-field="sourceInFrame"]'), null);
			assert.equal(handled, 0, 'pending activation must not consume the opening focus request');
			assert.deepEqual(commits, []);
			registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
			await act(async () => { root.render(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY}
				focusRequest={focusRequest} snapshot={{ project, selectedClipId: clip.id, ready: true,
					projectActivationPending: false, capabilities: { audioEffects: false, videoEffects: true } }} />); });
			assert.equal(dom.find('[role="status"]'), null);
			const field = dom.one('[data-clip-field="sourceInFrame"]');
			assert.equal(field.querySelectorAll('.timecode-digit').map(node => node.textContent).join(''), '000000200');
			assert.equal(handled, 1);
			assert.equal(dom.container.ownerDocument.activeElement, dom.one('[data-clip-properties-active-clip]'));
			assert.equal(dom.one('[data-video-effect-id="geometry"]').getAttribute('data-video-effect-type'), 'develop-geometry-v1');
			assert.deepEqual(commits, []);
			assert.equal(JSON.stringify(project), original, 'activation never rewrites the stored ordinal or recipe');
		} finally {
			await act(async () => { root.unmount(); });
			unregisterVideoTimingIndex(source);
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
		}
	});
}
