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

test('the target peer contains purpose-built filesystem, network, and child-process attempts', async () => {
	const source = await readFile(resolve(import.meta.dirname,
		'../native/soundscaper-professional-host/src/professional_host_peer.cpp'), 'utf8');
	assert.match(source, /SOUNDSCAPER_CONTAINMENT_PROBE/u);
	assert.match(source, /(?:fopen|ifstream)/u);
	assert.match(source, /\bconnect\s*\(/u);
	assert.match(source, /\b(?:fork|CreateProcessW)\s*\(/u);
});

test('desktop preparation invokes the stable native gate only for Soundscaper stable selection', () => {
	const release = Object.freeze({
		target: Object.freeze({ id: 'linux-x64' }),
		productionReadiness: Object.freeze({
			candidateAuthority: Object.freeze({ sourceRevision: REVISION }),
		}),
	});
	const calls = [];
	const assertStable = (value) => { calls.push(value); return { status: 'ready' }; };
	assert.equal(assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'candidate', releaseChannel: 'candidate' },
		release,
	}, { assertStable }), release);
	assert.equal(calls.length, 0);
	assert.equal(assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release,
		sourceRevision: REVISION,
	}, { assertStable }), release);
	assert.deepEqual(calls, [release]);
	assert.throws(() => assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release,
		sourceRevision: 'cd'.repeat(20),
	}, { assertStable }), /candidate source revision.*desktop source revision/iu);
	assert.throws(() => assertDesktopProfessionalNativeReleasePolicy({
		productId: 'soundscaper',
		productMetadata: { applicationVersionChannel: 'stable', releaseChannel: 'stable' },
		release: null,
	}, { assertStable }), /stable Soundscaper.*professional native/iu);
});

test('desktop preparation executes the professional native release policy before staging', async () => {
	const source = await readFile(resolve(import.meta.dirname, '../scripts/desktop-prepare.mjs'), 'utf8');
	const gate = source.indexOf('assertDesktopProfessionalNativeReleasePolicy({');
	const destructiveStage = source.indexOf('await rm(BUILD_ROOT, { recursive: true, force: true });');
	assert(gate > 0 && destructiveStage > gate,
		'desktop preparation must gate the exact release before replacing its build tree');
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
		identity: Object.freeze({ dev: 1, ino: 1 }),
	});
}
