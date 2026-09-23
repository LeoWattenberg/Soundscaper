/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LocalModelManagerDialogView } from '../src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx';
import { normalizeLocalModelManagerStatus } from '../src/common/editor/ui/local-model-manager-bridge.ts';
import type { LocalModelManagerSnapshot } from '../src/common/editor/ui/local-model-manager-store.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v2', version: '2.0.0', task: 'speech-recognition',
	availability: 'installable' as const, downloadBytes: 661_190_513,
	runtimeDownloadBytes: 32_800_000, installedBytes: null, attributionRequired: false,
});
const CALLBACKS = Object.freeze({
	onClose: () => undefined, onInstall: () => undefined,
	onInstallPreseeded: () => undefined, onCancelInstall: () => undefined,
	onRemove: () => undefined, onRetry: () => undefined,
	onReconcile: () => undefined, onGarbageCollect: () => undefined,
	onShowNotices: () => undefined, onRelocate: () => undefined,
});

function snapshot(runtimeReason: string | null): LocalModelManagerSnapshot {
	return Object.freeze({
		phase: 'ready', runtimeAvailable: false, runtimeReason,
		models: Object.freeze([MODEL]), busyModelIds: Object.freeze([]),
		installingModelIds: Object.freeze([]), cancellingModelIds: Object.freeze([]),
		progress: Object.freeze([]), maintenanceOperation: null, lastResult: null,
		notices: Object.freeze([]), noticesLoaded: false, error: null,
	});
}

test('Model Manager reports the extra engine transfer and explains its first download', () => {
	const markup = renderToStaticMarkup(<LocalModelManagerDialogView
		copy={ENGLISH_COPY} locale="en" snapshot={snapshot(
			'The optional speech runtime is not installed.',
		)} {...CALLBACKS} />);
	assert.match(markup, /Required runtime download/iu);
	assert.match(markup, /31\.3 MiB/u);
	assert.match(markup, /speech engine downloads when you install a speech model/iu);
	assert.throws(() => normalizeLocalModelManagerStatus({
		runtimeAvailable: false, runtimeReason: null,
		models: [{ ...MODEL, runtimeDownloadBytes: -1 }],
	}), /runtime download bytes/iu);
});
