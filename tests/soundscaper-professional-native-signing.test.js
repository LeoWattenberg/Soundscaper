/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperProfessionalNativeMacSigningPlan,
	executeSoundscaperProfessionalNativeMacSigningPlan,
	validateSoundscaperProfessionalNativeMacSigningEvidence,
} from '../scripts/lib/soundscaper-professional-native-macos-signing.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PEER_ENTITLEMENTS_PATH =
	'native/soundscaper-professional-host/soundscaper-professional-peer-entitlements.mac.plist';
const LIBRARY_VALIDATION_KEY = 'com.apple.security.cs.disable-library-validation';
const PEER_REQUIREMENT = `=entitlement["${LIBRARY_VALIDATION_KEY}"] exists`;
const NON_PEER_REQUIREMENT = `=! entitlement["${LIBRARY_VALIDATION_KEY}"] exists`;

test('mac ad-hoc sealing covers runtime dependencies before every consumer and verifies each', async (context) => {
	const fixture = await signingFixture(context);
	const plan = await createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: '-',
	});
	assert.equal(plan.schemaVersion, 2);
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
	const evidence = await executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
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
	assert.equal(evidence.schemaVersion, 2);
	assert.equal(evidence.status, 'signatures-verified');
	assert.deepEqual(evidence.artifacts.map(({ path }) => path),
		plan.artifacts.map(({ candidatePath }) => candidatePath));
	assert(evidence.artifacts.every(({ signOutputSha256, verificationOutputSha256,
		libraryValidation }) => /^[a-f\d]{64}$/u.test(signOutputSha256)
		&& /^[a-f\d]{64}$/u.test(verificationOutputSha256)
		&& /^[a-f\d]{64}$/u.test(libraryValidation.outputSha256)));
	assert.deepEqual(evidence.artifacts.map(({ path, libraryValidation }) => ({
		path,
		expectation: libraryValidation.expectation,
		entitlements: libraryValidation.entitlements,
	})), evidence.artifacts.map(({ path }) => ({
		path,
		expectation: path === 'payload/soundscaper_professional_peer' ? 'present' : 'absent',
		entitlements: path === 'payload/soundscaper_professional_peer'
			? plan.peerEntitlements.descriptor : null,
	})));
	assert.equal(validateSoundscaperProfessionalNativeMacSigningEvidence(
		evidence, candidateForEvidence(evidence),
	), evidence);
	const tampered = structuredClone(evidence);
	tampered.artifacts.find(({ path }) => path === 'payload/soundscaper_professional_peer')
		.libraryValidation.entitlements.sha256 = 'f'.repeat(64);
	assert.throws(() => validateSoundscaperProfessionalNativeMacSigningEvidence(
		tampered, candidateForEvidence(evidence),
	), /entitlement|payload-misbound/iu);
	const extended = structuredClone(evidence);
	extended.artifacts[0].libraryValidation.unreviewed = true;
	assert.throws(() => validateSoundscaperProfessionalNativeMacSigningEvidence(
		extended, candidateForEvidence(evidence),
	), /exact record/iu);
	const legacy = structuredClone(evidence);
	legacy.schemaVersion = 1;
	assert.throws(() => validateSoundscaperProfessionalNativeMacSigningEvidence(
		legacy, candidateForEvidence(evidence),
	), /identity/iu);
});

test('mac code sealing rejects every identity except ad-hoc', async (context) => {
	const fixture = await signingFixture(context);
	for (const signingIdentity of ['', 'identity', 'Apple Development']) {
		assert.throws(() => createSoundscaperProfessionalNativeMacSigningPlan({
			...fixture, target: 'mac-arm64', signingIdentity,
		}), /only ad-hoc code sealing/iu);
	}
});

test('mac ad-hoc sealing refuses failed verification', async (context) => {
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

test('mac ad-hoc sealing proves the entitlement is peer-only', async (context) => {
	const fixture = await signingFixture(context);
	const plan = createSoundscaperProfessionalNativeMacSigningPlan({
		...fixture, target: 'mac-arm64', signingIdentity: '-',
	});
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
		run(_command, argv) {
			return argv.includes('--test-requirement') && argv.includes(NON_PEER_REQUIREMENT)
				? codesignResult('', 1) : codesignResult('');
		},
	}), /non-peer entitlement verification failed/iu);
	await assert.rejects(() => executeSoundscaperProfessionalNativeMacSigningPlan(plan, {
		run(_command, argv) {
			return argv.includes('--test-requirement') && argv.includes(PEER_REQUIREMENT)
				? codesignResult('', 1) : codesignResult('');
		},
	}), /peer entitlement verification failed/iu);
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

function successfulCodesignResult(argv) {
	return codesignResult(`${argv[0]} passed`);
}

function codesignResult(stderr, status = 0) {
	return { status, signal: null, stdout: '', stderr };
}

function candidateForEvidence(evidence) {
	const artifact = (path) => evidence.artifacts.find((entry) => entry.path === path);
	return {
		payload: artifact('payload/soundscaper_professional.node'),
		osAudioCodec: artifact('payload/soundscaper_os_audio_codec.node'),
		pluginPeer: artifact('payload/soundscaper_professional_peer'),
		deliveryFilesystem: artifact('payload/soundscaper_delivery_fs'),
		isolation: {
			launcher: artifact('payload/milestone5-native-isolation-launcher'),
			runtimeClosure: evidence.artifacts.filter(({ path }) => path.startsWith('payload/runtime/')),
		},
	};
}
