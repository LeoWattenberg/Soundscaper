/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { createDesktopSaveSizeWarningConfirmation, type DesktopSaveSizeWarning } from '../desktop/save-size-warning-dialog.ts';

type ManagerOptions = ConstructorParameters<typeof AtomicSaveManager>[0];

test('the native size decision defaults to Cancel and accepts only Continue', async () => {
	for (const response of [0, 1, 2]) {
		const confirm = createDesktopSaveSizeWarningConfirmation(async (options) => {
			assert.deepEqual(options.buttons, ['Cancel', 'Continue']);
			assert.equal(options.defaultId, 0);
			assert.equal(options.cancelId, 0);
			assert.match(options.message, /export.wav/u);
			return { response };
		});
		assert.equal(await confirm({ fileName: 'export.wav', byteLength: 12, thresholdBytes: 10 }), response === 1);
	}
});

test('native save-size approval admits one scoped destination and preserves aggregate and exact-byte checks', async () => {
	const owner = {};
	const targets = new SaveTargetStore();
	const warnings: DesktopSaveSizeWarning[] = [];
	const manager = new AtomicSaveManager({
		targets, maximumSaveBytes: 10, maximumAdmittedBytes: 10,
		confirmFileSizeWarning: async (warning: DesktopSaveSizeWarning) => { warnings.push(warning); return true; },
		statfsImpl: async () => ({ bavail: 100n, bsize: 1n }),
		openImpl: async () => ({ write: async (bytes: Uint8Array) => ({ bytesWritten: bytes.byteLength }), close: async () => undefined }),
		unlinkImpl: async () => undefined,
	} as unknown as ManagerOptions);
	try {
		const target = targets.registerPath('/tmp/approved.wav', { owner, purpose: 'audio-pcm-mix' });
		const session = await manager.begin({ targetId: target.id, owner, size: 12 });
		assert.deepEqual(warnings, [{ fileName: 'approved.wav', byteLength: 12, thresholdBytes: 10 }]);
		const other = targets.registerPath('/tmp/other.wav', { owner, purpose: 'audio-pcm-mix' });
		await assert.rejects(manager.begin({ targetId: other.id, owner, size: 1 }), /Aggregate/iu);
		await manager.writeChunk({ owner, writeId: session.writeId, offset: 0, bytes: new Uint8Array(12) });
		await assert.rejects(manager.writeChunk({ owner, writeId: session.writeId, offset: 12, bytes: Uint8Array.of(1) }), /size|maximum/iu);
		await manager.abort(session.writeId, { owner });
		const next = await manager.begin({ targetId: other.id, owner, size: 1 });
		await manager.abort(next.writeId, { owner });
	} finally { await manager.dispose(); targets.dispose(); }
});

test('canceled and revoked save-size decisions create no staged file and cannot reuse the target', async () => {
	for (const mode of ['cancel', 'revoke'] as const) {
		const owner = {};
		const targets = new SaveTargetStore();
		let opened = false;
		let revoke: Promise<unknown> | undefined;
		const manager: AtomicSaveManager = new AtomicSaveManager({
			targets, maximumSaveBytes: 10, maximumAdmittedBytes: 10,
			confirmFileSizeWarning: async () => {
				if (mode === 'revoke') revoke = manager.revokeOwner(owner);
				return mode !== 'cancel';
			},
			openImpl: async () => { opened = true; throw new Error('must not open'); },
		} as unknown as ManagerOptions);
		try {
			const target = targets.registerPath('/tmp/canceled.wav', { owner, purpose: 'audio-pcm-mix' });
			await assert.rejects(manager.begin({ targetId: target.id, owner, size: 12 }), mode === 'cancel' ? { name: 'AbortError' } : /revoked/u);
			await revoke;
			assert.equal(opened, false);
			await assert.rejects(manager.begin({ targetId: target.id, owner, size: 1 }), /expired|used|revoked/u);
		} finally { await manager.dispose(); targets.dispose(); }
	}
});
