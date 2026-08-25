/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	normalizeLocalModelManagerStatus,
	resolveLocalModelManagerBridge,
	type LocalModelManagerBridge,
	type LocalModelManagerModel,
} from '../src/common/editor/ui/local-model-manager-bridge.ts';
import {
	createLocalModelManagerStore,
	type LocalModelManagerSnapshot,
} from '../src/common/editor/ui/local-model-manager-store.ts';
import LocalModelManagerDialog, {
	LocalModelManagerDialogView,
} from '../src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const INSTALLABLE_MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v2',
	version: '2.0.0',
	task: 'speech-recognition',
	availability: 'installable' as const,
	downloadBytes: 661_190_513,
	installedBytes: null,
	attributionRequired: false,
});

const INSTALLED_MODEL = Object.freeze({
	...INSTALLABLE_MODEL,
	availability: 'installed' as const,
	installedBytes: 661_190_513,
});

function status(models: readonly LocalModelManagerModel[] = [INSTALLABLE_MODEL]) {
	return Object.freeze({
		modelsDirectory: '/private/models',
		runtimeAvailable: true,
		runtimeReason: null,
		models: Object.freeze(models),
	});
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function bridgeFixture() {
	const calls: string[] = [];
	const install = deferred<unknown>();
	let currentStatus = status();
	let progressListener: ((value: unknown) => void) | null = null;
	const bridge: LocalModelManagerBridge = {
		listAssistanceModels: async () => {
			calls.push('list');
			return currentStatus;
		},
		installAssistanceModel: (modelId) => {
			calls.push(`install:${modelId}`);
			return install.promise;
		},
		cancelAssistanceModelInstall: async (modelId) => {
			calls.push(`cancel:${modelId}`);
			install.reject(new Error('Local-model installation was cancelled.'));
			await Promise.resolve();
			return { contractVersion: 1, modelId, outcome: 'cancelled' };
		},
		installPreseededAssistanceModel: async (modelId) => {
			calls.push(`preseed:${modelId}`);
			return null;
		},
		reconcileAssistanceModels: async () => {
			calls.push('reconcile');
			return { installedModelIds: [], incompleteModelIds: [INSTALLABLE_MODEL.modelId], rejected: [] };
		},
		collectAssistanceModelGarbage: async () => {
			calls.push('garbage');
			return { reclaimedBlobBytes: 10, discardedManifestCount: 1, discardedPartialCount: 2,
				discardedPartialBytes: 20, reclaimedBytes: 30 };
		},
		listAssistanceModelNotices: async () => {
			calls.push('notices');
			return [{ schemaVersion: 1, modelId: INSTALLED_MODEL.modelId, version: INSTALLED_MODEL.version,
				purpose: 'Speech recognition', codeLicense: 'MIT', weightsLicense: 'CC-BY-4.0',
				attributionRequired: true, provenanceSources: ['https://upstream.invalid/model'],
				upstreamRevision: 'abc123', distributionKind: 'identity-mirrored' }];
		},
		relocateAssistanceModels: async () => {
			calls.push('relocate');
			return { contractVersion: 1, totalBytes: 40, fileCount: 3, sourceRemoved: true };
		},
		removeAssistanceModel: async (modelId) => {
			calls.push(`remove:${modelId}`);
			currentStatus = status();
			return 661_190_513;
		},
		onAssistanceInstallProgress: (listener) => {
			progressListener = listener;
			return () => { progressListener = null; };
		},
	};
	return {
		bridge,
		calls,
		install,
		installComplete() {
			currentStatus = status([INSTALLED_MODEL]);
			install.resolve(INSTALLED_MODEL);
		},
		progress(value: unknown) { progressListener?.(value); },
	};
}

test('the local-model bridge admits only the complete pathless desktop contract', () => {
	const fixture = bridgeFixture();
	assert.equal(resolveLocalModelManagerBridge(fixture.bridge), fixture.bridge);
	assert.equal(resolveLocalModelManagerBridge({
		...fixture.bridge,
		onAssistanceInstallProgress: undefined,
	}), null);
	assert.equal(resolveLocalModelManagerBridge(null), null);
	assert.throws(
		() => normalizeLocalModelManagerStatus({ ...status(), runtimeAvailable: 'yes' }),
		/runtime availability/iu,
	);
	assert.throws(
		() => normalizeLocalModelManagerStatus(status([{
			...INSTALLABLE_MODEL, attributionRequired: 'sometimes',
		} as unknown as LocalModelManagerModel])),
		/attribution requirement/iu,
	);
});

test('opening the store loads status but never downloads a model', async () => {
	const fixture = bridgeFixture();
	const store = createLocalModelManagerStore(fixture.bridge);
	const disconnect = store.connect();

	assert.equal(store.getSnapshot().phase, 'idle');
	await store.load();

	assert.deepEqual(fixture.calls, ['list']);
	assert.equal(store.getSnapshot().phase, 'ready');
	assert.deepEqual(store.getSnapshot().models, [INSTALLABLE_MODEL]);
	disconnect();
});

test('explicit installs accept only progress correlated to their active model', async () => {
	const fixture = bridgeFixture();
	const store = createLocalModelManagerStore(fixture.bridge);
	const disconnect = store.connect();
	await store.load();

	const operation = store.install(INSTALLABLE_MODEL.modelId);
	fixture.progress({
		modelId: 'unrelated-model', fileName: 'model.onnx',
		completedBytes: 900, totalBytes: 1_000,
	});
	assert.deepEqual(store.getSnapshot().progress, []);
	fixture.progress({
		modelId: INSTALLABLE_MODEL.modelId, fileName: 'encoder.onnx',
		completedBytes: 100, totalBytes: 1_000,
	});
	assert.deepEqual(store.getSnapshot().progress, [{
		modelId: INSTALLABLE_MODEL.modelId, fileName: 'encoder.onnx',
		completedBytes: 100, totalBytes: 1_000,
	}]);

	fixture.installComplete();
	await operation;
	assert.deepEqual(fixture.calls, [
		'list', `install:${INSTALLABLE_MODEL.modelId}`, 'list',
	]);
	assert.equal(store.getSnapshot().models[0]?.availability, 'installed');
	assert.deepEqual(store.getSnapshot().progress, []);
	disconnect();
});

test('install cancellation stays explicit and clears activity only after acknowledgement', async () => {
	const fixture = bridgeFixture();
	const store = createLocalModelManagerStore(fixture.bridge);
	await store.load();
	const install = store.install(INSTALLABLE_MODEL.modelId);

	assert.deepEqual(store.getSnapshot().installingModelIds, [INSTALLABLE_MODEL.modelId]);
	const cancellation = store.cancelInstall(INSTALLABLE_MODEL.modelId);
	assert.deepEqual(store.getSnapshot().cancellingModelIds, [INSTALLABLE_MODEL.modelId]);
	await cancellation;
	await install;

	assert.deepEqual(fixture.calls, [
		'list', `install:${INSTALLABLE_MODEL.modelId}`, `cancel:${INSTALLABLE_MODEL.modelId}`, 'list',
	]);
	assert.deepEqual(store.getSnapshot().busyModelIds, []);
	assert.deepEqual(store.getSnapshot().cancellingModelIds, []);
	assert.equal(store.getSnapshot().error, null);
});

test('offline seeds and maintenance operations run only when explicitly requested', async () => {
	const fixture = bridgeFixture();
	const store = createLocalModelManagerStore(fixture.bridge);
	await store.load();
	await store.installPreseeded(INSTALLABLE_MODEL.modelId);
	await store.reconcile();
	await store.garbageCollect();
	await store.showNotices();
	await store.relocate();

	assert.deepEqual(fixture.calls, [
		'list', `preseed:${INSTALLABLE_MODEL.modelId}`, 'reconcile', 'list',
		'garbage', 'list', 'notices', 'relocate', 'list',
	]);
	assert.equal(store.getSnapshot().noticesLoaded, true);
	assert.equal(store.getSnapshot().notices[0]?.codeLicense, 'MIT');
	assert.equal(store.getSnapshot().lastResult?.kind, 'relocate');
});

test('installed models are removed only by an explicit row action', async () => {
	const fixture = bridgeFixture();
	fixture.installComplete();
	const store = createLocalModelManagerStore(fixture.bridge);
	await store.load();

	assert.equal(store.getSnapshot().models[0]?.availability, 'installed');
	await store.remove(INSTALLED_MODEL.modelId);

	assert.deepEqual(fixture.calls, [
		'list', `remove:${INSTALLED_MODEL.modelId}`, 'list',
	]);
	assert.equal(store.getSnapshot().models[0]?.availability, 'installable');
});

test('store failures stay visible and retryable without inventing model state', async () => {
	const fixture = bridgeFixture();
	const failure = new Error('Catalog could not be authenticated.');
	const store = createLocalModelManagerStore({
		...fixture.bridge,
		listAssistanceModels: async () => { throw failure; },
	});

	await store.load();

	assert.equal(store.getSnapshot().phase, 'error');
	assert.equal(store.getSnapshot().error?.message, failure.message);
	assert.deepEqual(store.getSnapshot().models, []);
});

test('the manager view exposes runtime, sizes, correlated progress, and explicit actions', () => {
	const snapshot: LocalModelManagerSnapshot = Object.freeze({
		phase: 'ready',
		runtimeAvailable: false,
		runtimeReason: 'Native inference runtime is unavailable.',
		models: Object.freeze([INSTALLABLE_MODEL]),
		busyModelIds: Object.freeze([INSTALLABLE_MODEL.modelId]),
		installingModelIds: Object.freeze([INSTALLABLE_MODEL.modelId]),
		cancellingModelIds: Object.freeze([]),
		progress: Object.freeze([{
			modelId: INSTALLABLE_MODEL.modelId,
			fileName: 'encoder.onnx', completedBytes: 100, totalBytes: 1_000,
		}]),
		maintenanceOperation: null,
		lastResult: null,
		notices: Object.freeze([]),
		noticesLoaded: false,
		error: null,
	});
	const markup = renderToStaticMarkup(<LocalModelManagerDialogView
		copy={ENGLISH_COPY}
		locale="en"
		snapshot={snapshot}
		onClose={() => undefined}
		onInstall={() => undefined}
		onInstallPreseeded={() => undefined}
		onCancelInstall={() => undefined}
		onRemove={() => undefined}
		onReconcile={() => undefined}
		onGarbageCollect={() => undefined}
		onShowNotices={() => undefined}
		onRelocate={() => undefined}
		onRetry={() => undefined}
	/>);

	assert.match(markup, /data-local-model-manager="true"/u);
	assert.match(markup, /role="status"/u);
	assert.match(markup, /Native inference runtime is unavailable/u);
	assert.match(markup, /630\.6 MiB/u);
	assert.match(markup, /encoder\.onnx/u);
	assert.match(markup, /<progress[^>]*value="100"[^>]*max="1000"/u);
	assert.match(markup, /Installing/u);
	assert.match(markup, /Cancel install/u);
	assert.match(markup, /Reconcile pre-seeded files/u);
	assert.match(markup, /Collect unused files/u);
	assert.match(markup, /Relocate model storage/u);
	assert.match(markup, /Show installed notices/u);
	assert.match(markup, /disabled=""/u);
	const installedMarkup = renderToStaticMarkup(<LocalModelManagerDialogView
		copy={ENGLISH_COPY} locale="en"
		snapshot={Object.freeze({
			...snapshot, models: Object.freeze([INSTALLED_MODEL]),
			busyModelIds: Object.freeze([]), progress: Object.freeze([]),
		})}
		onClose={() => undefined} onInstall={() => undefined}
		onInstallPreseeded={() => undefined} onCancelInstall={() => undefined}
		onRemove={() => undefined} onRetry={() => undefined}
		onReconcile={() => undefined} onGarbageCollect={() => undefined}
		onShowNotices={() => undefined} onRelocate={() => undefined}
	/>);
	assert.match(installedMarkup, />Remove</u);
	const offlineMarkup = renderToStaticMarkup(<LocalModelManagerDialogView
		copy={ENGLISH_COPY} locale="en"
		snapshot={Object.freeze({
			...snapshot, busyModelIds: Object.freeze([]), installingModelIds: Object.freeze([]),
			progress: Object.freeze([]), noticesLoaded: true,
			notices: Object.freeze([{
				schemaVersion: 1 as const, modelId: INSTALLABLE_MODEL.modelId, version: '2.0.0',
				purpose: 'Speech recognition', codeLicense: 'MIT', weightsLicense: 'CC-BY-4.0',
				attributionRequired: true, provenanceSources: Object.freeze(['https://upstream.invalid/model']),
				upstreamRevision: 'abc123', distributionKind: 'identity-mirrored' as const,
			}]),
		})}
		onClose={() => undefined} onInstall={() => undefined}
		onInstallPreseeded={() => undefined} onCancelInstall={() => undefined}
		onRemove={() => undefined} onRetry={() => undefined}
		onReconcile={() => undefined} onGarbageCollect={() => undefined}
		onShowNotices={() => undefined} onRelocate={() => undefined}
	/>);
	assert.match(offlineMarkup, /Install from folder/u);
	assert.match(offlineMarkup, /Installed model notices/u);
	assert.match(offlineMarkup, /CC-BY-4\.0/u);
	assert.match(offlineMarkup, /https:\/\/upstream\.invalid\/model/u);
});

test('loading and load failure states are announced accessibly', () => {
	const bridge = bridgeFixture().bridge;
	const loading = renderToStaticMarkup(<LocalModelManagerDialog
		bridge={bridge} copy={ENGLISH_COPY} locale="en" onClose={() => undefined}
	/>);
	assert.match(loading, /role="status"[^>]*aria-live="polite"/u);
	assert.match(loading, /Loading local models/u);

	const failed: LocalModelManagerSnapshot = Object.freeze({
		phase: 'error', runtimeAvailable: null, runtimeReason: null,
		models: Object.freeze([]), busyModelIds: Object.freeze([]),
		installingModelIds: Object.freeze([]), cancellingModelIds: Object.freeze([]),
		progress: Object.freeze([]), maintenanceOperation: null, lastResult: null,
		notices: Object.freeze([]), noticesLoaded: false,
		error: Object.freeze({ modelId: null, message: 'No catalog.' }),
	});
	const errorMarkup = renderToStaticMarkup(<LocalModelManagerDialogView
		copy={ENGLISH_COPY} locale="en" snapshot={failed}
		onClose={() => undefined} onInstall={() => undefined}
		onInstallPreseeded={() => undefined} onCancelInstall={() => undefined}
		onRemove={() => undefined} onRetry={() => undefined}
		onReconcile={() => undefined} onGarbageCollect={() => undefined}
		onShowNotices={() => undefined} onRelocate={() => undefined}
	/>);
	assert.match(errorMarkup, /role="alert"/u);
	assert.match(errorMarkup, /No catalog/u);
	assert.match(errorMarkup, />Retry</u);
});

test('Tools reaches Local Models in both desktops and omits it in the browser', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const opened: string[] = [];
		const desktopMenus = createWorkspaceApplicationMenus(workspaceMenuInput(
			productId, true, (surface) => opened.push(surface),
		));
		const tools = (desktopMenus as readonly MenuItem[]).find(({ id }) => id === 'tools');
		const localModels = findMenuItem(tools?.items ?? [], 'local-models');
		const manage = findMenuItem(localModels?.items ?? [], 'manage-local-models');
		assert.equal(localModels?.label, 'Local Models');
		assert.equal(manage?.label, 'Manage Models…');
		manage?.onClick?.();
		assert.deepEqual(opened, ['local-models']);
		assert.equal(findMenuItem(
			createWorkspaceApplicationMenus(workspaceMenuInput(productId, false, () => undefined)),
			'local-models',
		), null);
	}
});

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
}

