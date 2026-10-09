/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import FramescaperOpenFxInteractPanel from '../src/common/editor/ui/dialogs/FramescaperOpenFxInteractPanel.tsx';
import type { FramescaperOpenFxInteractRequestV1 } from '../src/common/editor/native-ofx-interact-contract.ts';
import type { FramescaperOpenFxInteractInstanceNativeMedia } from '../src/framescaper/editor-native-openfx-action.ts';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { resolveFramescaperNativeServicesCopy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const motions of [0, 300]) for (const heldModifiers of [false, true]) test(`a normal OpenFX drag with ${motions} moves saves after releases${heldModifiers ? ' with held modifiers' : ''}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const instance = authoredInstance();
	const requests: FramescaperOpenFxInteractRequestV1[] = [];
	const commits: FramescaperOpenFxInteractRequestV1[] = [];
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true,
			nativeMediaEnabled: true, queue: [], roots: [], watchRules: [] }),
		control: async () => { throw new Error('not used'); }, reorder: async () => [], remove: async () => false,
		runOpenFxInteract: async (request) => {
			requests.push(request);
			return { protocolVersion: 1, project: request.project, instanceId: request.effect.instanceId,
				effectStateSha256: request.effectStateSha256, width: 64, height: 64, rowBytes: 256,
				target: request.target, parameterName: request.parameterName,
				acceptedSequences: request.events.map(({ sequence }) => sequence), redrawRequested: false,
				surfaceDisposition: 'retained', parameterMutations: [], rgba: new Uint8Array(64 * 64 * 4) };
		},
	};
	try {
		await act(async () => root.render(<FramescaperOpenFxInteractPanel bridge={bridge}
			copy={resolveFramescaperNativeServicesCopy()} runtime={{
				model: async () => ({ plugins: [], targets: [] }), author: async () => undefined,
				interactModel: async () => ({ instances: [instance] }),
				commitInteract: async (request) => { commits.push(request); return instance; },
			}} />));
		const canvas = dom.one('[data-framescaper-openfx-interact-canvas="64x64"]');
		const props = reactProps(canvas);
		const keyboard = (code: string) => ({ key: code.replace(/Left$/u, ''), code,
			altKey: heldModifiers, ctrlKey: heldModifiers, metaKey: false, shiftKey: heldModifiers });
		const pointer = (x: number) => ({ currentTarget: canvas, pointerId: 1, clientX: x, clientY: 40,
			button: 0, altKey: heldModifiers, ctrlKey: heldModifiers, metaKey: false, shiftKey: heldModifiers });
		await act(async () => {
			props.onFocus();
			if (heldModifiers) for (const code of ['ShiftLeft', 'ControlLeft', 'AltLeft']) props.onKeyDown(keyboard(code));
			props.onPointerDown(pointer(20));
			for (let index = 0; index < motions; index += 1) props.onPointerMove(pointer(20 + index / 2));
			props.onPointerUp(pointer(170));
			if (heldModifiers) for (const code of ['ShiftLeft', 'ControlLeft', 'AltLeft']) props.onKeyUp(keyboard(code));
			props.onBlur();
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
		assert.equal(commits.length, 1, 'leaving the surface saves the completed interaction');
		const completed = commits[0]!;
		assert.equal(completed.events.length, motions === 300 ? 256 : heldModifiers ? 10 : 4);
		assert.ok(completed.events.length <= 256);
		assert.deepEqual(completed.events.at(-1), { kind: 'focus', focused: false, sequence: completed.events.length - 1 });
		assert.equal(completed.events.filter((event) => event.kind === 'pointer' && event.phase === 'up').length, 1);
		assert.equal(completed.events.filter((event) => event.kind === 'keyboard' && event.phase === 'up').length, heldModifiers ? 3 : 0);
		assert.ok(requests.every((request) => request.events.length <= 256));
		await act(async () => {
			props.onFocus(); props.onKeyDown(keyboard('Enter')); props.onKeyUp(keyboard('Enter')); props.onBlur();
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
		assert.equal(commits.length, 2, 'the next normal keyboard interaction remains usable');
		assert.deepEqual(commits[1]!.events.map((event) => event.kind === 'focus'
			? `focus:${String(event.focused)}` : `${event.kind}:${event.phase}`),
		['focus:true', 'keyboard:down', 'keyboard:up', 'focus:false']);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function authoredInstance(): FramescaperOpenFxInteractInstanceNativeMedia {
	const sha = '11'.repeat(32);
	return {
		project: { schemaFamily: 'framescaper', schemaVersion: 1, id: 'ordinary-project', revision: 12 },
		pluginHandle: '12'.repeat(20), label: 'Example filter', customParameterNames: [],
		effect: { schemaVersion: 1, instanceId: 'authored-filter', pluginId: 'net.example.Filter',
			binarySha256: '22'.repeat(32), context: 'filter', attachment: { kind: 'filter', targetId: 'clip-1' },
			inputs: [], parameters: [{ name: 'enabled', type: 'boolean', value: true, keyframes: [] }],
			customEncodings: {}, enabled: true, freshness: { authoredStateSha256: sha,
				inputIdentitiesSha256: sha, renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha },
			frozenFallback: null },
	};
}
