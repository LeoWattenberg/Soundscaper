/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { installReactTestDom, reactProps as props, type ReactTestElement as TestElement } from './helpers/react-test-dom.ts';

import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import { WebFileLoadLimitError } from '../src/common/editor/web-file-limit-failure.ts';
import { CapturedVideoProxyBodyStagingError } from '../src/framescaper/editor-captured-video-proxy-bodies.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../src/framescaper/editor-video-proxy-action-runtime.ts';

test('the video source picker is locked while a proxy operation is pending', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const generation = deferred<void>();
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: async () => undefined,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: () => generation.promise,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const generate = dom.elements('button').find((node) => node.hasAttribute('data-video-proxy-generate'));
		assert.ok(generate);
		await act(async () => {
			props(generate).onClick();
			await Promise.resolve();
		});
		assert.equal(dom.elements('select')[0]?.hasAttribute('disabled'), true);
		await act(async () => {
			generation.resolve();
			await generation.promise;
			await Promise.resolve();
		});
		assert.equal(dom.elements('select')[0]?.hasAttribute('disabled'), false);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('cancelling proxy body staging reports cancellation through its preserved cause', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const controller = {};
	const cancelled = new CapturedVideoProxyBodyStagingError(
		new DOMException('The captured proxy scheduler was disposed.', 'AbortError'),
		[],
	);
	let failure: unknown = cancelled;
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: async () => undefined,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: (_sourceId, _candidate, options) => new Promise<void>((_resolve, reject) => {
			options?.signal?.addEventListener('abort', () => {
				reject(failure);
			}, { once: true });
		}),
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const input = dom.elements('input').find((node) => node.hasAttribute('data-video-proxy-existing-file'));
		assert.ok(input);
		await act(async () => {
			props(input).onChange({ currentTarget: { files: [new File(['proxy'], 'proxy.webm')], value: '' } });
			await Promise.resolve();
		});
		const cancel = dom.elements('button').find((node) => node.hasAttribute('data-video-proxy-cancel'));
		assert.ok(cancel);
		await act(async () => {
			props(cancel).onClick();
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /Proxy work cancelled\./u);
		assert.doesNotMatch(dom.container.textContent, /scheduler was disposed/u);

		failure = new AggregateError([cancelled, new Error('Proxy claim cleanup failed.')],
			'Captured proxy work and cleanup failed.', { cause: cancelled });
		await act(async () => {
			props(input).onChange({ currentTarget: { files: [new File(['proxy'], 'proxy.webm')], value: '' } });
			await Promise.resolve();
		});
		const retryCancel = dom.elements('button').find((node) => node.hasAttribute('data-video-proxy-cancel'));
		assert.ok(retryCancel);
		await act(async () => {
			props(retryCancel).onClick();
			await Promise.resolve();
		});
		assert.match(dom.container.textContent, /Proxy claim cleanup failed\./u);
		assert.doesNotMatch(dom.container.textContent, /Proxy work cancelled\./u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('browser Attach Existing marks storage failures but keeps invalid files ordinary', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const quota = new DOMException('Browser storage full', 'QuotaExceededError');
	const invalid = new Error('Invalid proxy metadata');
	let failure: Error = quota;
	const surfaced: unknown[] = [];
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto', previewTrust: () => 'unverified',
		setMode: async () => undefined, pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => { throw failure; },
		detach: async () => undefined, regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false} copy={{}} fileService={{}}
			run={(operation) => {
				const result = Promise.resolve(operation());
				void result.catch((error: unknown) => { surfaced.push(error); });
				return result;
			}}
			onClose={() => undefined}
		/>));
		const input = dom.elements('input').find((node) => node.hasAttribute('data-video-proxy-existing-file'));
		assert.ok(input);
		const attach = async (): Promise<void> => act(async () => {
			props(input).onChange({ currentTarget: { files: [new File(['proxy'], 'proxy.webm')], value: '' } });
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		});
		await attach();
		assert.ok(surfaced[0] instanceof WebFileLoadLimitError);
		assert.equal(surfaced[0].cause, quota);
		assert.doesNotMatch(dom.container.textContent, /A file load exceeded this browser/u);
		failure = invalid;
		await attach();
		assert.equal(surfaced[1], invalid);
		assert.match(dom.container.textContent, /Invalid proxy metadata/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('preview mode changes settle in intent order and ignore an older failure', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const first = deferred<void>();
	const second = deferred<void>();
	const calls: string[] = [];
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: (_sourceId, mode) => {
			calls.push(mode);
			return mode === 'proxy' ? first.promise : second.promise;
		},
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const mode = dom.elements('select')[1];
		assert.ok(mode);
		await change(mode, 'proxy');
		await change(mode, 'original');
		assert.deepEqual(calls, ['proxy'], 'the newer intent waits for the older mutation');
		await act(async () => {
			first.reject(new Error('obsolete proxy failure'));
			await first.promise.catch(() => undefined);
			await Promise.resolve();
		});
		assert.deepEqual(calls, ['proxy', 'original']);
		await act(async () => {
			second.resolve();
			await second.promise;
			await Promise.resolve();
		});
		assert.doesNotMatch(dom.container.textContent, /obsolete proxy failure/u);
		assert.match(dom.container.textContent, /preview mode updated/iu);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a rejected preview mode change restores the mode the runtime still owns', async () => {
	const dom = installTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const mutation = deferred<void>();
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: () => mutation.promise,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperVideoProxyDialog
			controller={controller}
			snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
			editingBlocked={false}
			copy={{}}
			fileService={{}}
			run={(operation) => operation()}
			onClose={() => undefined}
		/>));
		const mode = dom.elements('select')[1];
		assert.ok(mode);
		await change(mode, 'proxy');
		assert.equal(mode.value, 'proxy');

		await act(async () => {
			mutation.reject(new Error('verified proxy unavailable'));
			await mutation.promise.catch(() => undefined);
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		});

		assert.match(dom.container.textContent, /verified proxy unavailable/u);
		assert.equal(dom.elements('select')[1]?.getAttribute('data-video-proxy-preview-mode'), 'auto');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		sources: [{ kind: 'video', id: 'video-source', name: 'Camera', proxyAttachment: null }],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source' }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (reason: unknown) => void;
}> {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
	return Object.freeze({ promise, resolve, reject });
}

async function change(node: TestElement, value: string): Promise<void> {
	await act(async () => {
		node.value = value;
		props(node).onChange({ currentTarget: node, target: node });
		await Promise.resolve();
	});
}

interface TestDom {
	readonly container: TestElement;
	elements(tagName: string): TestElement[];
	restore(): void;
}

function installTestDom(): TestDom {
	const dom = installReactTestDom();
	return Object.freeze({
		container: dom.container,
		elements: (tagName: string) => dom.container.querySelectorAll(tagName),
		restore: dom.restore,
	});
}
