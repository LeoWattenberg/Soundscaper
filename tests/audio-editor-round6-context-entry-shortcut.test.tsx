/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { isFadeShapeMenuKey } from '../src/common/editor/ui/timeline/FadeShapeMenu.tsx';
import { useTimelineMenuActions } from '../src/common/editor/ui/timeline/useTimelineMenuActions.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const) {
	test(`native fade context entry releases ${modifier} command ownership`, () => {
		for (const key of ['F10', 'ContextMenu']) {
			assert.equal(isFadeShapeMenuKey({ key, shiftKey: true, [modifier]: true }), false);
		}
		assert.equal(isFadeShapeMenuKey({ key: 'F10', shiftKey: true }), true);
		assert.equal(isFadeShapeMenuKey({ key: 'ContextMenu', shiftKey: false }), true);
		assert.equal(isFadeShapeMenuKey({ key: 'F10', shiftKey: false }), false);
	});
}

for (const owner of ['ruler', 'label'] as const) test(`native ${owner} context entry preserves project commands and its plain entry`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React;
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const opened: unknown[] = [];
	const controller = { getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
		labels: {}, edit: {}, timeline: { selectTrack: () => undefined, setExactSelection: () => undefined },
	} };
	function Ruler() {
		const actions = useTimelineMenuActions({ controller, copy: ENGLISH_COPY, onError: () => undefined,
			state: { addTrackFlyout: null, setTimelineRulerMenu: (menu: unknown) => opened.push(menu),
				setTrackRulerFlyout: () => undefined },
			model: { project: { clips: [] }, showMasterTrack: false, showMarkers: false },
		});
		return <button data-ruler onKeyDown={actions.openTimelineRulerMenu} onContextMenu={actions.openTimelineRulerMenu}>Ruler</button>;
	}
	try {
		await act(async () => root.render(owner === 'ruler' ? <Ruler />
			: <AudacityLabelMarker controller={controller} trackId="labels"
				label={{ id: 'region', title: 'Region', startFrame: 0, endFrame: 48_000 }} left={12} trackHeight={100}
				pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }} selected editing={false}
				blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
		const trigger = dom.one(owner === 'ruler' ? '[data-ruler]' : '[data-label-id]');
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const) {
			for (const key of ['F10', 'ContextMenu']) {
				let prevented = false;
				let stopped = false;
				await act(async () => { reactProps(trigger).onKeyDown?.({ key, type: 'keydown', shiftKey: true,
					[modifier]: true, currentTarget: trigger, target: trigger,
					preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
				}); });
				assert.equal(prevented, false, `${modifier} ${key} prevention`);
				assert.equal(stopped, false, `${modifier} ${key} propagation`);
				assert.equal(opened.length, 0);
				assert.equal(dom.container.ownerDocument.body.querySelector('.audio-editor-label-context-menu'), null);
			}
		}
		await act(async () => { reactProps(trigger).onKeyDown?.({ key: 'F10', type: 'keydown', shiftKey: true,
			currentTarget: trigger, target: trigger, preventDefault() {}, stopPropagation() {},
		}); });
		if (owner === 'ruler') {
			assert.equal(opened.length, 1);
			assert.deepEqual(opened[0], { x: 12, y: -4, autoFocus: true });
			await act(async () => { reactProps(trigger).onContextMenu?.({ type: 'contextmenu', ctrlKey: true,
				currentTarget: trigger, clientX: 23, clientY: 41, preventDefault() {}, stopPropagation() {},
			}); });
			assert.deepEqual(opened[1], { x: 23, y: 41, autoFocus: false });
		} else assert.ok(dom.container.ownerDocument.body.querySelector('.audio-editor-label-context-menu'));
	} finally {
		await act(async () => root.unmount());
		globals.React = previousReact;
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
