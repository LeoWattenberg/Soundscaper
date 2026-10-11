/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperNativeCompositionConnection } from '../src/common/editor/ui/framescaper-composition-native-connection.ts';
import type { MotionSavedFileCapabilities } from '../src/common/editor/motion-saved-file-contract.ts';

function fixture() {
	let project = { id: 'owner' }, cancelFails = true, cancels = 0;
	const listeners = new Set<() => void>();
	const controller = { get project() { return project; }, getSnapshot: () => ({ readOnly: false }), subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
	const files: MotionSavedFileCapabilities = {
		select: () => Promise.resolve({ watchId: 'watch', name: 'Selected.mscape' }),
		poll: () => Promise.resolve({ state: 'unchanged', generation: 0 }),
		read: () => Promise.reject(new Error('Unexpected read')), release: () => Promise.resolve(),
		cancel: () => { cancels++; return cancelFails ? Promise.reject(new Error('Native cleanup failed')) : Promise.resolve(); },
	};
	const context = { links: { receive: () => Promise.resolve() } };
	return { controller, context, files, cancels: () => cancels, allowCleanup() { cancelFails = false; }, switchProject() { project = { id: 'another-owner' }; for (const listener of listeners) listener(); } };
}
test('native link disposal keeps failed cleanup observable until a successful retry', async () => {
	const f = fixture(), connection = createFramescaperNativeCompositionConnection(f.controller, f.context, f.files);
	let notifications = 0; connection.subscribe(() => { notifications++; }); await connection.connect();
	await assert.rejects(connection.dispose(), /Native cleanup failed/u); assert.equal(connection.snapshot().status, 'error');
	const beforeRetry = notifications; f.allowCleanup(); await connection.dispose();
	assert.equal(connection.snapshot().status, 'disconnected'); assert.ok(notifications > beforeRetry); assert.equal(f.cancels(), 2);
});
test('native project-switch cleanup failure stays reviewable and Disconnect can retry it', async () => {
	const f = fixture(), connection = createFramescaperNativeCompositionConnection(f.controller, f.context, f.files);
	await connection.connect(); f.switchProject();
	await new Promise<void>(resolve => setTimeout(resolve, 0)); assert.equal(connection.snapshot().status, 'error');
	await assert.rejects(connection.connect(), /Disconnect/u); f.allowCleanup(); await connection.disconnect();
	assert.equal(connection.snapshot().status, 'disconnected'); assert.equal(f.cancels(), 2); await connection.dispose();
});
