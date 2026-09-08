/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import FramescaperNativeServicesDialog from '../src/common/editor/ui/dialogs/FramescaperNativeServicesDialog.tsx';
import type { FramescaperNativeWatchCreateRendererRequest } from '../src/common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import {
	createFramescaperNativeServicesBridgeFixture,
	framescaperNativeRendererSnapshot,
	framescaperNativeServiceSnapshot,
} from './helpers/framescaper-native-services-surface-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const ROOT_A = 'aa'.repeat(16);
const ROOT_B = 'bb'.repeat(16);

test('watch creation falls back when the selected durable root is revoked', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let roots = [root(ROOT_A, 'Root A'), root(ROOT_B, 'Root B')];
	const requests: FramescaperNativeWatchCreateRendererRequest[] = [];
	const fixture = createFramescaperNativeServicesBridgeFixture({
		snapshot: async () => ({ ...framescaperNativeServiceSnapshot(), roots }),
		createWatch: async (request) => {
			requests.push(request);
			return { ...request, ruleId: 'cc'.repeat(16), enabled: true };
		},
	});
	const initial = framescaperNativeRendererSnapshot({
		runtimeAvailable: true, nativeMediaEnabled: true,
	});
	const { createRoot } = await import('react-dom/client');
	const reactRoot = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			reactRoot.render(<FramescaperNativeServicesDialog
				bridge={fixture.bridge}
				initialSurface="watch-folders"
				initialSnapshot={{ ...initial, services: { ...initial.services, roots } }}
				context={{ projectId: 'project-1', binId: null, allowProxyGeneration: false }}
				onClose={() => undefined}
			/>);
			await settle();
		});
		const selects = dom.container.querySelectorAll('select');
		const rootSelect = selects[0];
		assert.ok(rootSelect);
		await act(async () => {
			rootSelect.value = ROOT_B;
			reactProps(rootSelect).onChange?.({ currentTarget: rootSelect });
		});
		roots = [root(ROOT_A, 'Root A'), root(ROOT_B, 'Root B', true)];
		await act(async () => {
			reactProps(dom.one('[data-framescaper-native-refresh="true"]')).onClick?.();
			await settle();
		});
		const form = dom.one('form');
		await act(async () => {
			reactProps(form).onSubmit?.({ preventDefault() {} });
			await settle();
		});
		assert.equal(requests[0]?.grantId, ROOT_A);
	} finally {
		await act(async () => reactRoot.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function root(grantId: string, displayName: string, revoked = false) {
	return Object.freeze({ grantId, displayName, revoked });
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
}
