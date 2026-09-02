/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import type { TrackAutomationRuntime } from '../src/common/editor/track-automation-runtime.ts';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import AudioEditorMixerPanel from '../src/common/editor/ui/workspace/AudioEditorMixerPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('Mixer strip, mute, pan, and send controls write only the selected live lane', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const staticCalls: unknown[][] = [];
	const controller = mixerController(staticCalls);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		for (const scenario of mixerScenarios(dom.container)) {
			staticCalls.length = 0;
			const address = scenario.address;
			const laneId = `lane-${scenario.name}`;
			const runtime = collectedRuntime(laneId);
			const project = mixerProject(laneId, address);
			await act(async () => root.render(<AudioEditorMixerPanel
				controller={controller}
				snapshot={{
					project, productId: 'soundscaper', capabilities: {}, readOnly: false,
					effects: { rackTypes: [] },
				}}
				copy={ENGLISH_COPY}
				run={(operation: () => unknown) => operation()}
				showArmControls={false}
				displayAudioSupported
				onOpenEffects={() => undefined}
				automationRuntime={runtime.runtime}
			/>));

			await act(async () => scenario.edit(dom.container));
			assert.deepEqual(runtime.calls.map(([phase]) => phase), ['begin', 'preview', 'release'], scenario.name);
			assert.equal(runtime.calls[0]?.[1], laneId, scenario.name);
			assert.deepEqual(staticCalls, [], `${scenario.name} must not also mutate static mixer state`);
		}
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('a matching effect knob anchors, previews, and releases one live gesture without a static update', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const effect = createEffect('highpass', { id: 'filter' });
	const address = {
		kind: 'effect', strip: { kind: 'track', id: 'voice' },
		effectId: effect.id, parameterId: 'frequency',
	} as const satisfies ParameterAddress;
	const runtime = collectedRuntime('frequency-lane');
	const staticCalls: unknown[] = [];
	const project = { ...mixerProject('frequency-lane', address), tracks: [{
		...mixerProject('frequency-lane', address).tracks[0], effects: [effect],
	}] };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EffectParameterEditor
			effect={effect}
			copy={ENGLISH_COPY}
			disabled={false}
			tracks={project.tracks}
			targetTrackId="voice"
			captureNoiseProfile={undefined}
			noiseProfileLabel=""
			hideControlTrack={false}
			onRackEffectGestureBegin={undefined}
			onRackEffectPreview={undefined}
			onRackEffectCommit={undefined}
			onRackEffectCancel={undefined}
			onParametricEqGestureBegin={undefined}
			onParametricEqPreview={undefined}
			onParametricEqCommit={undefined}
			onParametricEqCancel={undefined}
			onParametricEqAudition={undefined}
			readParametricEqSpectrum={undefined}
			automationRuntime={runtime.runtime}
			automationProject={project}
			automationStrip={{ kind: 'track', id: 'voice' }}
			onChange={(changes: unknown) => { staticCalls.push(changes); }}
		/>));
		const knob = dom.one('.knob');
		await act(async () => {
			reactProps(knob).onKeyDown?.(keyEvent('ArrowUp'));
			reactProps(knob).onKeyUp?.(keyEvent('ArrowUp'));
		});

		assert.deepEqual(runtime.calls.map(([phase]) => phase), ['begin', 'preview', 'release']);
		assert.deepEqual(runtime.calls.map((call) => call.at(-1)), [80, 81, 81]);
		assert.deepEqual(staticCalls, []);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function mixerScenarios(_container: ReactTestElement): readonly Readonly<{
	name: string;
	address: ParameterAddress;
	edit(root: ReactTestElement): void;
}>[] {
	return [{
		name: 'gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		edit: (root) => reactProps(root.querySelectorAll('.mixer-fader')[0]!).onKeyDown?.(keyEvent('ArrowUp')),
	}, {
		name: 'pan',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' },
		edit: (root) => {
			const knob = root.querySelectorAll('.mixer-channel__pan-row')[0]!.querySelector('.knob')!;
			reactProps(knob).onKeyDown?.(keyEvent('ArrowRight'));
			reactProps(knob).onKeyUp?.(keyEvent('ArrowRight'));
		},
	}, {
		name: 'mute',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'mute' },
		edit: (root) => reactProps(root.querySelectorAll('.mixer-channel__toggle-btn')[0]!).onClick?.({}),
	}, {
		name: 'send',
		address: { kind: 'edge', edgeId: 'send:track:voice:mixer-node:reverb', parameterId: 'level' },
		edit: (root) => {
			const knob = root.querySelector('.kw-audio-editor__mixer-send-knob')!.querySelector('.knob')!;
			reactProps(knob).onKeyDown?.(keyEvent('ArrowUp'));
			reactProps(knob).onKeyUp?.(keyEvent('ArrowUp'));
		},
	}];
}

function mixerProject(laneId: string, address: ParameterAddress) {
	const base = createSoundscaperProject({
		id: 'matching-controls', title: 'Matching controls', now: '2026-09-01T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'sequence', trackIds: ['voice'] }], primarySequenceId: 'sequence',
	});
	return {
		...base,
		automationLanes: [{ id: laneId, address }],
		mixer: {
			...base.mixer,
			sends: [{
				id: 'reverb', name: 'Reverb', color: '#8c6fd1', gain: 1, pan: 0,
				mute: false, solo: false, collapsed: false, effectsActive: true,
				effects: [], channelCount: 2,
			}],
			edges: [...base.mixer.edges, {
				id: 'send:track:voice:mixer-node:reverb', kind: 'send',
				source: { kind: 'track', id: 'voice' },
				destination: { kind: 'mixer-node', id: 'reverb' },
				position: 'post-fader', level: 0.5, enabled: true, channelMap: [0, 1],
			}],
		},
	};
}

function mixerController(staticCalls: unknown[][]) {
	return {
		getTelemetrySnapshot: () => ({}), subscribeTelemetry: () => () => undefined,
		actions: {
			track: { update: (...args: unknown[]) => { staticCalls.push(['track', ...args]); } },
			trackFolders: { update: (...args: unknown[]) => { staticCalls.push(['folder', ...args]); } },
			mixer: {
				updateMaster: (...args: unknown[]) => { staticCalls.push(['master', ...args]); },
				updateBus: (...args: unknown[]) => { staticCalls.push(['bus', ...args]); },
				setSend: (...args: unknown[]) => { staticCalls.push(['send', ...args]); },
				setRoute: (...args: unknown[]) => { staticCalls.push(['route', ...args]); },
				addBus: () => undefined, removeBus: () => undefined,
			},
			effects: { update: () => undefined, remove: () => undefined },
		},
	};
}

function collectedRuntime(laneId: string): Readonly<{
	runtime: TrackAutomationRuntime;
	calls: unknown[][];
}> {
	const calls: unknown[][] = [];
	const token = Object.freeze({ laneId });
	return {
		calls,
		runtime: {
			snapshot: { mode: 'touch', laneId, gestureActive: false },
			setMode: () => undefined,
			beginGesture: (id, value) => { calls.push(['begin', id, value]); return token; },
			previewGesture: (owned, value) => { calls.push(['preview', owned, value]); },
			releaseGesture: (owned, value) => { calls.push(['release', owned, value]); },
			cancelGesture: (owned) => { calls.push(['cancel', owned]); },
		},
	};
}

function keyEvent(key: string): Readonly<Record<string, unknown>> {
	return { key, shiftKey: false, preventDefault() {}, stopPropagation() {} };
}
