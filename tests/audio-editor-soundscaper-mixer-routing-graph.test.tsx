/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import type {
	SoundscaperRoutingGraphGestureIntercept,
	SoundscaperRoutingParameterGesture,
} from '../src/common/editor/ui/workspace/soundscaper-routing-graph-gesture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the Soundscaper mixer opts into its graph and routes each gesture through one interceptable command', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	const gestures: SoundscaperRoutingGraphGestureIntercept[] = [];
	const parameterGestures: SoundscaperRoutingParameterGesture[] = [];
	const controller = {
		actions: {
			mixer: { addBus() {}, removeBus() {}, setRoute() {}, updateMaster() {} },
			edit: { commit(command: unknown) { commands.push(command); } },
		},
	};
	const baseProps = {
		controller,
		copy: ENGLISH_COPY,
		locale: 'en',
		fileService: {},
		playbackMeterSettings: {},
		run: (operation: () => unknown) => operation(),
		showArmControls: false,
		displayAudioSupported: false,
		onOpenEffects: () => undefined,
		effectsPanelTarget: null,
		onEffectWindowChange: () => undefined,
		blocked: false,
		capabilities: { audioMixerGraph: true },
		onRoutingGraphGesture: (gesture: SoundscaperRoutingGraphGestureIntercept) => {
			gestures.push(gesture);
			return gesture.commit();
		},
		onRoutingParameterGesture: (gesture: SoundscaperRoutingParameterGesture) => {
			parameterGestures.push(gesture);
			return true;
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<WorkspacePanelContent
			{...baseProps}
			panelId="mixer"
			productId="soundscaper"
			snapshot={snapshot()}
		/>));
		const toggle = dom.one('[aria-controls="soundscaper-mixer-routing-graph"]');
		assert.equal(toggle.getAttribute('aria-pressed'), 'false');
		assert.equal(dom.find('[data-soundscaper-routing-graph]'), null);

		await act(async () => reactProps(toggle).onClick?.({}));
		const closeGraph = dom.one('[aria-controls="soundscaper-mixer-routing-graph"]');
		assert.equal(closeGraph.getAttribute('aria-pressed'), 'true');
		assert.equal(closeGraph.textContent, 'Channel strips');
		assert.ok(dom.one('[data-soundscaper-routing-graph]'));

		await act(async () => reactProps(dom.one('[data-routing-source="master"]')).onKeyDown?.({ key: 'Enter', preventDefault() {} }));
		await act(async () => reactProps(dom.one('[data-routing-destination="output:main"]')).onKeyDown?.({ key: 'Enter', preventDefault() {} }));
		assert.equal(gestures.length, 1);
		assert.equal(commands.length, 1);
		assert.deepEqual(commands[0] && (commands[0] as { type: string; expected: unknown }).type, 'mixer-graph/set');
		assert.equal((commands[0] as { expected: unknown }).expected, PROJECT.mixer);
		assert.equal((gestures[0]?.addresses as readonly { kind: string }[])[0]?.kind, 'edge');
		await act(async () => reactProps(dom.one('[data-routing-edge="master-main"]')).onClick?.({}));
		const level = dom.one('[data-routing-inspector="edge"]').querySelectorAll('input')
			.find((control) => control.name === 'levelDb');
		assert.ok(level);
		await act(async () => reactProps(level).onFocus?.({ currentTarget: level }));
		level.value = '-3';
		await act(async () => reactProps(level).onChange?.({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur?.({ currentTarget: level }));
		assert.deepEqual(parameterGestures.map(({ phase }) => phase), ['begin', 'preview', 'release']);

		await act(async () => root.render(<WorkspacePanelContent
			{...baseProps}
			panelId="mixer"
			productId="framescaper"
			snapshot={snapshot()}
		/>));
		assert.equal(dom.find('[aria-controls="soundscaper-mixer-routing-graph"]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function snapshot() {
	return {
		project: PROJECT,
		readOnly: false,
		effects: { rackTypes: [] },
	};
}

const PROJECT = Object.freeze({
	schemaVersion: 21,
	masterChannels: 2,
	master: Object.freeze({ effects: Object.freeze([]) }),
	tracks: Object.freeze([]),
	trackFolders: Object.freeze([]),
	sequences: Object.freeze([]),
	mixer: Object.freeze({
		schemaVersion: 1 as const,
		groups: Object.freeze([]), sends: Object.freeze([]), cues: Object.freeze([]), vcas: Object.freeze([]),
		outputs: Object.freeze([{ id: 'main', name: 'Main output', role: 'main' as const, channelCount: 2 }]),
		edges: Object.freeze([Object.freeze({
			id: 'master-main', kind: 'assignment' as const,
			source: Object.freeze({ kind: 'master' as const }),
			destination: Object.freeze({ kind: 'output' as const, id: 'main' }),
			position: 'post-fader' as const, level: 1, enabled: true,
			channelMap: Object.freeze([0, 1]),
		})]),
	}),
});
