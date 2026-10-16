/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);

test('professional native self-test authorities retain Git blob bytes on Windows', async () => {
	const attributes = await readFile(resolve(ROOT, '.gitattributes'), 'utf8');
	const rules = new Set(attributes.split(/\r?\n/u));
	for (const path of [
		'/scripts/self-test-soundscaper-professional-native-runtime.mjs',
		'/scripts/lib/soundscaper-ara-native-canary.mjs',
		'/scripts/self-test-soundscaper-delivery-fs.mjs',
		'/scripts/lib/soundscaper-professional-packaged-app-authority.mjs',
		'/scripts/lib/soundscaper-native-test-runtime.mjs',
		'/scripts/lib/soundscaper-professional-native-containment-probes.mjs',
		'/desktop/soundscaper-professional-linux-system-libraries.ts',
		'/desktop/soundscaper-professional-linux-system-runtime.ts',
	]) {
		assert(rules.has(`${path} text eol=lf`),
			`${path} must be pinned to LF for byte-for-byte Git authentication`);
	}
});

test('the ARA canary retains its authenticated bytes with Windows checkout conversion', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-authority-checkout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = 'scripts/lib/soundscaper-ara-native-canary.mjs';
	const bytes = await readFile(resolve(ROOT, path));
	await mkdir(join(root, 'scripts/lib'), { recursive: true });
	await writeFile(join(root, path), bytes);
	await writeFile(join(root, '.gitattributes'), await readFile(resolve(ROOT, '.gitattributes')));
	await execute('git', ['init', '-q'], { cwd: root });
	await execute('git', ['config', 'core.autocrlf', 'true'], { cwd: root });
	await execute('git', ['add', '.'], { cwd: root });
	await execute('git', ['-c', 'user.name=Soundscaper Tests',
		'-c', 'user.email=test@soundscaper.invalid', 'commit', '-qm', 'checkout fixture'], { cwd: root });
	await rm(join(root, path));
	await execute('git', ['checkout', '--', path], { cwd: root });
	assert.deepEqual(await readFile(join(root, path)), bytes);
});
