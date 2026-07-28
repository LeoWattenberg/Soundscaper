/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { EditorSnapshot } from '../src/common/editor/types.ts';
import StorageCapacityPanel from '../src/common/editor/ui/workspace/StorageCapacityPanel.tsx';

test('storage capacity panel renders the maintained signals and four isolated safe actions', () => {
	const snapshot = {
		storage: {
			usage: 512 * 1024 ** 2, quota: 1024 ** 3, free: 512 * 1024 ** 2,
			pressure: 'normal', evictionProtection: 'best-effort', persistenceRequestAvailable: true,
			updatedAt: 1, cleanupStatus: 'idle', cleanupAvailable: true, lastCleanupAt: null,
			derivativeCleanupStatus: 'idle', derivativeCleanupAvailable: true,
			lastDerivativeCleanupAt: null, lastDerivativeCleanup: null,
			lastPreflight: { operation: 'export', requiredBytes: 256, requiredFreeBytes: 282, status: 'ready' },
			state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false, degradedReason: null,
		},
	} as unknown as EditorSnapshot;
	const action = () => undefined;
	const controller = {
		actions: { storage: {
			refresh: action, requestPersistence: action, cleanupDisposable: action, cleanupDerivatives: action,
		} },
	};
	const markup = renderToStaticMarkup(React.createElement(StorageCapacityPanel, {
		snapshot,
		locale: 'en',
		controller,
		run: (operation: () => unknown) => operation(),
	}));

	assert.match(markup, /data-storage-capacity="true"/u);
	assert.match(markup, /Storage: 512\.0 MB free/u);
	assert.match(markup, /IndexedDB/u);
	assert.match(markup, /Export: 256 B requested · 282 B required free/u);
	assert.match(markup, />Refresh estimate</u);
	assert.match(markup, />Request persistent storage</u);
	assert.match(markup, />Clean orphaned temporary files</u);
	assert.match(markup, />Clear reproducible preview cache</u);
});
