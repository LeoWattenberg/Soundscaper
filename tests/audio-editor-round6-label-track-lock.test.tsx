/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker, LabelTrackRow } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

void test('label row reflects the current host lock without blocking selection', async () => {
	const dom = fixture();
	const root = createRoot(dom.container as unknown as Element);
	let locked = true;
	const selected: string[] = [];
	const controller = {
		getSnapshot: () => ({ project: { schemaFamily: 'soundscaper', tracks: [{ id: 'labels', locked }] } }),
		actions: { timeline: { selectTrack: (id: string) => selected.push(id), setExactSelection() {} } },
	};
	const render = () => root.render(<LabelTrackRow controller={controller}
		track={{ id: 'labels', type: 'label', name: 'Labels', locked, labels: [label] }} visualHeight={100}
		trackIndex={0} panelWidth={180} timelineWidth={600} verticalRulerWidth={40} pixelsPerSecond={100}
		sampleRate={48_000} viewportDurationFrames={48_000} timeSelection={null} rangeSelected={false} selected={true} blocked={false}
		copy={ENGLISH_COPY} run={run} onMenu={() => undefined} />);
	try {
		await act(async () => render());
		const add = dom.one('.audio-editor-label-track-actions').querySelector('button');
		assert.ok(add);
		assert.equal(reactProps(add).disabled, true);
		const marker = dom.one('[data-label-id]');
		await act(async () => { reactProps(marker).onKeyDown?.({ key: 'F2', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(dom.container.querySelectorAll('input').length, 0);
		await act(async () => { reactProps(marker).onFocus?.({ target: marker, currentTarget: marker }); });
		assert.deepEqual(selected, ['labels']);
		locked = false;
		await act(async () => render());
		assert.equal(reactProps(add).disabled, false);
		await act(async () => { reactProps(marker).onKeyDown?.({ key: 'F2', preventDefault() {}, stopPropagation() {} }); });
		assert.ok(dom.one('input'));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

for (const protection of ['lock', 'readOnly'] as const) void test(`an already-open label draft respects a later ${protection}`, async () => {
	const dom = fixture();
	const root = createRoot(dom.container as unknown as Element);
	let locked = false;
	let readOnly = false;
	const commits: unknown[] = [];
	const controller = {
		getSnapshot: () => ({ readOnly, project: { schemaFamily: 'soundscaper', tracks: [{ id: 'labels', locked }] } }),
		actions: { labels: { update: (...args: unknown[]) => commits.push(args) }, edit: {}, timeline: {} },
	};
	try {
		await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels" label={label}
			left={0} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }}
			selected={true} editing={true} blocked={false} copy={ENGLISH_COPY} run={run}
			onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
		const input = dom.one('input');
		input.value = 'Protected draft';
		if (protection === 'lock') locked = true; else readOnly = true;
		await act(async () => { reactProps(input).onBlur?.({ currentTarget: input }); });
		assert.equal(commits.length, 0);
		locked = false; readOnly = false;
		await act(async () => { reactProps(input).onBlur?.({ currentTarget: input }); });
		assert.deepEqual(commits, [['labels', 'label', { title: 'Protected draft' }]]);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

const label = { id: 'label', title: 'Intro', startFrame: 0, endFrame: 0 };
function run(operation: () => unknown) { return operation(); }

function fixture() {
	const dom = installReactTestDom();
	const oldReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	const oldSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true, writable: true });
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	return { ...dom, restore() {
		for (const [object, key, descriptor] of [[globalThis, 'React', oldReact],
			[globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct], [ReactTestElement.prototype, 'select', oldSelect]] as const) {
			if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
		}
		dom.restore();
	} };
}