function findMenuItem(values: unknown, id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function workspaceMenuInput(
	productId: string,
	isDesktop: boolean,
	openSurface: (surface: string) => void,
) {
	return {
		aboutLabel: 'About',
		aup4InputRef: { current: null },
		blocked: false,
		capabilities: {},
		controller: { actions: {} },
		copy: ENGLISH_COPY,
		crossProductHandoffAvailable: false,
		desktopHostRuntime: null,
		durationFrames: 0,
		editBlocked: false,
		handoffBlocked: false,
		executeEdit: () => undefined,
		fileService: { isDesktop },
		importInputRef: { current: null },
		legacyAupInputRef: { current: null },
		locale: 'en',
		openDesktopFiles: () => undefined,
		openEffects: () => undefined,
		openExternal: () => undefined,
		openGenerator: () => undefined,
		openProjects: () => undefined,
		openRecordingOffset: () => undefined,
		openSelectionEffect: () => undefined,
		openSpectralSelection: () => undefined,
		openSurface,
		openTimedRecording: () => undefined,
		openWorkspacePanel: () => undefined,
		parityRuntime: { actions: { timeline: {}, help: {} } },
		productId,
		project: null,
		projectBinEffectivelyOpen: false,
		recordLabel: 'Record',
		run: (operation: () => unknown) => operation(),
		selectedClip: null,
		selectedAudioTrack: null,
		selectionActive: false,
		setDialog: () => undefined,
		setDialogValue: () => undefined,
		setNyquistTarget: () => undefined,
		setShowArmControls: () => undefined,
		showArmControls: false,
		soundscaperProduction: null,
		snapshot: {
			preferences: {
				workspace: {
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
					custom: [], activeId: 'modern',
				},
				view: {},
			},
		},
		toggleFullscreen: () => undefined,
		toggleRecording: () => undefined,
		toggleWorkspacePanel: () => undefined,
		uiFlags: {},
		zoomProject: () => undefined,
	};
}
