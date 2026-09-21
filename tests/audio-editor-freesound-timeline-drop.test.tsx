/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE } from '../src/common/editor/project-bin-dnd.js';
import { useTimelineProjectBinDnd } from '../src/common/editor/ui/timeline/useTimelineProjectBinDnd.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a Freesound result dropped on the timeline imports at the exact audio target', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const eventGlobal = globalThis as typeof globalThis & {
		addEventListener?: typeof window.addEventListener;
		removeEventListener?: typeof window.removeEventListener;
	};
	const priorAddEventListener = eventGlobal.addEventListener;
	const priorRemoveEventListener = eventGlobal.removeEventListener;
	eventGlobal.addEventListener = globalThis.window.addEventListener.bind(globalThis.window);
	eventGlobal.removeEventListener = globalThis.window.removeEventListener.bind(globalThis.window);
	const imports: unknown[] = [];
	let handlers: ReturnType<typeof useTimelineProjectBinDnd> | null = null;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	function Harness() {
		handlers = useTimelineProjectBinDnd({
			controller: { actions: { freesound: { importSound: (request: unknown) => { imports.push(request); } } } },
			mutationsBlocked: false,
			state: { setDraggingClipIds() {}, setProjectBinDragPreview() {} },
			model: {
				project: {
					id: 'project-a', tracks: [{ id: 'track-a', type: 'audio', clipIds: [] }],
					projectBin: { clips: [] },
				},
			},
			hitTesting: {
				clearProjectBinDragState() {},
				timelineDropTargetAt: () => ({
					trackId: 'track-a', timelineStartFrame: 24_000, createTrack: false,
				}),
			},
			menuActions: { run: (operation: () => unknown) => operation() },
		});
		return null;
	}
	try {
		await act(async () => root.render(<Harness />));
		assert.ok(handlers);
		let prevented = false;
		await act(async () => handlers!.onTimelineDrop({
			dataTransfer: {
				types: [AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE], files: [],
				getData: () => '{"schemaVersion":1,"soundId":42}',
			},
			preventDefault: () => { prevented = true; },
		}));
		assert.equal(prevented, true);
		assert.deepEqual(imports, [{
			soundId: 42, destination: 'timeline', trackId: 'track-a', timelineStartFrame: 24_000,
		}]);
	} finally {
		await act(async () => root.unmount());
		if (priorAddEventListener) eventGlobal.addEventListener = priorAddEventListener;
		else Reflect.deleteProperty(eventGlobal, 'addEventListener');
		if (priorRemoveEventListener) eventGlobal.removeEventListener = priorRemoveEventListener;
		else Reflect.deleteProperty(eventGlobal, 'removeEventListener');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
