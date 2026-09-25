/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { SesxMediaSessionStore, normalizeSesxRelativePath } from '../desktop/sesx-media-session.mjs';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

const SESSION_ID = 'a'.repeat(64);
const OTHER_SESSION_ID = 'b'.repeat(64);

async function fixture(context, { maxScanEntries } = {}) {
	const temporary = await mkdtemp(join(tmpdir(), 'sesx-media-'));
	context.after(async () => { const { rm } = await import('node:fs/promises'); await rm(temporary, { recursive: true, force: true }); });
	const sessionFolder = join(temporary, 'session');
	const selectedFolder = join(temporary, 'selected');
	await mkdir(sessionFolder);
	await mkdir(selectedFolder);
	const sessionPath = join(sessionFolder, 'song.sesx');
	await writeFile(sessionPath, '<session/>');
	const owner = {};
	const granted = [];
	let folderChoice = selectedFolder;
	const store = new SesxMediaSessionStore({
		readCapabilities: {
			async resolveHelperGrant(id, options) {
				assert.equal(id, SESSION_ID);
				assert.equal(options.owner, owner);
				const details = await stat(sessionPath);
				return { path: sessionPath, size: details.size, identity: { dev: details.dev, ino: details.ino } };
			},
			async registerSelectedAudioRangePath(filePath, options) {
				granted.push({ filePath, options });
				return { id: 'c'.repeat(64), name: basename(filePath), readProfile: 'linked-audio-range-v1' };
			},
		},
		dialog: { async showOpenDialog() { return folderChoice === null
			? { canceled: true, filePaths: [] }
			: { canceled: false, filePaths: [folderChoice] }; } },
		windowFor: () => null,
		...(maxScanEntries === undefined ? {} : { maxScanEntries }),
	});
	await store.registerSelection(SESSION_ID, sessionPath, { owner });
	return { temporary, sessionFolder, selectedFolder, store, owner, granted, chooseFolder: (path) => { folderChoice = path; } };
}

test('SESX direct relative media resolves inside the selected session folder', async (context) => {
	const { sessionFolder, store, owner, granted } = await fixture(context);
	await mkdir(join(sessionFolder, 'Audio Files'));
	await writeFile(join(sessionFolder, 'Audio Files', 'take.wav'), 'media');
	const result = await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'Audio Files\\take.wav', owner });
	assert.equal(result.status, 'found');
	assert.equal(result.descriptor.name, 'take.wav');
	assert.equal(granted.length, 1);
	assert.equal(granted[0].filePath, join(sessionFolder, 'Audio Files', 'take.wav'));
	assert.equal(granted[0].options.owner, owner);
	assert.equal(granted[0].options.expectedIdentity.size, 5);
});

test('SESX folder grant finds exact-relative media before unique basename and reports duplicates', async (context) => {
	const { selectedFolder, store, owner, granted } = await fixture(context);
	await mkdir(join(selectedFolder, 'Audio Files'));
	await mkdir(join(selectedFolder, 'other'));
	await writeFile(join(selectedFolder, 'Audio Files', 'take.wav'), 'exact');
	await writeFile(join(selectedFolder, 'other', 'take.wav'), 'duplicate');
	const selected = await store.chooseFolder({ sessionReadId: SESSION_ID, owner });
	assert.equal(selected.status, 'selected');
	assert.match(selected.mediaRootId, /^[a-f0-9]{48}$/u);
	const exact = await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'Audio Files/take.wav', mediaRootId: selected.mediaRootId, owner });
	assert.equal(exact.status, 'found');
	assert.equal(granted[0].filePath, join(selectedFolder, 'Audio Files', 'take.wav'));
	const duplicate = await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'take.wav', mediaRootId: selected.mediaRootId, owner });
	assert.deepEqual(duplicate, { status: 'ambiguous' });
});

test('SESX folder picker cancellation and session retirement do not keep authority', async (context) => {
	const { store, owner, chooseFolder } = await fixture(context);
	chooseFolder(null);
	assert.deepEqual(await store.chooseFolder({ sessionReadId: SESSION_ID, owner }), { status: 'cancelled' });
	assert.equal(store.release(SESSION_ID, { owner }), true);
	await assert.rejects(() => store.resolve({ sessionReadId: SESSION_ID, relativePath: 'take.wav', owner }), /session/i);
});

