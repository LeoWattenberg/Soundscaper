/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const endFrame of [9_600, 19_200]) {
	test(`selecting an authored label ${String(9_600)}..${String(endFrame)} bypasses pointer grid quantization`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React;
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const calls: unknown[] = [];
		const controller = {
			getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }),
			actions: { labels: {}, edit: {}, timeline: {
				selectTrack: (track: string) => calls.push(['track', track]),
				setSelection: (start: number, end: number) => calls.push(['grid', Math.round(start / 48_000) * 48_000, Math.round(end / 48_000) * 48_000]),
				setExactSelection: (start: number, end: number) => calls.push(['exact', start, end]),
			} },
		};
		try {
			await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels"
				label={{ id: 'region', title: 'Region', startFrame: 9_600, endFrame }} left={32} trackHeight={100}
				pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }} selected={false} editing={false}
				blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
			const marker = dom.one('[data-label-id]');
			await act(async () => { reactProps(marker).onFocus({ target: marker, currentTarget: marker }); });
			assert.deepEqual(calls, [['track', 'labels'], ['exact', 9_600, endFrame]]);
			calls.length = 0;
			await act(async () => { reactProps(dom.one('.label-marker')).onClick({}); });
			assert.deepEqual(calls, [['track', 'labels'], ['exact', 9_600, endFrame]]);
		} finally {
			await act(async () => root.unmount());
			globals.React = priorReact;
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
