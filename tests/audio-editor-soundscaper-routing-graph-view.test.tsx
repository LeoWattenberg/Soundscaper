/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphView, {
	type SoundscaperRoutingGraphCommit,
	type SoundscaperRoutingParameterGesture,
} from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('routing graph view exposes spatial and non-spatial editing without a parameter dump', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commits: SoundscaperRoutingGraphCommit[] = [];
	const parameterGestures: SoundscaperRoutingParameterGesture[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView
			project={PROJECT}
			graph={PROJECT.mixer}
			disabled={false}
			copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			onCommit={(commit) => commits.push(commit)}
			onParameterGesture={(gesture) => { parameterGestures.push(gesture); return true; }}
		/>));

		assert.equal(dom.one('[data-soundscaper-routing-graph]').getAttribute('aria-label'), 'Routing graph');
		assert.match(dom.one('[data-routing-node="track:voice"]').textContent, /Voice/u);
		assert.match(dom.one('[data-routing-node="master"]').textContent, /Master/u);
		assert.equal(dom.one('[data-routing-edge="voice-reverb"]').textContent, 'S');
		assert.equal(dom.one('[data-routing-vca-relation="all:track:voice"]').textContent, 'VCA');
		assert.match(dom.one('[data-routing-vca-relation="all:track:voice"]').getAttribute('aria-label') ?? '', /All.*Voice/u);
		assert.equal(dom.find('textarea'), null, 'the graph must not reveal a canonical parameter document');

		await act(async () => {
			reactProps(dom.one('[data-routing-source="track:voice"]')).onKeyDown?.({
				key: 'Enter', preventDefault() {},
			});
		});
		assert.match(dom.one('[role="status"]').textContent, /Choose a destination/u);
		await act(async () => {
			reactProps(dom.one('[data-routing-destination="master"]')).onKeyDown?.({
				key: 'Enter', preventDefault() {},
			});
		});
		assert.equal(commits.length, 1);
		assert.equal(commits[0]?.kind, 'edge-create');
		assert.equal(commits[0]?.addresses[0]?.kind, 'edge');

		await act(async () => reactProps(dom.one('[data-routing-edge="voice-master"]')).onClick?.({}));
		assert.equal(dom.one('[data-routing-inspector="edge"]').getAttribute('aria-label'), 'Connection inspector');
		assert.match(dom.one('[data-routing-inspector="edge"]').textContent, /Channel map/u);
		const level = dom.one('[data-routing-inspector="edge"]').querySelectorAll('input')
			.find((control) => control.name === 'levelDb');
		assert.ok(level);
		await act(async () => reactProps(level).onFocus?.({ currentTarget: level }));
		level.value = '-6';
		await act(async () => reactProps(level).onChange?.({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur?.({ currentTarget: level }));
		assert.deepEqual(parameterGestures.map(({ phase }) => phase), ['begin', 'preview', 'release']);
		assert.deepEqual(parameterGestures[0]?.address, {
			kind: 'edge', edgeId: 'voice-master', parameterId: 'level',
		});
		assert.ok(Math.abs((parameterGestures[1]?.value ?? 0) - 0.501187) < 0.000001);
		const declinedGestures: SoundscaperRoutingParameterGesture[] = [];
		await act(async () => root.render(<SoundscaperRoutingGraphView
			project={PROJECT}
			graph={PROJECT.mixer}
			disabled={false}
			copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			onCommit={(commit) => commits.push(commit)}
			onParameterGesture={async (gesture) => {
				declinedGestures.push(gesture);
				return false;
			}}
		/>));
		const declinedLevel = dom.one('[data-routing-inspector="edge"]').querySelectorAll('input')
			.find((control) => control.name === 'levelDb');
		assert.ok(declinedLevel);
		await act(async () => reactProps(declinedLevel).onFocus?.({ currentTarget: declinedLevel }));
		declinedLevel.value = '-3';
		await act(async () => reactProps(declinedLevel).onChange?.({ currentTarget: declinedLevel }));
		await act(async () => reactProps(declinedLevel).onBlur?.({ currentTarget: declinedLevel }));
		await act(async () => Promise.resolve());
		assert.deepEqual(declinedGestures.map(({ phase }) => phase), ['begin']);

		await act(async () => root.render(<SoundscaperRoutingGraphView
			project={PROJECT}
			graph={PROJECT.mixer}
			disabled
			copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			onCommit={(commit) => commits.push(commit)}
			onParameterGesture={(gesture) => { parameterGestures.push(gesture); return true; }}
		/>));
		const readonlyInspector = dom.one('[data-routing-inspector="edge"]');
		for (const control of readonlyInspector.querySelectorAll('input,select')) {
			assert.ok(control.disabled || control.hasAttribute('disabled')
				|| (control as unknown as { readOnly?: boolean }).readOnly
				|| control.hasAttribute('readonly'), `${control.tagName}:${control.name} must be inspect-only`);
		}
		assert.equal(dom.one('[data-routing-node="master"]').querySelector('button')?.disabled, false);

		await act(async () => reactProps(dom.one('[aria-label="Zoom in"]')).onClick?.({}));
		assert.match(dom.one('[data-routing-zoom]').textContent, /110%/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('folder-owned groups and canonical assignments remain selectable without graph mutations', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commits: SoundscaperRoutingGraphCommit[] = [];
	const gestures: SoundscaperRoutingParameterGesture[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView
			project={FOLDER_PROJECT}
			graph={FOLDER_PROJECT.mixer}
			disabled={false}
			copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			onCommit={(commit) => commits.push(commit)}
			onParameterGesture={(gesture) => { gestures.push(gesture); return true; }}
		/>));

		const folderNode = dom.one('[data-routing-node="mixer-node:dialogue"]').querySelector('button')!;
		await act(async () => reactProps(folderNode).onClick?.({}));
		const nodeInspector = dom.one('[data-routing-inspector="node"]');
		const nodeForm = nodeInspector.querySelectorAll('form')[0]!;
		for (const control of nodeForm.querySelectorAll('input,button')) {
			assert.ok(control.disabled || control.hasAttribute('disabled'), `${control.tagName}:${control.name} must be disabled`);
		}
		const connectDestination = nodeInspector.querySelector('.kw-routing-graph__connection-form')?.querySelector('select');
		assert.ok(connectDestination && !connectDestination.hasAttribute('disabled'),
			'folder groups may still author additional routes');
		await act(async () => reactProps(nodeForm).onSubmit?.({ preventDefault() {}, currentTarget: nodeForm }));
		assert.equal(commits.length, 0);

		const edgeHandle = dom.one('[data-routing-edge="assignment:track:voice:mixer-node:dialogue"]');
		await act(async () => reactProps(edgeHandle).onClick?.({}));
		const edgeInspector = dom.one('[data-routing-inspector="edge"]');
		const edgeForm = edgeInspector.querySelector('form')!;
		for (const control of edgeForm.querySelectorAll('input,select,button')) {
			assert.ok(control.disabled || control.hasAttribute('disabled'), `${control.tagName}:${control.name} must be disabled`);
		}
		await act(async () => reactProps(edgeForm).onSubmit?.({ preventDefault() {}, currentTarget: edgeForm }));
		await act(async () => reactProps(edgeHandle).onKeyDown?.({ key: 'Delete', preventDefault() {} }));
		assert.equal(Array.from(edgeInspector.querySelectorAll('button')).some(({ textContent }) => (
			textContent?.includes(SOUNDSCAPER_ROUTING_GRAPH_COPY.confirmDelete)
		)), false);
		assert.equal(commits.length, 0);
		assert.equal(gestures.length, 0);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('an authoritative node focus request is consumed once and does not reclaim later edge selection', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const requestedSelection = { kind: 'node' as const, collection: 'sends' as const, id: 'reverb' };
	let consumed = 0;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (graph: MixerGraphV21 = PROJECT.mixer) => <SoundscaperRoutingGraphView
		project={{ ...PROJECT, mixer: graph }} graph={graph} disabled={false}
		copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} requestedSelection={requestedSelection}
		onRequestedSelectionConsumed={() => { consumed += 1; }} onCommit={() => undefined}
	/>;
	try {
		await act(async () => root.render(render()));
		assert.equal(dom.one('[data-routing-node="mixer-node:reverb"]').querySelector('button')?.getAttribute('aria-pressed'), 'true');
		assert.equal(consumed, 1);
		const selectedEdge = dom.one('[data-routing-edge="voice-master"]');
		await act(async () => reactProps(selectedEdge).onClick?.({}));
		assert.equal(selectedEdge.getAttribute('aria-pressed'), 'true');

		const updatedGraph = {
			...PROJECT.mixer,
			edges: PROJECT.mixer.edges.map((edge) => edge.id === 'master-main' ? { ...edge, level: 0.75 } : edge),
		};
		await act(async () => root.render(render(updatedGraph)));
		assert.equal(dom.one('[data-routing-edge="voice-master"]').getAttribute('aria-pressed'), 'true');
		assert.equal(dom.one('[data-routing-node="mixer-node:reverb"]').querySelector('button')?.getAttribute('aria-pressed'), 'false');
		assert.equal(consumed, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('supported effect sidechain ports are filtered and remain spatially distinct', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView
			project={SIDECHAIN_PROJECT}
			graph={SIDECHAIN_PROJECT.mixer}
			disabled={false}
			copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			onCommit={() => undefined}
		/>));

		const ports = dom.container.querySelectorAll('.kw-routing-graph__port--sidechain');
		assert.equal(ports.length, 3);
		assert.deepEqual(
			ports.map((port) => port.getAttribute('aria-label')),
			[
				'Connect into Sidechain: Track Voice / Limiter',
				'Connect into Sidechain: Track Voice / Gate',
				'Connect into Sidechain: Track Voice / Auto Duck',
			],
		);
		const positions = ports.map((port) => {
			const style = reactProps(port).style as unknown as Readonly<{ left: string; top: string }>;
			return `${style.left}:${style.top}`;
		});
		assert.equal(new Set(positions).size, 3);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

const PROJECT = Object.freeze({
	schemaVersion: 21,
	masterChannels: 2,
	master: Object.freeze({ effects: Object.freeze([]) }),
	tracks: Object.freeze([Object.freeze({
		id: 'voice', type: 'audio', name: 'Voice', effects: Object.freeze([]),
	})]),
	trackFolders: Object.freeze([]),
	sequences: Object.freeze([]),
	mixer: Object.freeze({
		schemaVersion: 1 as const,
		groups: Object.freeze([]),
		sends: Object.freeze([Object.freeze({
			id: 'reverb', name: 'Reverb', color: '', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: Object.freeze([]), channelCount: 2,
		})]),
		cues: Object.freeze([]),
		vcas: Object.freeze([Object.freeze({
			id: 'all', name: 'All', gain: 1, mute: false,
			members: Object.freeze([Object.freeze({ kind: 'track' as const, id: 'voice' })]),
		})]),
		outputs: Object.freeze([{ id: 'main', name: 'Main output', role: 'main' as const, channelCount: 2 }]),
		edges: Object.freeze([
			Object.freeze({
				id: 'voice-master', kind: 'assignment' as const,
				source: Object.freeze({ kind: 'track' as const, id: 'voice' }),
				destination: Object.freeze({ kind: 'master' as const }),
				position: 'post-fader' as const, level: 1, enabled: true,
				channelMap: Object.freeze([0, 1]),
			}),
			Object.freeze({
				id: 'master-main', kind: 'assignment' as const,
				source: Object.freeze({ kind: 'master' as const }),
				destination: Object.freeze({ kind: 'output' as const, id: 'main' }),
				position: 'post-fader' as const, level: 1, enabled: true,
				channelMap: Object.freeze([0, 1]),
			}),
			Object.freeze({
				id: 'voice-reverb', kind: 'send' as const,
				source: Object.freeze({ kind: 'track' as const, id: 'voice' }),
				destination: Object.freeze({ kind: 'mixer-node' as const, id: 'reverb' }),
				position: 'post-fader' as const, level: 0.5, enabled: true,
				channelMap: Object.freeze([0, 1]),
			}),
		]),
	}),
});

const SIDECHAIN_PROJECT = Object.freeze({
	...PROJECT,
	tracks: Object.freeze([Object.freeze({
		...PROJECT.tracks[0],
		effects: Object.freeze([
			Object.freeze({ id: 'limiter', name: 'Limiter', type: 'limiter' }),
			Object.freeze({ id: 'gate', name: 'Gate', type: 'gate' }),
			Object.freeze({ id: 'duck', name: 'Auto Duck', type: 'audacity-auto-duck' }),
			Object.freeze({ id: 'filter', name: 'Filter', type: 'highpass' }),
			Object.freeze({
				id: 'native', name: 'Native', type: 'native-plugin',
				params: Object.freeze({ instanceId: 'native-1' }),
			}),
		]),
	})]),
});

const FOLDER_PROJECT = Object.freeze({
	...PROJECT,
	trackFolders: Object.freeze([Object.freeze({ id: 'dialogue', name: 'Dialogue' })]),
	sequences: Object.freeze([Object.freeze({
		trackNodes: Object.freeze([
			Object.freeze({ kind: 'folder', id: 'dialogue', parentFolderId: null }),
			Object.freeze({ kind: 'track', id: 'voice', parentFolderId: 'dialogue' }),
		]),
	})]),
	mixer: Object.freeze({
		...PROJECT.mixer,
		groups: Object.freeze([Object.freeze({
			id: 'dialogue', name: 'Dialogue', color: '', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: Object.freeze([]), channelCount: 2,
		})]),
		edges: Object.freeze([
			Object.freeze({
				id: 'assignment:track:voice:mixer-node:dialogue', kind: 'assignment' as const,
				source: Object.freeze({ kind: 'track' as const, id: 'voice' }),
				destination: Object.freeze({ kind: 'mixer-node' as const, id: 'dialogue' }),
				position: 'post-fader' as const, level: 1, enabled: true, channelMap: Object.freeze([0, 1]),
			}),
			Object.freeze({
				id: 'assignment:mixer-node:dialogue:master', kind: 'assignment' as const,
				source: Object.freeze({ kind: 'mixer-node' as const, id: 'dialogue' }),
				destination: Object.freeze({ kind: 'master' as const }),
				position: 'post-fader' as const, level: 1, enabled: true, channelMap: Object.freeze([0, 1]),
			}),
			PROJECT.mixer.edges.find(({ id }) => id === 'master-main')!,
		]),
	}),
});
