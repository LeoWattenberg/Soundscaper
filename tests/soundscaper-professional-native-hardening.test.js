/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	assertSoundscaperProfessionalPackagedAppAuthority,
	authenticateSoundscaperProfessionalPackagedApp,
} from '../scripts/lib/soundscaper-professional-packaged-app-authority.mjs';
import {
	assertSoundscaperProfessionalContainmentProbeResult,
	runSoundscaperProfessionalNativeContainmentProbe,
} from '../scripts/lib/soundscaper-professional-native-containment-probes.mjs';
import {
	assertDesktopProfessionalNativeReleasePolicy,
} from '../scripts/lib/desktop-professional-native-release-policy.mjs';

const REVISION = 'ab'.repeat(20);

test('packaged Electron authority binds source, content manifest, executable, and full tree', async (context) => {
	const fixture = await packagedAppFixture(context);
	const authority = authenticateSoundscaperProfessionalPackagedApp({
		packagedAppRoot: fixture.root, sourceRevision: REVISION, target: 'linux-x64',
	});
	assert.equal(authority.sourceRevision, REVISION);
	assert.equal(authority.target, 'linux-x64');
	assert.match(authority.contentManifest.sha256, /^[a-f\d]{64}$/u);
	assert.match(authority.rootClosureSha256, /^[a-f\d]{64}$/u);
	assert.equal(assertSoundscaperProfessionalPackagedAppAuthority(authority, {
		packagedAppRoot: fixture.root, sourceRevision: REVISION, target: 'linux-x64',
	}), authority);

	await writeFile(fixture.executable, 'caller-swapped packaged executable');
	assert.throws(() => assertSoundscaperProfessionalPackagedAppAuthority(authority, {
		packagedAppRoot: fixture.root, sourceRevision: REVISION, target: 'linux-x64',
	}), /packaged Electron.*changed|authority/iu);
});

test('packaged Electron authority refuses a copied manifest with changed resources or revision', async (context) => {
	const changed = await packagedAppFixture(context);
	const authority = authenticateSoundscaperProfessionalPackagedApp({
		packagedAppRoot: changed.root, sourceRevision: REVISION, target: 'linux-x64',
	});
	await writeFile(changed.resource, 'changed resource bytes');
	assert.throws(() => assertSoundscaperProfessionalPackagedAppAuthority(authority, {
		packagedAppRoot: changed.root, sourceRevision: REVISION, target: 'linux-x64',
	}), /content manifest|resource closure|changed/iu);

	const wrongRevision = await packagedAppFixture(context, 'cd'.repeat(20));
	assert.throws(() => authenticateSoundscaperProfessionalPackagedApp({
		packagedAppRoot: wrongRevision.root, sourceRevision: REVISION, target: 'linux-x64',
	}), /source revision/iu);
});

test('containment receipts require observed hostile-operation denial, not policy declarations', () => {
	for (const [scenario, stdout] of [
		['isolation-broker-filesystem-grant',
			'SOUNDSCAPER_CONTAINMENT_PROBE filesystem authorized-read unauthorized-denied\n'],
		['isolation-network-denial', 'SOUNDSCAPER_CONTAINMENT_PROBE network denied\n'],
		['isolation-child-process-denial', 'SOUNDSCAPER_CONTAINMENT_PROBE child-process denied\n'],
	]) {
		assert.deepEqual(assertSoundscaperProfessionalContainmentProbeResult(scenario, {
			exitCode: 0, signal: null, stdout, stderr: '',
		}), { scenario, status: 'observed-denied' });
		assert.throws(() => assertSoundscaperProfessionalContainmentProbeResult(scenario, {
			exitCode: 0, signal: null,
			stdout: '{"filesystem":"broker-only","network":"denied","childProcesses":"denied"}\n',
			stderr: '',
		}), /observed denial|hostile containment probe/iu);
	}
	assert.throws(() => assertSoundscaperProfessionalContainmentProbeResult(
		'isolation-network-denial', {
			exitCode: 126, signal: null,
			stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE network allowed\n', stderr: '',
		},
	), /observed denial|hostile containment probe/iu);
	assert.deepEqual(assertSoundscaperProfessionalContainmentProbeResult(
		'isolation-rss-ceiling', {
			exitCode: 128, signal: 'SIGKILL',
			stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n', stderr: '',
		},
	), { scenario: 'isolation-rss-ceiling', status: 'observed-terminated' });
	for (const completion of [{
		exitCode: 126, signal: null,
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n'
			+ 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling survived\n', stderr: '',
	}, {
		exitCode: 128, signal: 'SIGTERM',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n', stderr: '',
	}]) {
		assert.throws(() => assertSoundscaperProfessionalContainmentProbeResult(
			'isolation-rss-ceiling', completion,
		), /RSS ceiling|hostile containment probe/iu);
	}
});

