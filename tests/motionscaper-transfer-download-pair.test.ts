/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferArchiveSaver } from '../src/common/transfer/transfer-download-saver.ts';

function fixture(failure?: Error) {
	const clicked: { name: string; url: string }[] = [], revoked: string[] = [], blobs = new Map<string, Blob>();
	const timers = new Map<number, { callback: () => void; delay: number }>(); let next = 0, peak = 0;
	const channels: { port1: { onmessage: (() => void) | null; close(): void }; port2: { postMessage(): void; close(): void }; closed: number }[] = [];
	const scope = {
		URL: { createObjectURL(blob: Blob) { const url = `blob:${++next}`; blobs.set(url, blob); peak = Math.max(peak, blobs.size); return url; }, revokeObjectURL(url: string) { revoked.push(url); blobs.delete(url); } },
		setTimeout(callback: () => void, delay: number) { const id = ++next; timers.set(id, { callback, delay }); return id; },
		clearTimeout(id: number) { timers.delete(id); },
		document: { body: { append() {} }, createElement() { return { href: '', download: '', rel: '', click() { clicked.push({ name: this.download, url: this.href }); }, remove() {} }; } },
	} as unknown as Window & typeof globalThis;
	const createChannel = () => {
		const channel = { closed: 0, port1: { onmessage: null as (() => void) | null, close() { channel.closed++; } },
			port2: { postMessage() { if (failure) throw failure; }, close() { channel.closed++; } } };
		channels.push(channel); return channel as unknown as MessageChannel;
	};
	return { saver: createTransferArchiveSaver(scope, createChannel), clicked, revoked, blobs, timers, channels, peak: () => peak,
		runTimer(delay: number) { const row = [...timers].find(([, value]) => value.delay === delay); assert.ok(row); timers.delete(row[0]); row[1].callback(); } };
}

test('Motion editable-copy archive and report clicks cross a real task with exact bytes retained', async () => {
	const f = fixture(); const archive = Uint8Array.of(1, 2, 3), report = Uint8Array.of(4, 5);
	await f.saver.saveArchive(archive, 'Project.fscape', 'application/zip');
	let completed = false;
	const pending = Promise.resolve(f.saver.saveCompanion(report, 'Project.fscape.conversion-report.json', 'application/json')).then(() => { completed = true; });
	await Promise.resolve();
	assert.equal(completed, false); assert.deepEqual(f.clicked.map(value => value.name), ['Project.fscape']);
	assert.equal(f.channels.length, 1); assert.equal(f.revoked.length, 0);
	f.channels[0]!.port1.onmessage!(); await pending;
	assert.equal(f.channels[0]!.closed, 2);
	assert.deepEqual(f.clicked.map(value => value.name), ['Project.fscape', 'Project.fscape.conversion-report.json']);
	for (const [index, click] of f.clicked.entries()) assert.deepEqual(new Uint8Array(await f.blobs.get(click.url)!.arrayBuffer()), [archive, report][index]);
	assert.equal(f.peak(), 2); assert.deepEqual([...f.timers.values()].map(value => value.delay), [60000]);
	f.runTimer(60000); assert.equal(f.blobs.size, 0);
});

test('Motion download task failure closes both ports and preserves the original failure and archive backstop', async () => {
	const error = new Error('native MessagePort refused post'), f = fixture(error);
	await f.saver.saveArchive(Uint8Array.of(1), 'Project.fscape', 'application/zip');
	await assert.rejects(Promise.resolve(f.saver.saveCompanion(Uint8Array.of(2), 'report.json', 'application/json')), value => value === error);
	assert.equal(f.channels[0]!.closed, 2); assert.equal(f.clicked.length, 1); assert.equal(f.blobs.size, 1);
	f.runTimer(60000); assert.equal(f.blobs.size, 0);
});

test('Motion download next archive releases the prior pair before retaining another body', async () => {
	const f = fixture(); await f.saver.saveArchive(Uint8Array.of(1), 'One.fscape', 'application/zip');
	const report = Promise.resolve(f.saver.saveCompanion(Uint8Array.of(2), 'One.report.json', 'application/json'));
	f.channels[0]?.port1.onmessage?.(); await report;
	const next = f.saver.saveArchive(Uint8Array.of(3), 'Two.fscape', 'application/zip');
	assert.equal(f.blobs.size, 2); f.runTimer(0); await next;
	assert.equal(f.peak(), 2); assert.equal(f.revoked.length, 2); assert.equal(f.blobs.size, 1);
	f.runTimer(60000); assert.equal(f.blobs.size, 0);
});
