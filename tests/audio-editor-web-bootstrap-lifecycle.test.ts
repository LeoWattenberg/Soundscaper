/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import React, { act } from 'react';

import {
	AudioEditorWebBootstrap,
	createAudioEditorWebRuntimeLifecycle,
} from '../src/common/editor/ui/audio-editor-web-bootstrap.tsx';
import type { MonoConversionConfirmation } from
	'../src/common/editor/ui/dialogs/mono-conversion-confirmation.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
	return { promise, resolve, reject };
}

function confirmation(log: string[]): MonoConversionConfirmation {
	return Object.freeze({
		confirm: async () => Object.freeze({ accepted: false, dontShowAgain: false }),
		dispose: () => { log.push('confirmation'); },
		getSnapshot: () => null,
		settle: () => false,
		subscribe: () => () => undefined,
	});
}

test('the shared web runtime owns attachments and disposes every product resource once', async () => {
	const log: string[] = [];
	const extensionFailure = new Error('extension failed');
	const controllerFailure = new Error('controller failed');
	const environmentFailure = new Error('environment failed');
	const projector = () => 'project';
	const environment = {
		runtime: { projectForRuntimeConsumers: projector },
		store: { assistanceDerivativeRepository: null },
		close: async () => { log.push('environment'); throw environmentFailure; },
	};
	const controller = {
		dispose: async () => { log.push('controller'); throw controllerFailure; },
	};
	const extension = {
		dispose: async () => { log.push('extension'); throw extensionFailure; },
	};
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: true, bridge: Object.freeze({}) }),
		createEnvironment: async () => environment,
		createController: () => controller,
		createExtension: () => extension,
		disposeExtension: (owned) => owned.dispose(),
		createMonoConversionConfirmation: () => confirmation(log),
		constructionCleanupMessage: 'construction cleanup failed',
		extensionAndControllerDisposalMessage: 'extension and controller failed',
		controllerAndEnvironmentDisposalMessage: 'controller and environment failed',
		controllerAndEnvironmentDisposalCause: false,
		exactRuntimeMessage: 'exact runtime required',
	});

	const runtime = await lifecycle.create(Object.freeze({ locale: 'en', copy: Object.freeze({}) }));
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.ok(Object.isFrozen(runtime));
	assert.equal(lifecycle.projectForRuntimeConsumers(runtime), projector);
	assert.ok(lifecycle.assistanceSearchSource(runtime));
	assert.equal(lifecycle.monoConversionConfirmation(runtime).getSnapshot(), null);

	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await assert.rejects(first, (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.message, 'controller and environment failed');
		assert.equal(error.cause, undefined);
		assert.equal(error.errors[1], environmentFailure);
		const prior = error.errors[0];
		assert.ok(prior instanceof AggregateError);
		assert.equal(prior.message, 'extension and controller failed');
		assert.deepEqual(prior.errors, [extensionFailure, controllerFailure]);
		return true;
	});
	assert.deepEqual(log, ['confirmation', 'extension', 'controller', 'environment']);
	await assert.rejects(runtime.dispose());
	assert.deepEqual(log, ['confirmation', 'extension', 'controller', 'environment']);
	assert.throws(
		() => lifecycle.projectForRuntimeConsumers(Object.freeze({}) as never),
		{ name: 'TypeError', message: 'exact runtime required' },
	);
});

test('web runtime leaves storage open when a controller cannot retire its readers', async () => {
	const log: string[] = [];
	const readerFailure = new Error('reader retirement failed');
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => ({
			runtime: { projectForRuntimeConsumers: () => null },
			store: { assistanceDerivativeRepository: null },
			close: async () => { log.push('store closed'); },
		}),
		createController: () => ({
			dispose: async () => { log.push('reader failed'); throw readerFailure; },
			canCloseStore: () => false,
		}),
		createMonoConversionConfirmation: () => confirmation(log),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const runtime = await lifecycle.create(Object.freeze({ locale: 'en' }));
	await assert.rejects(runtime.dispose(), (error: unknown) => error === readerFailure);
	assert.deepEqual(log, ['confirmation', 'reader failed']);
});