test('hostile probes traverse the enforced peer path with only the intended broker grant', async () => {
	const peer = probeArtifact(resolve(tmpdir(), 'soundscaper-probe-peer'));
	const authorizedFile = probeArtifact(resolve(tmpdir(), 'soundscaper-probe-authorized'));
	for (const [scenario, stdout] of [
		['isolation-broker-filesystem-grant',
			'SOUNDSCAPER_CONTAINMENT_PROBE filesystem authorized-read unauthorized-denied\n'],
		['isolation-network-denial', 'SOUNDSCAPER_CONTAINMENT_PROBE network denied\n'],
		['isolation-child-process-denial', 'SOUNDSCAPER_CONTAINMENT_PROBE child-process denied\n'],
	]) {
		let request = null;
		const result = await runSoundscaperProfessionalNativeContainmentProbe({
			scenario,
			launcher: {
				launch: async (value) => {
					request = value;
					return {
						enforcement: {
							kind: 'native-child-os-isolation-enforced',
							launcherId: 'fixture-enforced-launcher',
						},
						completion: Promise.resolve({
							exitCode: 0, signal: null, stdout, stderr: '',
						}),
					};
				},
			},
			peer,
			runtimeClosure: [],
			authorizedFile,
			unauthorizedPath: resolve(tmpdir(), 'soundscaper-probe-unauthorized'),
		});
		assert.equal(result.status, 'observed-denied');
		assert.equal(request.executable, peer);
		assert.equal(request.workloadPayload, peer);
		assert.equal(request.framedControl, null);
		assert.deepEqual(request.writeOnly, []);
		assert.deepEqual(request.readExecute, []);
		assert.equal(request.readOnly.length,
			scenario === 'isolation-broker-filesystem-grant' ? 1 : 0);
	}
});

test('the macOS RSS probe reaches the authenticated peer then requires supervisor SIGKILL', async () => {
	const peer = probeArtifact(resolve(tmpdir(), 'soundscaper-rss-probe-peer'));
	let request = null;
	const result = await runSoundscaperProfessionalNativeContainmentProbe({
		scenario: 'isolation-rss-ceiling',
		launcher: {
			launch: async (value) => {
				request = value;
				return {
					enforcement: {
						kind: 'native-child-os-isolation-enforced',
						target: 'mac-arm64',
						launcherId: 'soundscaper-macos-seatbelt-broker-v1',
					},
					completion: Promise.resolve({
						exitCode: 128, signal: 'SIGKILL',
						stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n',
						stderr: '',
					}),
				};
			},
		},
		peer,
		runtimeClosure: [],
	});
	assert.equal(result.status, 'observed-terminated');
	assert.equal(request.executable, peer);
	assert.equal(request.workloadPayload, peer);
	assert.deepEqual(request.arguments, ['--soundscaper-containment-probe=rss-ceiling']);
	assert.equal(request.resourcePolicy.maximumRssBytes, 128 * 1024 ** 2);
	assert.equal(request.resourcePolicy.maximumJobDurationMs, 30_000);
	assert.deepEqual(request.readOnly, []);
	assert.deepEqual(request.readExecute, []);
	assert.deepEqual(request.writeOnly, []);
});

