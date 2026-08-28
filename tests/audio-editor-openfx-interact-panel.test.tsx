/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	appendOpenFxInteractReplay,
	createFramescaperOpenFxInteractRequestV1,
	default as FramescaperOpenFxInteractPanel,
	normalizeOpenFxPointer,
	openFxModifiers,
} from '../src/common/editor/ui/dialogs/FramescaperOpenFxInteractPanel.tsx';
import type { OfxInteractEventV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { resolveFramescaperNativeServicesCopy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import type { FramescaperOpenFxInteractInstanceNativeMedia } from '../src/framescaper/editor-native-openfx-action.ts';

test('OpenFX Interact pointer geometry is clamped and modifier order is canonical', () => {
	assert.deepEqual(normalizeOpenFxPointer(
		{ left: 10, top: 20, width: 200, height: 100 },
		{ clientX: 110, clientY: 170, button: -1 } as never,
	), { x: 0.5, y: 1, button: 0 });
	assert.deepEqual(openFxModifiers({
		altKey: true, ctrlKey: true, metaKey: true, shiftKey: true,
	} as never), ['alt', 'control', 'meta', 'shift']);
});

test('OpenFX Interact cumulatively replays one ordered lifecycle across UI events', () => {
	const events: readonly OfxInteractEventV1[] = [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'pointer', phase: 'down', sequence: 1, x: 0.25, y: 0.75,
			button: 1, modifiers: [] },
		{ kind: 'pointer', phase: 'motion', sequence: 2, x: 0.5, y: 0.5,
			button: 1, modifiers: ['shift'] },
		{ kind: 'pointer', phase: 'up', sequence: 3, x: 0.5, y: 0.5,
			button: 1, modifiers: [] },
		{ kind: 'keyboard', phase: 'down', sequence: 4, key: 'Enter', code: 'Enter',
			modifiers: [] },
		{ kind: 'keyboard', phase: 'up', sequence: 5, key: 'Enter', code: 'Enter',
			modifiers: [] },
	];
	let replay: readonly OfxInteractEventV1[] = Object.freeze([]);
	const requests = events.map((event) => (replay = appendOpenFxInteractReplay(replay, event)));
	assert.deepEqual(requests.map((request) => request.map(({ sequence }) => sequence)), [
		[0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5],
	]);
	assert.deepEqual(replay.map((event) => event.kind === 'focus'
		? `focus:${String(event.focused)}` : `${event.kind}:${event.phase}`), [
		'focus:true', 'pointer:down', 'pointer:motion', 'pointer:up',
		'keyboard:down', 'keyboard:up',
	]);
});

test('the menu-owned OpenFX Interact panel declares an accessible offscreen surface', () => {
	const bridge = {
		snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true,
			nativeMediaEnabled: true, queue: [], roots: [], watchRules: [] }),
		control: async () => { throw new Error('not used'); },
		reorder: async () => [],
		remove: async () => false,
		listOpenFxPlugins: async () => [],
		runOpenFxInteract: async () => { throw new Error('not used during server render'); },
	} satisfies FramescaperNativeServicesBridge;
	const markup = renderToStaticMarkup(<FramescaperOpenFxInteractPanel
		bridge={bridge} runtime={{
			model: async () => ({ plugins: [], targets: [] }), author: async () => undefined,
			interactModel: async () => ({ instances: [] }),
			commitInteract: async () => { throw new Error('not used during server render'); },
		}} copy={resolveFramescaperNativeServicesCopy()} />);
	assert.match(markup, /data-framescaper-openfx-interact="true"/u);
	assert.match(markup, /OpenFX Interact Suite V1/u);
	assert.match(markup, /No vendor window opens/u);
});

test('the panel request is bound to one authored baseline effect rather than an inventory plug-in demo', () => {
	const instance = authoredInstance();
	const request = createFramescaperOpenFxInteractRequestV1(
		instance, { target: 'overlay', parameterName: null }, [],
	);
	assert.deepEqual(request.project, {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-v28', revision: 12,
	});
	assert.equal(request.effect.instanceId, 'authored-filter');
	assert.equal(request.effect.parameters[0]?.value, true);
	assert.equal(request.pluginHandle, '12'.repeat(20));
});

function authoredInstance(): FramescaperOpenFxInteractInstanceNativeMedia {
	const sha = '11'.repeat(32);
	return {
		project: {
			schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-v28', revision: 12,
		},
		pluginHandle: '12'.repeat(20),
		label: 'net.example.Filter — clip-1 — authored-filter', customParameterNames: [],
		effect: {
			schemaVersion: 1, instanceId: 'authored-filter', pluginId: 'net.example.Filter',
			binarySha256: '22'.repeat(32), context: 'filter',
			attachment: { kind: 'filter', targetId: 'clip-1' }, inputs: [],
			parameters: [{ name: 'enabled', type: 'boolean', value: true, keyframes: [] }],
			customEncodings: {}, enabled: true,
			freshness: { authoredStateSha256: sha, inputIdentitiesSha256: sha,
				renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha },
			frozenFallback: null,
		},
	};
}