test('SESX path and owner checks reject absolute, traversal, symlink, and cross-owner access', async (context) => {
	const { temporary, sessionFolder, store, owner } = await fixture(context);
	for (const path of ['../secret.wav', '/tmp/secret.wav', 'C:\\secret.wav', '\\\\server\\share.wav', 'file:///secret.wav', 'dir/../../secret.wav']) {
		assert.throws(() => normalizeSesxRelativePath(path), /relative|path/i);
	}
	await assert.rejects(() => store.resolve({ sessionReadId: SESSION_ID, relativePath: 'take.wav', owner: {} }), /session/i);
	await writeFile(join(temporary, 'secret.wav'), 'secret');
	await symlink(join(temporary, 'secret.wav'), join(sessionFolder, 'secret.wav'));
	assert.deepEqual(await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'secret.wav', owner }), { status: 'missing' });
	assert.deepEqual(await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'missing.wav', owner }), { status: 'missing' });
});

test('SESX selected-folder scan has a bounded entry budget and owner revocation', async (context) => {
	const { selectedFolder, store, owner } = await fixture(context, { maxScanEntries: 2 });
	await mkdir(join(selectedFolder, 'a'));
	await mkdir(join(selectedFolder, 'b'));
	await writeFile(join(selectedFolder, 'a', 'unrelated.wav'), 'a');
	const selected = await store.chooseFolder({ sessionReadId: SESSION_ID, owner });
	assert.deepEqual(await store.resolve({ sessionReadId: SESSION_ID, relativePath: 'unfound.wav', mediaRootId: selected.mediaRootId, owner }), { status: 'scan-limited' });
	store.revokeOwner(owner);
	await assert.rejects(() => store.resolve({ sessionReadId: SESSION_ID, relativePath: 'unfound.wav', owner }), /session/i);
});

test('SESX session selection admits only SESX paths', async (context) => {
	const { sessionFolder, store, owner } = await fixture(context);
	await assert.rejects(() => store.registerSelection(OTHER_SESSION_ID, join(sessionFolder, 'song.scape'), { owner }), /SESX/i);
});

test('SESX media root rejects a symlink rebound after the session was selected', async (context) => {
	const { temporary, sessionFolder, selectedFolder, store, owner } = await fixture(context);
	await writeFile(join(selectedFolder, 'take.wav'), 'unselected');
	await rename(sessionFolder, join(temporary, 'moved-session'));
	await symlink(selectedFolder, sessionFolder, 'dir');
	await assert.rejects(() => store.resolve({ sessionReadId: SESSION_ID, relativePath: 'take.wav', owner }), /root.*changed/i);
});

test('SESX media root rejects a different directory at the selected path', async (context) => {
	const { temporary, sessionFolder, store, owner } = await fixture(context);
	await rename(sessionFolder, join(temporary, 'moved-session'));
	await mkdir(sessionFolder);
	await writeFile(join(sessionFolder, 'take.wav'), 'unselected');
	await assert.rejects(() => store.resolve({ sessionReadId: SESSION_ID, relativePath: 'take.wav', owner }), /root.*changed/i);
});

test('SESX chosen media folder rejects replacement before a basename scan', async (context) => {
	const { temporary, selectedFolder, store, owner } = await fixture(context);
	const chosen = await store.chooseFolder({ sessionReadId: SESSION_ID, owner });
	await rename(selectedFolder, join(temporary, 'moved-selected'));
	await mkdir(selectedFolder);
	await writeFile(join(selectedFolder, 'take.wav'), 'unselected');
	await assert.rejects(() => store.resolve({
		sessionReadId: SESSION_ID, relativePath: 'take.wav', mediaRootId: chosen.mediaRootId, owner,
	}), /root.*changed/i);
});

test('SESX audio range admission rejects a file replaced after identity inspection', async (context) => {
	const { sessionFolder, owner } = await fixture(context);
	const path = join(sessionFolder, 'take.wav');
	await writeFile(path, 'initial');
	const details = await stat(path);
	const readCapabilities = new ReadCapabilityStore();
	context.after(async () => readCapabilities.dispose());
	await assert.rejects(() => readCapabilities.registerSelectedAudioRangePath(path, {
		owner,
		expectedIdentity: {
			dev: details.dev, ino: details.ino, size: details.size + 1,
			mtimeMs: details.mtimeMs, ctimeMs: details.ctimeMs,
		},
	}), /changed/i);
});