test('the target peer contains purpose-built filesystem, network, and child-process attempts', async () => {
	const source = await readFile(resolve(import.meta.dirname,
		'../native/soundscaper-professional-host/src/professional_host_peer.cpp'), 'utf8');
	assert.match(source, /SOUNDSCAPER_CONTAINMENT_PROBE/u);
	assert.match(source, /(?:fopen|ifstream)/u);
	assert.match(source, /\bconnect\s*\(/u);
	assert.match(source, /\b(?:fork|CreateProcessW)\s*\(/u);
	assert.match(source,
		/rss-ceiling pressure-started[\s\S]*256u \* 1024u \* 1024u[\s\S]*volatile/u,
		'the target peer must make resident memory pressure after its sandbox enforcement handshake');
	assert.match(source, /rss-ceiling survived/u,
		'the target peer must make a missing supervisor termination observable');
});

test('desktop preparation verifies native package inputs only for Soundscaper stable selection', () => {
	const release = Object.freeze({
		target: Object.freeze({ id: 'linux-x64' }),
		buildAuthority: Object.freeze({ sourceRevision: REVISION }),
	});
	const calls = [];
	const assertPackageInputs = (value) => { calls.push(value); return { target: 'linux-x64' }; };
	assert.equal(assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'candidate', releaseChannel: 'candidate' },
		release,
	}, { assertPackageInputs }), release);
	assert.equal(calls.length, 0);
	assert.equal(assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release,
		sourceRevision: REVISION,
	}, { assertPackageInputs }), release);
	assert.deepEqual(calls, [release]);
	assert.throws(() => assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release,
		sourceRevision: 'cd'.repeat(20),
	}, { assertPackageInputs }), /build result.*desktop source revision/iu);
	assert.throws(() => assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release: null,
	}, { assertPackageInputs }), /stable Soundscaper.*professional native/iu);
	const harnessRelease = Object.freeze({ status: 'pending-external' });
	assert.equal(assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release: harnessRelease,
		harnessPreparation: true,
	}, { assertPackageInputs }), harnessRelease);
});

test('desktop preparation executes the professional native release policy before staging', async () => {
	const source = await readFile(resolve(import.meta.dirname, '../scripts/desktop-prepare.mjs'), 'utf8');
	const gate = source.indexOf('assertDesktopProfessionalNativeReleasePolicy({');
	const destructiveStage = source.indexOf('await rm(BUILD_ROOT, { recursive: true, force: true });');
	assert(gate > 0 && destructiveStage > gate,
		'desktop preparation must gate the exact release before replacing its build tree');
});

test('peer completion failures retain bounded trusted shutdown phase evidence', async () => {
	const source = await readFile(resolve(import.meta.dirname,
		'../desktop/soundscaper-professional-plugin-peer.ts'), 'utf8');
	assert.match(source, /closeAcknowledged = true/u);
	assert.match(source, /signal=.*close-acknowledged=/u);
	assert.match(source, /scan-completed=/u);
	assert.match(source, /new AggregateError\(\s*\[operationError, closeError\]/u);
});

async function packagedAppFixture(context, sourceRevision = REVISION) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-authority-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const applicationRoot = join(root, 'linux-unpacked');
	const resourcesRoot = join(applicationRoot, 'resources');
	const executable = join(applicationRoot, 'soundscaper');
	const resource = join(resourcesRoot, 'app.asar');
	await mkdir(resourcesRoot, { recursive: true });
	await writeFile(executable, 'fixture executable');
	await writeFile(resource, 'fixture resource');
	const resourceBytes = await readFile(resource);
	const files = [{
		path: 'app.asar', byteLength: resourceBytes.byteLength, sha256: digest(resourceBytes),
	}];
	const manifest = {
		schemaVersion: 1,
		status: 'installed-resource-closure-audited',
		productId: 'soundscaper',
		targetId: 'linux-x64',
		applicationVersion: '1.0.0-rc.1',
		sourceRevision,
		runtimeManifest: {
			byteLength: 1, sha256: '1'.repeat(64),
			value: {
				schemaVersion: 1, productId: 'soundscaper', sourceRevision,
				target: { platform: 'linux', arch: 'x64' },
			},
		},
		files,
		fileCount: files.length,
		totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
		closureSha256: digest(Buffer.from(JSON.stringify(files), 'utf8')),
	};
	await writeFile(join(resourcesRoot, 'milestone-5-package-content.json'),
		`${JSON.stringify(manifest, null, 2)}\n`);
	return { root, executable, resource };
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function probeArtifact(path) {
	return Object.freeze({
		path, byteLength: 1, sha256: '9'.repeat(64),
		identity: Object.freeze({ dev: '18446744073709551615', ino: '9007199254740993' }),
	});
}
