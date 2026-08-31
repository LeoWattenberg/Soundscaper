/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { useWorkspaceAssistanceSearchRuntime } from '../src/common/editor/ui/workspace/useWorkspaceAssistanceSearchRuntime.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a superseded assistance-search session contains disposal rejection and leaves the latest open ready', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const openings = [deferred<Session>(), deferred<Session>()];
	let openingIndex = 0;
	const source = { open: () => openings[openingIndex++]!.promise };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness source={source} />));
		await act(async () => { reactProps(dom.one('[data-open-search="true"]')).onClick(); });
		await act(async () => { reactProps(dom.one('[data-open-search="true"]')).onClick(); });
		await act(async () => {
			openings[0]!.resolve({
				coordinator: { cancel() {} },
				dispose: () => Promise.reject(new Error('revocation unavailable')),
			});
			openings[1]!.resolve({ coordinator: { cancel() {} }, dispose: async () => undefined });
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
		assert.equal(dom.one('[data-search-status="true"]').textContent, 'ready');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

interface Session {
	readonly coordinator: { cancel(): void };
	dispose(): Promise<void>;
}

function Harness({ source }: Readonly<{ source: { open(): Promise<Session> } }>) {
	const runtime = useWorkspaceAssistanceSearchRuntime({
		project: { schemaFamily: 'soundscaper', schemaVersion: 1, id: 'project-1', revision: 1 },
		source,
	});
	return <>
		<button type="button" data-open-search="true" onClick={runtime.openAssistanceSearch}>Open</button>
		<output data-search-status="true">{runtime.assistanceSearch.status}</output>
	</>;
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
} {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((next) => { resolve = next; });
	return { promise, resolve };
}
