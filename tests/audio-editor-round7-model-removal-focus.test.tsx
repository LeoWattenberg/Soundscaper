/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { LocalModelManagerDialogView } from '../src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx';
import type { LocalModelManagerSnapshot } from '../src/common/editor/ui/local-model-manager-store.ts';
import type { LocalModelManagerModel } from '../src/common/editor/ui/local-model-manager-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('keyboard model removal continues on the replacement Install action', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const installed: LocalModelManagerModel = { modelId: 'deepfilternet3', version: '3.0.0',
		task: 'speech-enhancement', availability: 'installed', downloadBytes: 4096,
		installedBytes: 4096, attributionRequired: false };
	let snapshot: LocalModelManagerSnapshot = { phase: 'ready', runtimeAvailable: true,
		runtimeReason: null, models: [installed], busyModelIds: [], installingModelIds: [],
		cancellingModelIds: [], progress: [], maintenanceOperation: null, lastResult: null,
		notices: [], noticesLoaded: false, error: null };
	const render = () => root.render(<LocalModelManagerDialogView copy={{}} locale="en" snapshot={snapshot}
		onClose={() => undefined} onInstall={() => undefined} onInstallPreseeded={() => undefined}
		onCancelInstall={() => undefined} onRemove={() => {
			snapshot = { ...snapshot, models: [{ ...installed, availability: 'installable', installedBytes: null }] };
			render();
		}} onReconcile={() => undefined} onGarbageCollect={() => undefined}
		onShowNotices={() => undefined} onRelocate={() => undefined} onRetry={() => undefined} />);
	try {
		await act(async () => render());
		const row = dom.one('[data-local-model-id="deepfilternet3"]');
		const remove = row.querySelectorAll('button').find(button => button.textContent === 'Remove')!;
		remove.focus();
		await act(async () => reactProps(remove).onClick({ currentTarget: remove }));
		assert.equal(remove.isConnected, false, 'the original focused action was removed');
		const install = row.querySelectorAll('button').find(button => button.textContent === 'Install')!;
		assert.ok(install);
		assert.equal(dom.container.ownerDocument.activeElement, install, 'the surviving row action receives focus');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
