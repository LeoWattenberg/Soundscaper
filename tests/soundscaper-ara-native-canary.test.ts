/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runInstalledAraNativeCanary } from '../scripts/lib/soundscaper-ara-native-canary.mjs';

const RESULT = JSON.stringify({ status: 'passed', canary: 'ara-vst3-document-round-trip',
	randomAccess: true, archiveRoundTrip: true });

test('installed ARA canary binds the real executable and complete VST3 bundle', async (context) => {
	const root = await fixture(context);
	const commands: { command: string; args: string[] }[] = [];
	const evidence = await runInstalledAraNativeCanary({ professionalInstallRoot: root, target: 'linux-x64' }, {
		run: (command: string, args: string[]) => {
			commands.push({ command, args });
			return { status: 0, stdout: RESULT, stderr: '' };
		},
	});
	assert.deepEqual(commands, [{ command: join(root, 'self-test/soundscaper_ara_host_self_test'),
		args: [join(root, 'self-test/SoundscaperARAFixture.vst3')] }]);
	assert.equal(evidence.randomAccess, true);
	assert.equal(evidence.archiveRoundTrip, true);
	assert.match(evidence.executableSha256, /^[a-f\d]{64}$/u);
	assert.match(evidence.fixtureSha256, /^[a-f\d]{64}$/u);
	assert.equal(evidence.fixtureFileCount, 1);
});

test('installed ARA canary refuses false success evidence and symbolic fixture bytes', async (context) => {
	const root = await fixture(context);
	for (const stdout of ['{}', RESULT.replace('"randomAccess":true', '"randomAccess":false')]) {
		await assert.rejects(runInstalledAraNativeCanary({ professionalInstallRoot: root, target: 'linux-x64' }, {
			run: () => ({ status: 0, stdout, stderr: '' }),
		}), /evidence/iu);
	}
	await symlink(join(root, 'self-test/soundscaper_ara_host_self_test'),
		join(root, 'self-test/SoundscaperARAFixture.vst3/foreign'));
	await assert.rejects(runInstalledAraNativeCanary({ professionalInstallRoot: root, target: 'linux-x64' }, {
		run: () => ({ status: 0, stdout: RESULT, stderr: '' }),
	}), /symbolic/iu);
});

async function fixture(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ara-canary-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'self-test/SoundscaperARAFixture.vst3/Contents/x86_64-linux'), { recursive: true });
	await writeFile(join(root, 'self-test/soundscaper_ara_host_self_test'), 'native host canary');
	await writeFile(join(root, 'self-test/SoundscaperARAFixture.vst3/Contents/x86_64-linux/fixture.so'), 'native fixture');
	return root;
}
