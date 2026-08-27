/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	PROFESSIONAL_NATIVE_MANIFEST_PATH,
	PROFESSIONAL_NATIVE_TARGETS,
	professionalNativePayloadOutputRoot,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
	verifyStagedSoundscaperProfessionalNativePayload,
} from '../scripts/lib/soundscaper-professional-native-payload.mjs';
import { describeSoundscaperProfessionalNativePayload } from '../desktop/soundscaper-professional-native-payload.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('professional payload authority is closed for every unbuilt target', async () => {
	for (const target of PROFESSIONAL_NATIVE_TARGETS) {
		const release = await verifySoundscaperProfessionalNativePayload({ repositoryRoot: ROOT, target });
		assert.equal(release.target.status, 'pending-external');
		assert.equal(release.payload, null);
	}
});

test('a verified professional Node bridge stages exactly its manifest and payload', async (context) => {
	const fixture = await builtFixture(context);
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	const runtimeRoot = join(fixture.root, 'runtime');
	const outputRoot = professionalNativePayloadOutputRoot(runtimeRoot, release);
	const summary = await stageVerifiedSoundscaperProfessionalNativePayload({ release, outputRoot });
	assert.deepEqual((await readdir(outputRoot)).sort(), [
		'milestone-5-native-isolation-review-policy.json',
		'milestone5-native-isolation-launcher',
		'native-isolation-broker-v1.json',
		'native-isolation-profile-v1.json',
		'soundscaper-professional-native-payload-manifest.json',
		'soundscaper_professional.node',
		'soundscaper_professional_peer',
	]);
	assert.equal(summary.payload.sha256, fixture.sha256);
	assert.deepEqual(Object.keys(summary.payloadManifest).sort(), ['byteLength', 'id', 'sha256']);
	assert.deepEqual(Object.keys(summary.reviewPolicy).sort(), ['byteLength', 'name', 'sha256']);
	assert.equal(summary.payloadManifest.byteLength,
		(await readFile(join(fixture.root, PROFESSIONAL_NATIVE_MANIFEST_PATH))).byteLength);
	assert.deepEqual(summary.sourceAuthentication, release.target.sourceAuthentication);
	assert.equal((await verifyStagedSoundscaperProfessionalNativePayload({ release, outputRoot })).status, 'built');
	await writeFile(join(outputRoot, 'soundscaper_professional.node'), 'tampered');
	await assert.rejects(
		() => verifyStagedSoundscaperProfessionalNativePayload({ release, outputRoot }),
		/professional native payload.*(?:byte length|digest)/iu,
	);
});

test('runtime resolution selects only the authenticated professional payload', async (context) => {
	const fixture = await builtFixture(context);
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	const resourcesPath = join(fixture.root, 'resources');
	await stageVerifiedSoundscaperProfessionalNativePayload({
		release,
		outputRoot: professionalNativePayloadOutputRoot(join(resourcesPath, 'runtime'), release),
	});
	const available = await describeSoundscaperProfessionalNativePayload({
		applicationRoot: fixture.root, packaged: true, resourcesPath,
		platform: 'linux', arch: 'x64',
	});
	assert.equal(available.status, 'available');
	assert.equal(available.descriptor.sha256, fixture.sha256);
	assert.match(available.descriptor.pluginPeer.path, /soundscaper_professional_peer$/u);
	assert.match(available.descriptor.isolation.launcher.path, /milestone5-native-isolation-launcher$/u);
	assert.equal(available.descriptor.isolation.entrypoint.path, available.descriptor.pluginPeer.path);
	assert.equal(available.descriptor.sourceAudit.status, 'authenticated');
	assert.deepEqual(available.descriptor.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'pending',
		detail: 'No independent professional-native review is recorded for stable 1.0 release admission.',
	});
	const pending = await describeSoundscaperProfessionalNativePayload({
		applicationRoot: ROOT, packaged: false, resourcesPath: '',
		platform: 'darwin', arch: 'arm64',
	});
	assert.deepEqual([pending.status, pending.reason], ['unavailable', 'payload-pending-external']);
});

test('a built payload cannot substitute well-shaped source digests for the pinned closure', async (context) => {
	const fixture = await builtFixture(context);
	const manifestPath = join(fixture.root, PROFESSIONAL_NATIVE_MANIFEST_PATH);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.targets.find(({ id }) => id === 'linux-x64')
		.sourceAuthentication.sources[0].archiveEvidence.sha256 = '0'.repeat(64);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	await assert.rejects(() => verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	}), /built record is invalid/iu);
});

test('signed review is M9 metadata and cannot disable the machine-authenticated payload', async (context) => {
	const fixture = await builtFixture(context, { productionReadiness: true });
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	assert.equal(release.m9ReleaseReview.status, 'complete');
	assert.equal(release.m9ReleaseReview.evidence.evidence.evidence.launcher.network, 'denied');
	const evidencePath = join(fixture.root,
		'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json');
	await writeFile(evidencePath, `${await readFile(evidencePath)} `);
	const changed = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	assert.equal(changed.payload.sha256, fixture.sha256);
	assert.equal(changed.m9ReleaseReview.status, 'invalid');
});

