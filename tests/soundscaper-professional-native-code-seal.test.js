/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperProfessionalNativeMacCodeSealPlan,
	executeSoundscaperProfessionalNativeMacCodeSealPlan,
	validateSoundscaperProfessionalNativeMacCodeSealResult,
} from '../scripts/lib/soundscaper-professional-native-macos-code-seal.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PEER_ENTITLEMENTS_PATH =
	'native/soundscaper-professional-host/soundscaper-professional-peer-entitlements.mac.plist';
const LIBRARY_VALIDATION_KEY = 'com.apple.security.cs.disable-library-validation';
const PEER_REQUIREMENT = `=entitlement["${LIBRARY_VALIDATION_KEY}"] exists`;
const NON_PEER_REQUIREMENT = `=! entitlement["${LIBRARY_VALIDATION_KEY}"] exists`;

test('mac ad-hoc sealing covers runtime dependencies before every consumer and verifies each', async (context) => {
	const fixture = await codeSealFixture(context);
	const plan = await createSoundscaperProfessionalNativeMacCodeSealPlan({
		...fixture, target: 'mac-arm64',
	});
	assert.equal(plan.schemaVersion, 1);
	assert.equal(plan.method, 'codesign-ad-hoc');
	assert.equal(Object.hasOwn(plan, 'signing'), false);
	assert.deepEqual(plan.artifacts.map(({ candidatePath }) => candidatePath), [
		'payload/runtime/libalpha.dylib',
		'payload/runtime/nested/libbeta.dylib',
		'payload/soundscaper_professional.node',
		'payload/soundscaper_os_audio_codec.node',
		'payload/soundscaper_professional_peer',
		'payload/soundscaper_delivery_fs',
		'payload/milestone5-native-isolation-launcher',
	]);
	const entitlementBytes = await readFile(resolve(ROOT, PEER_ENTITLEMENTS_PATH));
	assert.deepEqual(plan.peerEntitlements.descriptor, {
		path: PEER_ENTITLEMENTS_PATH,
		byteLength: 259,
		sha256: '8387b5ab44a8a8cae94acb84289378e0725cdbee8304961c691d44c199181796',
	});
	assert.equal(entitlementBytes.byteLength, plan.peerEntitlements.descriptor.byteLength);
	assert.equal(createHash('sha256').update(entitlementBytes).digest('hex'),
		plan.peerEntitlements.descriptor.sha256);
	const entitlementText = String(entitlementBytes);
	assert.equal([...entitlementText.matchAll(/<key>/gu)].length, 1);
	assert.match(entitlementText,
		/<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\s*\/>/u);
	assert.deepEqual(plan.artifacts.map(({ entitlements }) => entitlements),
		plan.artifacts.map(({ candidatePath }) => candidatePath === 'payload/soundscaper_professional_peer'
			? plan.peerEntitlements.descriptor : null));
	const calls = [];
	const result = await executeSoundscaperProfessionalNativeMacCodeSealPlan(plan, {
		run(command, argv) {
			calls.push({ command, argv });
			return successfulCodesignResult(argv);
		},
	});
	assert.equal(calls.length, plan.artifacts.length * 3);
	for (let index = 0; index < plan.artifacts.length; index += 1) {
		const artifact = plan.artifacts[index];
		const peer = artifact.candidatePath === 'payload/soundscaper_professional_peer';
		assert.deepEqual(calls[index * 3], {
			command: 'codesign',
			argv: peer
				? ['--force', '--entitlements', plan.peerEntitlements.absolutePath,
					'--sign', '-', artifact.absolutePath]
				: ['--force', '--sign', '-', artifact.absolutePath],
		});
		assert.deepEqual(calls[index * 3 + 1], {
			command: 'codesign',
			argv: ['--verify', '--strict', '--verbose=2', artifact.absolutePath],
		});
		assert.deepEqual(calls[index * 3 + 2], {
			command: 'codesign',
			argv: ['--verify', '--verbose=2', '--test-requirement',
				peer ? PEER_REQUIREMENT : NON_PEER_REQUIREMENT, artifact.absolutePath],
		});
	}
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.status, 'execution-checked');
	assert.equal(result.method, 'codesign-ad-hoc');
	assert.deepEqual(result.artifacts.map(({ path }) => path),
		plan.artifacts.map(({ candidatePath }) => candidatePath));
	assert(result.artifacts.every((artifact) => Object.keys(artifact).sort().join(',')
		=== 'byteLength,libraryValidation,path,sha256'));
	assert.deepEqual(result.artifacts.map(({ path, libraryValidation }) => ({
		path,
		expectation: libraryValidation.expectation,
		entitlements: libraryValidation.entitlements,
	})), result.artifacts.map(({ path }) => ({
		path,
		expectation: path === 'payload/soundscaper_professional_peer' ? 'present' : 'absent',
		entitlements: path === 'payload/soundscaper_professional_peer'
			? plan.peerEntitlements.descriptor : null,
	})));
	assert.equal(validateSoundscaperProfessionalNativeMacCodeSealResult(
		result, candidateForResult(result),
	), result);
	const tampered = structuredClone(result);
	tampered.artifacts.find(({ path }) => path === 'payload/soundscaper_professional_peer')
		.libraryValidation.entitlements.sha256 = 'f'.repeat(64);
	assert.throws(() => validateSoundscaperProfessionalNativeMacCodeSealResult(
		tampered, candidateForResult(result),
	), /entitlement|payload-misbound/iu);
	const extended = structuredClone(result);
	extended.artifacts[0].libraryValidation.unreviewed = true;
	assert.throws(() => validateSoundscaperProfessionalNativeMacCodeSealResult(
		extended, candidateForResult(result),
	), /exact record/iu);
	const foreign = structuredClone(result);
	foreign.schemaVersion = 2;
	assert.throws(() => validateSoundscaperProfessionalNativeMacCodeSealResult(
		foreign, candidateForResult(result),
	), /code-seal result/iu);
});

