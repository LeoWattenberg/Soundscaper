/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const variableRate of [false, true]) {
	test(`video Source in displays authenticated ${variableRate ? 'variable' : 'constant'} source time and commits a native ordinal`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const recording = videoTimingProbeMedia.find(({ kind }) => kind === (variableRate ? 'vfr' : 'cfr'));
		assert.ok(recording);
		const publication = createVideoTimingAssetPublication(recording.sourceSha256, {
			timescale: recording.timescale, presentationTicks: recording.presentationTicks,
			finalFrameDurationTicks: recording.finalFrameDurationTicks,
		});
		const source = { id: 'source', kind: 'video', name: recording.file.name,
			frameRate: recording.nominalRate, sourceFrameCount: recording.presentationTicks.length,
			contentSha256: recording.sourceSha256, ...(variableRate ? { timingAsset: publication.reference } : {}),
			timingDecision: { mode: variableRate ? 'exact' : 'conform-cfr-at-ingest', rate: recording.nominalRate, backend: 'demuxer' },
		};
		if (variableRate) registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
		const clip = { id: 'clip', kind: 'video', sourceId: source.id, title: 'Clip',
			timelineStartFrame: 19_200, durationFrames: 19_200, sourceStartFrame: variableRate ? 2 : 10,
			sourceDurationFrames: 4, videoEffects: [] };
		const project = { id: 'project', sampleRate: 48_000, sources: [source], clips: [clip],
			tracks: [{ id: 'track', kind: 'video', clipIds: ['clip'] }] };
		const trims: unknown[] = [];
		const controller = { project, actions: { clip: { trim: (...args: unknown[]) => { trims.push(args); } } } };
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => { root.render(<ClipPropertiesBody controller={controller}
				snapshot={{ project, selectedClipId: 'clip', capabilities: { audioEffects: false } }} copy={ENGLISH_COPY} />); });
			const field = dom.one('[data-clip-field="sourceInFrame"]');
			const digits = () => field.querySelectorAll('.timecode-digit').map((node) => node.textContent).join('');
			assert.equal(digits(), variableRate ? '000000200' : '000000400');
			const wrapper = field.querySelector('[data-timecode-input]');
			assert.ok(wrapper);
			await act(async () => { reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }); });
			assert.deepEqual(trims, [], 'untouched blur preserves the exact stored source ordinal');
			const input = field.querySelector('input');
			assert.ok(input);
			await act(async () => { reactProps(input).onChange({ currentTarget: { valueAsNumber: variableRate ? 0.245 : 0.24 } }); });
			await act(async () => { reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }); });
			assert.deepEqual(trims, [['clip', { sourceStartFrame: variableRate ? 3 : 6 }]]);
		} finally {
			await act(async () => { root.unmount(); });
			if (variableRate) unregisterVideoTimingIndex(source);
			dom.restore();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
		}
	});
}
