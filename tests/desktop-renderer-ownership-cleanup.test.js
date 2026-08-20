/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopRendererOwnershipCleanup } from '../desktop/renderer-ownership-cleanup.js';

test('renderer ownership is revoked synchronously and repeated drains share one cleanup barrier', async () => {
	const webContents = {};
	const owner = {};
	const events = [];
	let release;
	const barrier = new Promise((resolve) => { release = resolve; });
	const cleanup = new DesktopRendererOwnershipCleanup({
		linkedVideoLocators: () => ({ revokeOwner: async () => { events.push('linked'); await barrier; } }),
		ownership: {
			revoke(value) {
				events.push(`revoke:${String(value === webContents)}`);
				return owner;
			},
		},
		projectLibraryIpc: () => ({ revokeOwner: async () => { events.push('projects'); await barrier; } }),
		readCapabilities: { revokeOwner: async () => { events.push('reads'); await barrier; } },
		reportError: (error) => { throw error; },
		revokeCapture: async () => { events.push('capture'); await barrier; },
		saves: { revokeOwner: async () => { events.push('saves'); await barrier; } },
	});

	const first = cleanup.drain(webContents);
	const duplicate = cleanup.drain(webContents);
	assert.equal(first, duplicate);
	assert.equal(events[0], 'revoke:true');
	assert.deepEqual(new Set(events.slice(1)), new Set(['capture', 'linked', 'projects', 'reads', 'saves']));
	release();
	assert.equal(await first, true);
});