test('web runtime fences controller actions while an extension drains', async () => {
	const events: string[] = [];
	const extensionDrain = deferred<void>();
	let fenced = false;
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => ({
			runtime: { projectForRuntimeConsumers: () => null },
			store: { assistanceDerivativeRepository: null },
			close: async () => { events.push('environment'); },
		}),
		createController: () => ({
			beginDisposal: () => { fenced = true; events.push('fenced'); },
			dispose: async () => { events.push('controller'); },
		}),
		createExtension: () => ({ dispose: () => extensionDrain.promise }),
		disposeExtension: (extension) => extension.dispose(),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const runtime = await lifecycle.create(Object.freeze({ locale: 'en' }));
	const pending = runtime.dispose();
	assert.equal(fenced, true);
	assert.deepEqual(events, ['fenced']);
	extensionDrain.resolve();
	await pending;
	assert.deepEqual(events, ['fenced', 'controller', 'environment']);
});

test('an early fence failure still runs controller cleanup and remains the disposal failure', async () => {
	const events: string[] = [];
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => ({
			runtime: { projectForRuntimeConsumers: () => null },
			store: { assistanceDerivativeRepository: null },
			close: async () => { events.push('environment'); },
		}),
		createController: () => ({
			beginDisposal: () => { events.push('fence'); throw null; },
			dispose: async () => { events.push('controller'); },
		}),
		createExtension: () => ({ dispose: async () => { events.push('extension'); } }),
		disposeExtension: (extension) => extension.dispose(),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const runtime = await lifecycle.create(Object.freeze({ locale: 'en' }));
	let rejected = false;
	await runtime.dispose().catch((error: unknown) => { rejected = true; assert.equal(error, null); });
	assert.equal(rejected, true);
	assert.deepEqual(events, ['fence', 'extension', 'controller', 'environment']);
});

test('construction cleanup preserves the primary failure and exact AggregateError wording', async () => {
	const primary = new Error('controller construction failed');
	const cleanup = new Error('environment cleanup failed');
	const log: string[] = [];
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => ({
			runtime: { projectForRuntimeConsumers: () => null },
			store: { assistanceDerivativeRepository: null },
			close: async () => { log.push('environment'); throw cleanup; },
		}),
		createController: () => { throw primary; },
		createMonoConversionConfirmation: () => confirmation(log),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});

	await assert.rejects(
		lifecycle.create(Object.freeze({ locale: 'en', copy: Object.freeze({}) })),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.message, 'construction cleanup failed');
			assert.deepEqual(error.errors, [primary, cleanup]);
			assert.equal(error.cause, primary);
			return true;
		},
	);
	assert.deepEqual(log, ['confirmation', 'environment']);
});

test('localized presentation and durable environment prepare concurrently', async () => {
	const events: string[] = [];
	const presentation = deferred<Readonly<{ locale: string; copy: Readonly<Record<string, unknown>> }>>();
	const environmentReady = deferred<Readonly<{
		runtime: Readonly<{ projectForRuntimeConsumers: () => null }>;
		store: Readonly<{ assistanceDerivativeRepository: null }>;
		close: () => Promise<void>;
	}>>();
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: () => { events.push('storage-start'); return environmentReady.promise; },
		createController: (_environment, value: Readonly<{ locale: string; copy: Readonly<Record<string, unknown>> }>) => {
			events.push(`controller-${value.locale}`);
			return { dispose: async () => { events.push('controller-close'); } };
		},
		createMonoConversionConfirmation: () => confirmation(events),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const pending = lifecycle.createWhenReady(presentation.promise);
	assert.deepEqual(events, ['storage-start']);
	environmentReady.resolve({
		runtime: { projectForRuntimeConsumers: () => null },
		store: { assistanceDerivativeRepository: null },
		close: async () => { events.push('storage-close'); },
	});
	await Promise.resolve();
	assert.deepEqual(events, ['storage-start']);
	presentation.resolve({ locale: 'fr', copy: { title: 'Titre' } });
	const runtime = await pending;
	assert.deepEqual(events, ['storage-start', 'controller-fr']);
	await runtime.dispose();
	assert.deepEqual(events, ['storage-start', 'controller-fr', 'confirmation', 'controller-close', 'storage-close']);
});

test('failed localized presentation closes a concurrently opened environment', async () => {
	const events: string[] = [];
	const presentation = deferred<Readonly<{ locale: string; copy: Readonly<Record<string, unknown>> }>>();
	const environmentReady = deferred<Readonly<{
		runtime: Readonly<{ projectForRuntimeConsumers: () => null }>;
		store: Readonly<{ assistanceDerivativeRepository: null }>;
		close: () => Promise<void>;
	}>>();
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: () => { events.push('storage-start'); return environmentReady.promise; },
		createController: () => ({ dispose: async () => undefined }),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const pending = lifecycle.createWhenReady(presentation.promise);
	presentation.reject(new Error('catalog failed'));
	environmentReady.resolve({
		runtime: { projectForRuntimeConsumers: () => null },
		store: { assistanceDerivativeRepository: null },
		close: async () => { events.push('storage-close'); },
	});
	await assert.rejects(pending, /catalog failed/u);
	assert.deepEqual(events, ['storage-start', 'storage-close']);
});

