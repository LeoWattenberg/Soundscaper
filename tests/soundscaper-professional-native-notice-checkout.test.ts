/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import noticeRegister from '../config/soundscaper-professional-native-notices.json' with { type: 'json' };

const ROOT = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);

test('Windows checkout retains the authenticated repository professional notices', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-notice-checkout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const notices = noticeRegister.sources.flatMap(({ notices }) =>
		notices.filter(({ origin }) => origin === 'repository'));
	assert.deepEqual(notices.map(({ path }) => path).sort(), ['LICENSE', 'LICENSES/GPL-3.0.txt']);
	await copyFile(join(ROOT, '.gitattributes'), join(root, '.gitattributes'));
	for (const notice of notices) {
		await mkdir(dirname(join(root, notice.path)), { recursive: true });
		await copyFile(join(ROOT, notice.path), join(root, notice.path));
	}
	const git = async (args: string[]) => execute('git', [
		'-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', '-c', 'core.attributesFile=', ...args,
	], { cwd: root, windowsHide: true });
	await git(['init', '--quiet']);
	await git(['add', '--', '.gitattributes', ...notices.map(({ path }) => path)]);
	for (const notice of notices) await rm(join(root, notice.path));
	await git(['checkout-index', '--force', '--', ...notices.map(({ path }) => path)]);
	for (const notice of notices) {
		const bytes = await readFile(join(root, notice.path));
		assert.equal(bytes.byteLength, notice.byteLength, notice.path);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.sha256, notice.path);
	}
});
