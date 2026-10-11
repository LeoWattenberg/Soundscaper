/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createMotionscaperLaunchAuthority, motionLaunchPaths } from '../desktop/motionscaper-launch-authority.ts';
import { dispatchMotionscaperLaunchCall } from '../desktop/motionscaper-launch-ipc.ts';
import { takeMotionscaperDesktopLaunch } from '../src/motionscaper/desktop-launch-adapter.ts';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-launch-'));
	const first = join(root, 'first.mscape'), second = join(root, 'second.mscape');
	await writeFile(first, 'first archive'); await writeFile(second, 'second archive');
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => null, chooseSave: async () => null });
	let signals = 0;
	const launch = createMotionscaperLaunchAuthority({ open: path => files.openTrustedPath(path), revoke: token => files.revokeRead(token), notify: () => { signals += 1; } });
	return { root, first, second, files, launch, signals: () => signals, close: async () => { await launch.dispose(); await files.dispose(); await rm(root, { recursive: true, force: true }); } };
}

test('Motion native cold and warm launches retain paths in main and review one bounded file at a time', async () => {
	const f = await fixture();
	try {
		assert.deepEqual(motionLaunchPaths(['motion', '--user-data-dir=private.mscape', 'first.mscape', f.second, 'other.fscape'], f.root), [f.first, f.second]);
		f.launch.enqueue(motionLaunchPaths(['first.mscape'], f.root)); f.launch.enqueue([f.first, f.second]);
		const first = await f.launch.take(); assert.ok(first); assert.deepEqual(Object.keys(first).sort(), ['byteLength', 'name', 'token']);
		assert.equal(first.name, 'first.mscape'); assert.equal(await f.launch.take(), null);
		assert.equal(new TextDecoder().decode(await f.files.read({ token: first.token, offset: 0, length: first.byteLength })), 'first archive');
		await f.files.release({ token: first.token }); await f.launch.acknowledge({ token: first.token });
		const second = await f.launch.take(); assert.equal(second?.name, 'second.mscape'); assert.ok(second);
		await assert.rejects(f.launch.acknowledge({ token: first.token }), /active launch/u);
		await f.launch.acknowledge({ token: second.token }); await assert.rejects(f.files.read({ token: second.token, offset: 0, length: 1 }), /capability/u);
		assert.equal(await f.launch.take(), null); assert.ok(f.signals() > 0);
	} finally { await f.close(); }
});

test('Motion native launch admission rejects path injection, links and excessive pending work', async () => {
	const f = await fixture();
	try {
		assert.throws(() => f.launch.enqueue(['relative.mscape']), /absolute/u);
		assert.throws(() => f.launch.enqueue([join(f.root, 'other.fscape')]), /mscape/u);
		assert.throws(() => f.launch.enqueue(Array.from({ length: 17 }, (_, i) => join(f.root, `${i}.mscape`))), /pending/u);
		assert.equal(await f.launch.take(), null);
		const linked = join(f.root, 'link.mscape'); await symlink(f.first, linked);
		f.launch.enqueue([linked, f.second]); await assert.rejects(f.launch.take(), /regular file/u);
		const second = await f.launch.take(); assert.equal(second?.name, 'second.mscape');
	} finally { await f.close(); }
});

test('Motion renderer reset revokes stale reads and reissues the queued launch exactly once', async () => {
	const f = await fixture();
	try {
		f.launch.enqueue([f.first]); const old = await f.launch.take(); assert.ok(old);
		await f.launch.reset(); await f.launch.reset();
		await assert.rejects(f.files.read({ token: old.token, offset: 0, length: 1 }), /capability/u);
		const current = await f.launch.take(); assert.ok(current); assert.notEqual(current.token, old.token);
		await f.launch.acknowledge({ token: current.token }); assert.equal(await f.launch.take(), null);
	} finally { await f.close(); }
});

test('Motion launch reset during native open cannot publish a stale capability or duplicate its queue entry', async () => {
	const f = await fixture(); let resume: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { resume = resolve; }); let token = '';
	const launch = createMotionscaperLaunchAuthority({ open: async path => {
		const result = await f.files.openTrustedPath(path); token = result.token; await gate; return result;
	}, revoke: value => f.files.revokeRead(value), notify: () => undefined });
	try {
		launch.enqueue([f.first]); const opening = launch.take(); await launch.reset(); await launch.reset(); resume();
		assert.equal(await opening, null);
		await assert.rejects(f.files.read({ token, offset: 0, length: 1 }), /capability/u);
		const next = await launch.take(); assert.ok(next); await launch.acknowledge({ token: next.token });
		assert.equal(await launch.take(), null);
	} finally { resume(); await launch.dispose(); await f.close(); }
});

test('Motion launch IPC admits only the own top-level origin and closed capability actions', async () => {
	const f = await fixture(); const caller = { ownWindow: true, mainFrame: true, url: 'motionscaper-app://bundle/' };
	try {
		for (const foreign of [{ ...caller, ownWindow: false }, { ...caller, mainFrame: false }, { ...caller, url: 'framescaper-app://bundle/' }]) {
			await assert.rejects(dispatchMotionscaperLaunchCall(f.launch, foreign, 'take', {}), /Untrusted/u);
		}
		await assert.rejects(dispatchMotionscaperLaunchCall(f.launch, caller, 'take', { path: f.first }), /fields/u);
		await assert.rejects(dispatchMotionscaperLaunchCall(f.launch, caller, 'enqueue', { path: f.first }), /method/u);
		assert.equal(await dispatchMotionscaperLaunchCall(f.launch, caller, 'take', {}), null);
		f.launch.enqueue([join(f.root, 'missing.mscape')]);
		await assert.rejects(dispatchMotionscaperLaunchCall(f.launch, caller, 'take', {}), (error: unknown) => {
			assert.ok(error instanceof Error); assert.match(error.message, /could not be opened/u); assert.ok(!error.message.includes(f.root)); return true;
		});
	} finally { await f.close(); }
});

test('Motion native review release acknowledges only after file closure and can retry either boundary', async () => {
	const f = await fixture(); let releaseFailures = 1, acknowledgeFailures = 1, acknowledgements = 0;
	try {
		f.launch.enqueue([f.first, f.second]);
		const launch = { take: () => f.launch.take(), acknowledge: async (request: { token: string }) => {
			acknowledgements += 1; if (acknowledgeFailures-- > 0) throw new Error('acknowledge failed'); await f.launch.acknowledge(request);
		}, onPending: (_listener: () => void) => () => undefined };
		const files = { ...f.files, release: async (request: { token: string }) => { if (releaseFailures-- > 0) throw new Error('release failed'); await f.files.release(request); } };
		const selected = await takeMotionscaperDesktopLaunch(files, launch); assert.ok(selected);
		assert.equal(new TextDecoder().decode(await selected.input.read({ offset: 0, length: selected.input.size })), 'first archive');
		await assert.rejects(selected.release(), /release failed/u); assert.equal(acknowledgements, 0);
		await assert.rejects(selected.release(), /acknowledge failed/u); assert.equal(acknowledgements, 1);
		await selected.release(); await selected.release(); assert.equal(acknowledgements, 2);
		await assert.rejects(selected.input.read({ offset: 0, length: 1 }), /released/u);
		assert.equal((await f.launch.take())?.name, 'second.mscape');
	} finally { await f.close(); }
});
