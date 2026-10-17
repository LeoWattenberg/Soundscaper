/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMotionSavedFileIpc } from '../desktop/motion-saved-file-ipc.ts';
import { createMotionSavedFilePreload } from '../desktop/motion-saved-file-preload.ts';
import { createTrustedDesktopIpc } from '../desktop/main-trusted-ipc.ts';
import { MOTION_SAVED_FILE_CHANNELS } from '../src/common/editor/motion-saved-file-contract.ts';
type Listener = (event: unknown, ...args: unknown[]) => unknown;
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-watch-ipc-')), path = join(directory, 'Selected.mscape'); await writeFile(path, 'retained');
	const handlers = new Map<string, Listener>(), mainFrame = { url: 'framescaper-successor-app://bundle/' }, webContents = { mainFrame }, owner = {}, otherOwner = {};
	const event = { sender: webContents, senderFrame: mainFrame, owner }; let current = true, dialogs = 0;
	const { handle } = createTrustedDesktopIpc({ ipcMain: { handle(channel, listener) { handlers.set(channel, listener); }, on() {} }, windowFor: () => ({ webContents }), assertDocumentUrl(url) { if (url !== 'framescaper-successor-app://bundle/') throw new Error('Foreign document.'); } });
	const options = { productId: 'framescaper', framescaperLine: 'successor', handle, removeHandler: (channel: string) => { handlers.delete(channel); }, ownerFor: (value: unknown) => (value as typeof event).owner,
		isOwnerCurrent: (value: object) => current && (value === owner || value === otherOwner), chooseFile: async () => { dialogs++; return path; } };
	const service = registerMotionSavedFileIpc(options);
	const invoke = (channel: string, value: unknown, sender = event) => Promise.resolve().then(() => { const handler = handlers.get(channel); if (!handler) throw new Error('Unknown IPC channel.'); return handler(sender, value); });
	const bridge = createMotionSavedFilePreload({ invoke });
	return { options, service, bridge, handlers, invoke, event, otherOwner, dialogs: () => dialogs, expire: () => { current = false; }, dispose: async () => { await service.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
test('saved-file IPC admits only successor profile and trusted current renderer, without native paths', async () => {
	const f = await fixture(); try {
		assert.throws(() => registerMotionSavedFileIpc({ ...f.options, productId: 'soundscaper' }), /successor/iu);
		assert.throws(() => registerMotionSavedFileIpc({ ...f.options, framescaperLine: 'baseline' }), /successor/iu);
		await assert.rejects(f.invoke(MOTION_SAVED_FILE_CHANNELS.select, {}, { ...f.event, senderFrame: { url: 'https://foreign.invalid/' } }), /main document/iu);
		f.event.senderFrame.url = 'https://foreign.invalid/'; await assert.rejects(f.bridge.select(), /foreign/iu); f.event.senderFrame.url = 'framescaper-successor-app://bundle/';
		assert.equal(f.dialogs(), 0); const selected = await f.bridge.select(); assert.ok(selected); assert.deepEqual(Object.keys(selected).sort(), ['name', 'watchId']);
		const discovery = await f.bridge.poll({ watchId: selected.watchId, afterGeneration: 0 }); assert.equal(discovery.state, 'snapshot'); if (discovery.state !== 'snapshot') throw new Error('Expected snapshot.');
		assert.equal(Buffer.from(await f.bridge.read({ token: discovery.snapshot.token, offset: 0, length: 8 })).toString(), 'retained');
		await assert.rejects(f.invoke(MOTION_SAVED_FILE_CHANNELS.read, { token: discovery.snapshot.token, offset: 0, length: 8 }, { ...f.event, owner: f.otherOwner }), /owner|unknown/iu);
		await f.bridge.release({ token: discovery.snapshot.token }); await f.bridge.cancel({ watchId: selected.watchId });
		f.expire(); await assert.rejects(f.bridge.select(), /owner/iu);
	} finally { await f.dispose(); }
});
test('saved-file IPC closes renderer capabilities on revocation and removes channels on disposal', async () => {
	const f = await fixture(); try {
		const selected = (await f.bridge.select())!, discovery = await f.bridge.poll({ watchId: selected.watchId, afterGeneration: 0 }); assert.equal(discovery.state, 'snapshot');
		await f.service.revokeOwner(f.event.owner); await assert.rejects(f.bridge.poll({ watchId: selected.watchId, afterGeneration: 0 }), /owner|unknown/iu);
		await f.service.dispose(); assert.equal(f.handlers.size, 0); await assert.rejects(f.bridge.select(), /channel/iu);
	} finally { await f.dispose(); }
});
test('saved-file IPC refuses injected fields, accessor requests and oversized transfer responses', async () => {
	const f = await fixture(); try {
		await assert.rejects(f.invoke(MOTION_SAVED_FILE_CHANNELS.select, { path: '/private.mscape' }), /fields/iu); assert.equal(f.dialogs(), 0);
		let invoked = false; const request = { get watchId() { invoked = true; return 'id'; }, afterGeneration: 0 };
		await assert.rejects(f.invoke(MOTION_SAVED_FILE_CHANNELS.poll, request), /data fields/iu); assert.equal(invoked, false);
		const bad = createMotionSavedFilePreload({ invoke: () => Promise.resolve(new Uint8Array(5)) });
		await assert.rejects(bad.read({ token: 'token', offset: 0, length: 4 }), /response|length/iu);
		await assert.rejects(bad.read({ token: 'token', offset: 0, length: 4 * 1024 * 1024 + 1 }), /admission/iu);
	} finally { await f.dispose(); }
});