test('unmount reports storage cleanup failure even when localized copy never settles', async () => {
	const events: string[] = [];
	const closeFailure = new Error('storage close failed');
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => {
			events.push('storage-start');
			return { runtime: { projectForRuntimeConsumers: () => null },
				store: { assistanceDerivativeRepository: null },
				close: async () => { events.push('storage-close'); throw closeFailure; } };
		},
		createController: () => ({ dispose: async () => undefined }),
		constructionCleanupMessage: 'cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'dispose failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});
	const configuration = {
		snapshotFallbackCopy: () => ({}),
		bundledEnglishCopy: () => ({}),
		loadLocalizedCopy: () => new Promise<never>(() => undefined),
		snapshotLocalizedCopy: () => ({}),
		createRuntimeWhenReady: (presentation: PromiseLike<Readonly<{ locale: string; copy: Readonly<Record<string, unknown>> }>>) =>
			lifecycle.createWhenReady(presentation),
		renderEditor: () => React.createElement('div', null, 'ready'),
		reportRuntimeDisposalFailure: (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors[1], closeFailure);
			events.push('cleanup-reported');
		},
		failureFallback: 'Failed: {message}', loadingFallback: 'Loading',
	};
	try {
		act(() => root.render(React.createElement(AudioEditorWebBootstrap, {
			configuration, locale: 'fr', fallbackCopy: {},
		})));
		assert.deepEqual(events, ['storage-start']);
		act(() => root.unmount());
		for (let attempt = 0; attempt < 20 && events.length < 3; attempt += 1) await delay(1);
		assert.deepEqual(events, ['storage-start', 'storage-close', 'cleanup-reported']);
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('returning to a locale waits for its new startup rather than showing disposed or failed state', async () => {
	for (const firstState of ['ready', 'failure']) {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const secondFrench = deferred<Readonly<Record<string, unknown>>>();
		let frenchLoads = 0;
		const configuration = {
			snapshotFallbackCopy: () => ({}), bundledEnglishCopy: () => ({}),
			loadLocalizedCopy: (locale: string) => locale === 'de' ? { label: 'German' } : ++frenchLoads === 1
				? firstState === 'failure' ? Promise.reject(new Error('old catalog failed')) : { label: 'Old French' }
				: secondFrench.promise,
			snapshotLocalizedCopy: (value: unknown) => value as Readonly<Record<string, unknown>>,
			createRuntimeWhenReady: async (presentation: PromiseLike<unknown>) => {
				await presentation;
				return { dispose: async () => undefined };
			},
			renderEditor: ({ copy }: Readonly<{ copy: Readonly<Record<string, unknown>> }>) =>
				React.createElement('div', { 'data-editor': true }, String(copy.label)),
			reportRuntimeDisposalFailure: (error: unknown) => { throw error; },
			failureFallback: 'Failed: {message}', loadingFallback: 'Loading',
		};
		try {
			await act(async () => {
				root.render(React.createElement(AudioEditorWebBootstrap, { configuration, locale: 'fr', fallbackCopy: {} }));
				await delay(0);
			});
			assert.equal(firstState === 'ready' ? dom.one('[data-editor]').textContent : dom.one('[role="alert"]').textContent,
				firstState === 'ready' ? 'Old French' : 'Failed: old catalog failed');
			await act(async () => {
				root.render(React.createElement(AudioEditorWebBootstrap, { configuration, locale: 'de', fallbackCopy: {} }));
				await delay(0);
			});
			assert.equal(dom.one('[data-editor]').textContent, 'German');
			act(() => root.render(React.createElement(AudioEditorWebBootstrap, { configuration, locale: 'fr', fallbackCopy: {} })));
			assert.equal(dom.one('progress').getAttribute('aria-label'), 'Loading editor files');
			assert.equal(dom.find('[data-editor]'), null);
			assert.equal(dom.find('[role="alert"]'), null);
			await act(async () => { secondFrench.resolve({ label: 'New French' }); await delay(0); });
			assert.equal(dom.one('[data-editor]').textContent, 'New French');
			act(() => root.unmount());
		} finally {
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	}
});
