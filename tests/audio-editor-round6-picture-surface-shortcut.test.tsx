/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoTrackRow } from '../src/common/editor/ui/timeline/VideoTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const ownership of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'plain'] as const) {
	test(`native picture-surface traversal preserves ${ownership} ownership`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const navigation: string[] = [];
		const selections: unknown[] = [];
		const noop = () => undefined;
		const project = { tracks: ['first', 'picture', 'last'].map(id => ({ id, type: 'video', name: id, clipIds: [] })),
			selection: { trackIds: ['picture'], startFrame: 0, endFrame: 0, clipIds: [] }, clips: [], sources: [] };
		const controller = { getSnapshot: () => ({ project, selectedTrackId: 'picture' }), actions: {
			track: { update: noop }, timeline: { selectTrack: noop, selectClip: noop,
				adjustSelection: (start: number, end: number, details: Readonly<{ trackIds: readonly string[] }>, options: Readonly<{ snap: false }>) => selections.push({ start, end, ...details, snap: options.snap }),
			},
		} };
		try {
			await act(async () => root.render(<VideoTrackRow controller={controller} presentationProject={project}
				track={project.tracks[1]} visualHeight={100} trackClips={[]} clipLookup={new Map()} sourceLookup={new Map()}
				trackIndex={1} trackCount={3} isFlatNavigation={false} trackBaseTabIndex={100} panelWidth={240}
				renderViewportStartFrame={0} viewportDurationFrames={48_000} pixelsPerSecond={100} sampleRate={48_000}
				timelineWidth={600} verticalRulerWidth={0} timeSelection={null} rangeSelected={false}
				selectedTrackId="picture" selectedClipId={null} selectedClipIdSet={new Set()} draggingClipIds={null}
				clipDragPreview={null} projectBinDragPreview={null} blocked={false} copy={ENGLISH_COPY}
				run={(operation: () => unknown) => operation()} onMenu={noop} onOpenClipMenu={noop}
				onFocusTimelineRuler={() => false} onFocusTrackContainer={(index: number) => { navigation.push(`track:${index}`); return true; }}
				onFocusTrackPanelControl={(index: number) => { navigation.push(`panel:${index}`); return true; }}
				onFocusTrackClip={() => false} onFocusSelectionToolbar={() => false} />));
			const surface = dom.one('.audio-editor-video-track-surface');
			for (const [key, shiftKey] of [['ArrowDown', false], ['ArrowUp', false], ['Tab', false], ['Tab', true]] as const) {
				let prevented = false;
				await act(async () => { reactProps(surface).onKeyDown?.({ key, shiftKey,
					...(ownership === 'plain' ? {} : { [ownership]: true }), currentTarget: surface, target: surface,
					preventDefault: () => { prevented = true; },
				}); });
				assert.equal(prevented, ownership === 'plain', key);
			}
			assert.deepEqual(navigation, ownership === 'plain' ? ['track:2', 'track:0', 'panel:1', 'panel:0'] : []);
			if (ownership === 'plain') {
				await act(async () => { reactProps(surface).onKeyDown?.({ key: 'ArrowDown', shiftKey: true, preventDefault() {} }); });
				assert.deepEqual(selections, [{ start: 0, end: 0, trackIds: ['picture', 'last'], snap: false }]);
			} else assert.deepEqual(selections, []);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
			dom.restore();
		}
	});
}
