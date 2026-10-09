/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphInspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import type { SoundscaperRoutingParameterGesture } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-gesture.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

const savedLevel = 10 ** (-12 / 20);
const graph: MixerGraphV21 = {
	schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
	outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
	edges: [
		{ id: 'voice-master', kind: 'assignment', source: { kind: 'track', id: 'voice' },
			destination: { kind: 'master' }, position: 'post-fader', level: savedLevel,
			enabled: true, channelMap: [0, 1] },
		{ id: 'master-main', kind: 'assignment', source: { kind: 'master' },
			destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1,
			enabled: true, channelMap: [0, 1] },
	],
};
const project = { schemaVersion: 21, masterChannels: 2, master: { effects: [] },
	tracks: [{ id: 'voice', type: 'audio', name: 'Voice', effects: [] }],
	trackFolders: [], sequences: [], mixer: graph };

async function withInspector(capture: boolean | Promise<boolean>, run: (fixture: Readonly<{
	level: ReactTestElement;
	submit: () => Promise<void>;
	gestures: SoundscaperRoutingParameterGesture[];
	levels: number[];
}>) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const priorFormData = Object.getOwnPropertyDescriptor(globalThis, 'FormData');
	const NativeFormData = globalThis.FormData;
	const root = createRoot(dom.container as unknown as Element);
	const gestures: SoundscaperRoutingParameterGesture[] = [];
	const levels: number[] = [];
	const errors: unknown[] = [];
	// Node's FormData does not accept a form. Preserve native successful-control
	// serialization while supplying the mounted test DOM's input/select values.
	Object.defineProperty(globalThis, 'FormData', { configurable: true,
		value: class extends NativeFormData {
			constructor(form: ReactTestElement) {
				super();
				for (const control of form.querySelectorAll('input, select')) {
					if (!control.name || control.disabled || (control.type === 'checkbox' && !control.checked)) continue;
					const value = control.tagName === 'SELECT'
						? control.options.find(option => option.selected)?.value ?? control.value : control.value;
					this.append(control.name, value);
				}
			}
		},
	});
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphInspector
			project={project} graph={graph} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			selection={{ kind: 'edge', id: 'voice-master' }} disabled={false} confirmingDelete={false}
			onConfirmingDelete={() => undefined} onError={reason => { errors.push(reason); }}
			onCandidate={(_kind, candidate) => { levels.push(candidate.graph.edges.find(edge => edge.id === 'voice-master')!.level); }}
			onParameterGesture={gesture => { gestures.push(gesture); return capture; }}
		/>));
		const level = dom.container.querySelectorAll('input').find(control => control.name === 'levelDb');
		assert.ok(level);
		const form = dom.one('form');
		await run({ level, levels, gestures,
			submit: async () => { await act(async () => reactProps(form).onSubmit({ preventDefault() {}, currentTarget: form })); },
		});
		assert.deepEqual(errors, [], 'valid native routing fields must reach the real commit owner');
	} finally {
		await act(async () => root.unmount());
		if (priorFormData) Object.defineProperty(globalThis, 'FormData', priorFormData);
		else Reflect.deleteProperty(globalThis, 'FormData');
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('routing form refuses an omitted level rather than replacing its quiet feed with unity', async () => {
	await withInspector(false, async ({ level, submit, levels }) => {
		level.value = '';
		await submit();
		assert.deepEqual(levels, []);
	});
});

test('an omitted routing level cancels captured automation without previewing or releasing unity', async () => {
	await withInspector(true, async ({ level, gestures }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		assert.deepEqual(gestures.map(gesture => gesture.phase), ['begin', 'cancel']);
		assert.equal(gestures[1]?.value, savedLevel);
		assert.equal(level.value, '-12');
	});
});

test('completed zero and negative routing levels retain their native explicit commits', async () => {
	await withInspector(false, async ({ level, submit, levels }) => {
		level.value = '0';
		await submit();
		level.value = '-6';
		await submit();
		assert.deepEqual(levels, [1, 10 ** (-6 / 20)]);
	});
});

test('a completed captured level previews and releases the authored value', async () => {
	await withInspector(true, async ({ level, gestures }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '-6';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		assert.deepEqual(gestures.map(gesture => gesture.phase), ['begin', 'preview', 'release']);
		assert.equal(gestures[2]?.value, 10 ** (-6 / 20));
	});
});

test('empty routing text can be replaced by a completed quiet level before committing', async () => {
	await withInspector(false, async ({ level, submit, levels }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		level.value = '-18';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		await submit();
		assert.deepEqual(levels, [10 ** (-18 / 20)]);
	});
});

test('omitting a routing level cancels an automation capture that completes after blur', async () => {
	let resolveCapture: (value: boolean) => void = () => undefined;
	const capture = new Promise<boolean>(resolve => { resolveCapture = resolve; });
	await withInspector(capture, async ({ level, gestures }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		await act(async () => { resolveCapture(true); await Promise.resolve(); });
		assert.deepEqual(gestures.map(gesture => gesture.phase), ['begin', 'cancel']);
		assert.equal(gestures[1]?.value, savedLevel);
	});
});