test('mac ad-hoc sealing refuses failed verification', async (context) => {
	const fixture = await codeSealFixture(context);
	const plan = await createSoundscaperProfessionalNativeMacCodeSealPlan({
		...fixture, target: 'mac-arm64',
	});
	let calls = 0;
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacCodeSealPlan(plan, {
		run() {
			calls += 1;
			return { status: calls === 2 ? 1 : 0, signal: null, stdout: '', stderr: 'invalid' };
		},
	}), /execution-seal verification failed/iu);
});

test('mac ad-hoc sealing proves the entitlement is peer-only', async (context) => {
	const fixture = await codeSealFixture(context);
	const plan = createSoundscaperProfessionalNativeMacCodeSealPlan({
		...fixture, target: 'mac-arm64',
	});
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacCodeSealPlan(plan, {
		run(_command, argv) {
			return argv.includes('--test-requirement') && argv.includes(NON_PEER_REQUIREMENT)
				? codesignResult('', 1) : codesignResult('');
		},
	}), /non-peer entitlement verification failed/iu);
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacCodeSealPlan(plan, {
		run(_command, argv) {
			return argv.includes('--test-requirement') && argv.includes(PEER_REQUIREMENT)
				? codesignResult('', 1) : codesignResult('');
		},
	}), /peer entitlement verification failed/iu);
});

async function codeSealFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-code-seal-'));
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

function successfulCodesignResult(argv) {
	return codesignResult(`${argv[0]} passed`);
}

function codesignResult(stderr, status = 0) {
	return { status, signal: null, stdout: '', stderr };
}

function candidateForResult(result) {
	const artifact = (path) => result.artifacts.find((entry) => entry.path === path);
	return {
		payload: artifact('payload/soundscaper_professional.node'),
		osAudioCodec: artifact('payload/soundscaper_os_audio_codec.node'),
		pluginPeer: artifact('payload/soundscaper_professional_peer'),
		deliveryFilesystem: artifact('payload/soundscaper_delivery_fs'),
		isolation: {
			launcher: artifact('payload/milestone5-native-isolation-launcher'),
			runtimeClosure: result.artifacts.filter(({ path }) => path.startsWith('payload/runtime/')),
		},
	};
}