async function builtFixture(context, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-payload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const manifest = JSON.parse(await readFile(join(ROOT, PROFESSIONAL_NATIVE_MANIFEST_PATH), 'utf8'));
	const bytes = Buffer.from('fixture professional Node-API bridge');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const target = manifest.targets.find(({ id }) => id === 'linux-x64');
	target.status = 'built';
	target.blockedBy = null;
	target.toolchainIdentity = 'fixture-cxx20-node-api-8';
	target.sourceAuthentication = sourceAuthentication(target.id);
	target.payload = {
		path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper_professional.node',
		byteLength: bytes.byteLength,
		sha256,
	};
	const targetRoot = 'native/soundscaper-professional-host/prebuilt/linux-x64';
	const artifacts = {
		pluginPeer: [`${targetRoot}/soundscaper_professional_peer`, Buffer.from('fixture isolated peer')],
		launcher: [`${targetRoot}/milestone5-native-isolation-launcher`, Buffer.from('fixture isolation launcher')],
		sandboxProfile: [`${targetRoot}/native-isolation-profile-v1.json`, Buffer.from('{"profile":1}')],
		brokerPolicy: [`${targetRoot}/native-isolation-broker-v1.json`, Buffer.from('{"broker":1}')],
	};
	for (const [key, [path, artifactBytes]] of Object.entries(artifacts)) {
		const descriptor = { path, byteLength: artifactBytes.byteLength, sha256: hash(artifactBytes) };
		if (key === 'pluginPeer') target.pluginPeer = descriptor;
		else {
			target.isolation ??= { launcher: null, sandboxProfile: null, brokerPolicy: null,
				entrypointPath: artifacts.pluginPeer[0], runtimeClosure: [] };
			target.isolation[key] = descriptor;
		}
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), artifactBytes);
	}
	const payloadPath = join(root, target.payload.path);
	await mkdir(dirname(payloadPath), { recursive: true });
	await writeFile(payloadPath, bytes);
	let policy = JSON.parse(await readFile(join(ROOT,
		'config/milestone-5-native-isolation-review-policy.json'), 'utf8'));
	if (options.productionReadiness === true) {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		policy = { ...policy, trustedKeys: [{
			id: 'fixture-review', status: 'accepted',
			usages: ['soundscaper-professional-native-production-readiness'],
			targets: ['linux-x64'],
			publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
		}] };
		const evidence = readinessEvidence(target);
		const evidenceBytes = Buffer.from(JSON.stringify(evidence));
		const evidencePath = join(root,
			'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json');
		await writeFile(evidencePath, evidenceBytes);
		target.productionReadiness = {
			schemaVersion: 1, status: 'reviewed', target: target.id,
			evidence: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json',
				byteLength: evidenceBytes.byteLength, sha256: hash(evidenceBytes),
			},
			signature: {
				algorithm: 'ed25519', reviewKeyId: 'fixture-review',
				valueBase64: sign(null, evidenceBytes, privateKey).toString('base64'),
			},
		};
	}
	const manifestPath = join(root, PROFESSIONAL_NATIVE_MANIFEST_PATH);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(join(root, 'config/milestone-5-native-source-acquisitions.json'),
		await readFile(join(ROOT, 'config/milestone-5-native-source-acquisitions.json')));
	await writeFile(join(root, 'config/milestone-5-native-isolation-review-policy.json'),
		`${JSON.stringify(policy, null, '\t')}\n`);
	return { root, sha256 };
}

function readinessEvidence(target) {
	return {
		schemaVersion: 1, kind: 'soundscaper-professional-native-production-readiness',
		target: target.id,
		payload: { byteLength: target.payload.byteLength, sha256: target.payload.sha256 },
		sourceAuthenticationSha256: hash(Buffer.from(stableJson(target.sourceAuthentication))),
		toolchainIdentity: target.toolchainIdentity,
		buildProvenance: {
			sourceRevision: '1'.repeat(40), buildPlanSha256: '2'.repeat(64),
			nativeHostTreeSha256: '3'.repeat(64), helperAddonTreeSha256: '4'.repeat(64),
		},
		launcher: {
			schemaVersion: 1, target: target.id,
			launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: target.isolation.launcher.sha256,
			sandboxProfileSha256: target.isolation.sandboxProfile.sha256,
			brokerPolicySha256: target.isolation.brokerPolicy.sha256,
			peerPayloadSha256: target.pluginPeer.sha256,
			runtimeClosureSha256: hash(Buffer.from('[]')), filesystem: 'broker-grant-only',
			network: 'denied', childProcesses: 'denied', dynamicCode: 'admitted-plugin-only',
		},
		osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: '2026-08-24', reviewer: 'Fixture Reviewer',
	};
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function sourceAuthentication(target) {
	const sourceRegister = JSON.parse(readFileSync(join(ROOT,
		'config/milestone-5-native-source-acquisitions.json'), 'utf8'));
	const ids = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : [])];
	return {
		schemaVersion: 1, status: 'authenticated', sources: ids.map((id) => {
			const source = sourceRegister.sources.find((entry) => entry.id === id);
			return {
				id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: { ...source.extractedTree },
			};
		}),
	};
}
