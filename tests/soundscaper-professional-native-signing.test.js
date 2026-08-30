/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperProfessionalNativeMacSigningPlan,
	executeSoundscaperProfessionalNativeMacSigningPlan,
} from '../scripts/lib/soundscaper-professional-native-macos-signing.mjs';

test('mac candidate signing covers runtime dependencies before every consumer and verifies each', async (context) => {
	const fixture = await signingFixture(context);
	const plan = await createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: '-',
	});
	assert.deepEqual(plan.signing, {
		mode: 'ad-hoc', identitySha256: '3973e022e93220f9212c18d0d0c543ae7c309e46640da93a4a0314de999f5112',
	});
	assert.deepEqual(plan.artifacts.map(({ candidatePath }) => candidatePath), [
		'payload/runtime/libalpha.dylib',
		'payload/runtime/nested/libbeta.dylib',
		'payload/soundscaper_professional.node',
		'payload/soundscaper_os_audio_codec.node',
		'payload/soundscaper_professional_peer',
		'payload/soundscaper_delivery_fs',
		'payload/milestone5-native-isolation-launcher',
	]);
	const calls = [];
	const evidence = await executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
		run(command, argv) {
			calls.push({ command, argv });
			return { status: 0, signal: null, stdout: `${argv[0]} passed`, stderr: '' };
		},
	});
	assert.equal(calls.length, plan.artifacts.length * 2);
	for (let index = 0; index < plan.artifacts.length; index += 1) {
		assert.deepEqual(calls[index * 2], {
			command: 'codesign',
			argv: ['--force', '--sign', '-', plan.artifacts[index].absolutePath],
		});
		assert.deepEqual(calls[index * 2 + 1], {
			command: 'codesign',
			argv: ['--verify', '--strict', '--verbose=2', plan.artifacts[index].absolutePath],
		});
	}
	assert.equal(evidence.status, 'signatures-verified');
	assert.deepEqual(evidence.artifacts.map(({ path }) => path),
		plan.artifacts.map(({ candidatePath }) => candidatePath));
	assert(evidence.artifacts.every(({ signOutputSha256, verificationOutputSha256 }) =>
		/^[a-f\d]{64}$/u.test(signOutputSha256) && /^[a-f\d]{64}$/u.test(verificationOutputSha256)));
});

test('production mac candidate signing uses hardened runtime and a timestamp without leaking identity', async (context) => {
	const fixture = await signingFixture(context);
	const identity = 'Developer ID Application: Soundscaper Release (ABC1234567)';
	const plan = await createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: identity,
	});
	assert.equal(plan.signing.mode, 'developer-id');
	assert.equal(JSON.stringify(plan).includes(identity), false);
	const calls = [];
	await executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
		run(command, argv) {
			calls.push({ command, argv });
			return { status: 0, signal: null, stdout: '', stderr: '' };
		},
	});
	assert.deepEqual(calls[0].argv.slice(0, -1), [
		'--force', '--timestamp', '--options', 'runtime', '--sign', identity,
	]);
	assert.throws(() => createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: 'not-a-developer-id',
	}), /Developer ID Application|signing identity/iu);
});

test('mac candidate signing refuses failed verification', async (context) => {
	const fixture = await signingFixture(context);
	const plan = await createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: '-',
	});
	let calls = 0;
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
		run() {
			calls += 1;
			return { status: calls === 2 ? 1 : 0, signal: null, stdout: '', stderr: 'invalid' };
		},
	}), /signature verification failed/iu);
});

async function signingFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-signing-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const professionalInstallRoot = join(root, 'professional');
	const isolationInstallRoot = join(root, 'isolation');
	const osAudioCodecInstallRoot = join(root, 'codec');
	const runtimeRoot = join(root, 'runtime');
	for (const path of [
		join(runtimeRoot, 'nested/libbeta.dylib'),
		join(runtimeRoot, 'libalpha.dylib'),
		join(professionalInstallRoot, 'soundscaper_professional.node'),
		join(osAudioCodecInstallRoot, 'soundscaper_os_audio_codec.node'),
		join(professionalInstallRoot, 'soundscaper_professional_peer'),
		join(professionalInstallRoot, 'soundscaper_delivery_fs'),
		join(isolationInstallRoot, 'bin/milestone5-native-isolation-launcher'),
	]) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `mach-o:${path}`);
	}
	return { professionalInstallRoot, isolationInstallRoot, osAudioCodecInstallRoot, runtimeRoot };
}
