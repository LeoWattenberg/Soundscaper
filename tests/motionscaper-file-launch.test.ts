/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installMotionscaperFileLaunch, takeMotionscaperShortcut } from '../src/motionscaper/editor-file-launch.ts';
import type { FileHandlerLaunchParams } from '../src/common/offline/file-handler-launch.ts';

test('M01 Motion file launches serialize completed document imports and refuse oversized batches before reading handles', async () => {
	let consumer: ((params: FileHandlerLaunchParams) => void) | undefined; let finish: (() => void) | undefined;
	const opened: string[] = []; const errors: unknown[] = []; let reads = 0;
	const installation = installMotionscaperFileLaunch({ desktop: false, launchQueue: { setConsumer(value) { consumer = value; } },
		onOpen: async file => { opened.push(file.name); if (opened.length === 1) await new Promise<void>(resolve => { finish = resolve; }); }, onError: error => { errors.push(error); } });
	try {
		assert.equal(installation.status, 'consuming'); assert.ok(consumer);
		const handle = (name: string) => ({ kind: 'file', getFile: () => { reads++; return Promise.resolve(new File(['archive'], name)); } });
		consumer({ files: [handle('first.mscape')] }); consumer({ files: [handle('second.fscape')] }); consumer({ files: [handle('third.sscape'), handle('fourth.mscape')] });
		await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(opened, ['first.mscape']); assert.equal(reads, 1); assert.equal(errors.length, 1);
		assert.ok(finish); finish(); await installation.settled(); assert.deepEqual(opened, ['first.mscape', 'second.fscape']); assert.equal(reads, 2);
	} finally { finish?.(); installation.release(); }
});

test('M01 Motion bounds unresolved launch custody and refuses media, directories and failed reads', async () => {
	let consumer: ((params: FileHandlerLaunchParams) => void) | undefined; let finish: (() => void) | undefined;
	const errors: unknown[] = []; const opened: string[] = [];
	const installation = installMotionscaperFileLaunch({ desktop: false, launchQueue: { setConsumer(value) { consumer = value; } },
		onOpen: async file => { opened.push(file.name); if (opened.length === 1) await new Promise<void>(resolve => { finish = resolve; }); }, onError: error => { errors.push(error); } });
	try {
		assert.ok(consumer);
		for (let index = 0; index < 9; index++) consumer({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File(['archive'], `${String(index)}.mscape`)) }] });
		await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(opened.length, 1); assert.equal(errors.length, 1); assert.ok(finish); finish(); await installation.settled(); assert.equal(opened.length, 8);
		consumer({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File(['picture'], 'picture.png')) }] });
		consumer({ files: [{ kind: 'directory', getFile: () => { throw new Error('directory read'); } }] });
		consumer({ files: [{ kind: 'file', getFile: () => Promise.reject(new Error('selected file unavailable')) }] });
		await installation.settled(); assert.equal(opened.length, 8); assert.equal(errors.length, 4);
	} finally { finish?.(); installation.release(); }
});

test('M01 desktop never claims browser launch authority and shortcuts consume only their own query field', () => {
	let claimed = false;
	const installation = installMotionscaperFileLaunch({ desktop: true, launchQueue: { setConsumer() { claimed = true; } }, onOpen: () => undefined, onError: () => undefined });
	assert.equal(installation.status, 'unsupported'); assert.equal(claimed, false); installation.release();
	const url = new URL('https://motionscaper.org/de/?other=keep&launch=new-project#retained');
	assert.equal(takeMotionscaperShortcut(url), 'new'); assert.equal(url.href, 'https://motionscaper.org/de/?other=keep#retained'); assert.equal(takeMotionscaperShortcut(url), null);
	const open = new URL('https://motionscaper.org/en/?launch=open-project'); assert.equal(takeMotionscaperShortcut(open), 'open');
	const unknown = new URL('https://motionscaper.org/en/?launch=unsupported'); assert.equal(takeMotionscaperShortcut(unknown), null); assert.equal(unknown.searchParams.get('launch'), 'unsupported');
});
