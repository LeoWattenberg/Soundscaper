/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { LabelTrackRow } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface SelectedLabel { readonly trackId: string; readonly labelId: string; }

test('label banners use native global selection and preserve Shift selections through context menus', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let selectedLabels: SelectedLabel[] = [];
	const calls: unknown[] = [];
	const tracks = ['first', 'second'].map((id, index) => ({ id, type: 'label', name: id,
		labels: [{ id: `label-${id}`, title: id, startFrame: 9_600 + index * 9_600, endFrame: 19_200 + index * 9_600 }] }));
	const controller = {
		getSnapshot: () => ({ project: { schemaFamily: 'soundscaper', tracks }, selectedLabels }),
		actions: { labels: { add: (trackId: string) => {
			const track = tracks.find(candidate => candidate.id === trackId)!;
			const label = { id: 'added-label', title: '', startFrame: 0, endFrame: 0 };
			track.labels.push(label);
			return label.id;
		}, select: (trackId: string, labelId: string | null, options: { additive?: boolean } = {}) => {
			calls.push(['labels', trackId, labelId, options]);
			selectedLabels = labelId === null ? [] : [...(options.additive ? selectedLabels : []), { trackId, labelId }];
		} }, edit: {}, timeline: {
			selectTrack: (id: string) => { calls.push(['track', id]); },
			setExactSelection: (...frames: number[]) => { calls.push(['range', ...frames]); },
		} },
	};
	const render = () => <>{tracks.map((track, trackIndex) => <LabelTrackRow key={track.id}
		controller={controller} track={track} visualHeight={100} trackIndex={trackIndex}
		panelWidth={180} timelineWidth={600} verticalRulerWidth={40} pixelsPerSecond={100}
		sampleRate={48_000} viewportDurationFrames={48_000} timeSelection={null} rangeSelected={false}
		selected={true} blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} onMenu={() => undefined} />)}</>;
	const mouse = (shiftKey = false) => ({ button: 0, detail: 1, shiftKey, clientX: 40,
		preventDefault() {}, stopPropagation() {} });
	try {
		await act(async () => root.render(render()));
		const first = dom.one('[data-label-id="label-first"]');
		const second = dom.one('[data-label-id="label-second"]');
		const firstBanner = first.querySelector('.label-marker__label-box');
		const secondBanner = second.querySelector('.label-marker__label-box');
		assert.ok(firstBanner && secondBanner);
		await act(async () => { reactProps(firstBanner).onMouseDown(mouse()); });
		await act(async () => { reactProps(secondBanner).onMouseDown(mouse(true)); });
		await act(async () => root.render(render()));
		assert.deepEqual(calls, [
			['labels', 'first', 'label-first', { additive: false }],
			['labels', 'second', 'label-second', { additive: true }],
		], 'the native label action owns exact track/time selection without clearing the prior additive refs');
		assert.equal(first.getAttribute('data-selected-label'), 'true');
		assert.equal(second.getAttribute('data-selected-label'), 'true');
		await act(async () => { reactProps(first).onFocus({ target: first, currentTarget: first }); });
		assert.equal(selectedLabels.length, 2, 'focus restoration onto a selected marker preserves the picked set');
		assert.equal(calls.length, 2);
		await act(async () => { reactProps(first).onContextMenu({ target: first, currentTarget: first,
			clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		assert.equal(selectedLabels.length, 2, 'opening the selected label context menu retains the whole picked set');
		const lane = second.closest('[data-track-lane]');
		assert.ok(lane);
		await act(async () => { reactProps(lane).onClick({ target: lane }); });
		await act(async () => root.render(render()));
		assert.deepEqual(selectedLabels, []);
		assert.equal(first.getAttribute('data-selected-label'), 'false');
		assert.equal(second.getAttribute('data-selected-label'), 'false');
		assert.deepEqual(calls.slice(-2), [['labels', 'second', null, {}], ['track', 'second']]);
		const add = dom.container.querySelectorAll('.audio-editor-label-track-actions')[1]!.querySelector('button');
		assert.ok(add);
		await act(async () => { reactProps(add).onClick(); });
		assert.deepEqual(selectedLabels, [{ trackId: 'second', labelId: 'added-label' }], 'Add label immediately establishes its native clipboard pick');
		assert.equal(dom.one('[data-label-id="added-label"]').getAttribute('data-selected-label'), 'true');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
