/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Selection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
}

for (const child of ['Effects', 'Track menu', 'Volume', 'Pan'] as const) {
	test(`track-header ${child} interaction retains selected clips and time without replacing header selection`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const original: Selection = { startFrame: 101, endFrame: 901, trackIds: ['first', 'last'], clipIds: ['clip'] };
		let selection: Selection = original;
		const focused: unknown[] = [], effects: string[] = [], menus: unknown[] = [], previews: number[] = [], commits: number[] = [];
		let selectionWrites = 0;
		const controller = {
			getSnapshot: () => ({ project: { id: 'project', tracks: ['first', 'middle', 'last'].map(id => ({ id })), clips: [], selection } }),
			getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => undefined,
			actions: {
				track: { update() {} },
				timeline: {
					selectTrack: (id: string | null) => focused.push(id),
					setExactSelection(startFrame: number, endFrame: number, details: { trackIds: readonly string[]; clipIds?: readonly string[] }) {
						selectionWrites += 1;
						selection = { startFrame, endFrame, trackIds: details.trackIds, clipIds: details.clipIds ?? [] };
					},
				},
				mixer: {
					beginParameterGesture: () => child === 'Volume' ? 1 : 0,
					previewParameterGesture: (_address: unknown, value: number) => previews.push(value),
					commitParameterGesture: (_address: unknown, value: number) => commits.push(value),
					cancelParameterGesture() {},
				},
			},
		};
		try {
			await act(async () => root.render(<TrackControls controller={controller} track={{ id: 'last', name: 'Last', gain: 1, pan: 0 }}
				trackHeight={180} panelWidth={240} selected={false} blocked={false} showArmControls={false} displayAudioSupported={false}
				recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
				isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onMenu={(target: unknown) => menus.push(target)} onOpenEffects={(id: string) => effects.push(id)} onAutomationTarget={() => undefined}
				onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
			const panel = dom.one('.track-control-panel');
			const control = child === 'Effects' ? dom.container.querySelectorAll('button').find(button => button.textContent === 'Effects')
				: dom.one(child === 'Volume' ? '.slider__input' : child === 'Pan' ? '.knob' : '[aria-label="Track menu"]');
			assert.ok(control, `Missing production ${child} control`);
			control.focus();
			await act(async () => { reactProps(dom.one('.audio-editor-track-controls')).onFocusCapture({ target: control }); });
			assert.deepEqual(focused, ['last'], 'the owning focus capture still focuses the track');
			if (child === 'Volume') {
				await act(async () => { reactProps(control).onPointerDown({}); });
				await act(async () => { reactProps(control).onChange({ target: { value: '60' } }); });
				await act(async () => { reactProps(control).onPointerUp({}); });
			} else if (child === 'Pan') {
				await act(async () => { reactProps(control).onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }); });
				await act(async () => { reactProps(control).onKeyUp({ key: 'ArrowRight' }); });
			}
			// Model native bubbling after the child callback/gesture: the target
			// remains the actual mounted control while currentTarget becomes the panel.
			await act(async () => {
				let stopped = false;
				const event = { target: control, currentTarget: control, preventDefault() {}, stopPropagation() { stopped = true; } };
				if (child === 'Effects' || child === 'Track menu') reactProps(control).onClick(event);
				if (!stopped) reactProps(panel).onClick({ ...event, currentTarget: panel });
			});
			assert.deepEqual(selection, original);
			assert.equal(selectionWrites, 0);
			assert.deepEqual(focused, ['last']);
			assert.deepEqual(effects, child === 'Effects' ? ['last'] : []);
			assert.equal(menus.length, child === 'Track menu' ? 1 : 0);
			if (child === 'Track menu') assert.equal(menus[0] === control, true);
			assert.equal(previews.length, child === 'Volume' || child === 'Pan' ? 1 : 0);
			assert.equal(commits.length, child === 'Volume' || child === 'Pan' ? 1 : 0);
			for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
				await act(async () => {
					let stopped = false;
					const event = { ...modifiers, target: control, currentTarget: control, preventDefault() {}, stopPropagation() { stopped = true; } };
					if (child === 'Effects' || child === 'Track menu') reactProps(control).onClick(event);
					if (!stopped) reactProps(panel).onClick({ ...event, currentTarget: panel });
				});
				assert.deepEqual(selection, original);
				assert.equal(selectionWrites, 0);
			}
		} finally {
			await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
		}
	});
}
