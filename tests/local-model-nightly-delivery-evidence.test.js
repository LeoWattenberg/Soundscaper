/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createPackage } from '@electron/asar';
import electronPath from 'electron';
import catalog from '../config/local-model-catalog.json' with { type: 'json' };
import { assistanceRuntimeFamiliesForModel } from '../desktop/assistance-runtime-model-supply.ts';

import {
	createModelInstallEvidence,
	expectedRuntimeArchiveFileNames,
	readNightlyPackageIdentity,
	verifyCatalogModelDelivery,
} from './electron/local-assistance-models/model-delivery-evidence.js';

const bytes = Buffer.from('nightly model bytes');
const model = Object.freeze({
	modelId: 'nightly-model',
	task: 'voice-activity-detection',
	version: '1.0.0',
	artifacts: Object.freeze([Object.freeze({
		fileName: 'model.onnx',
		byteLength: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		url: 'https://assets.soundscaper.org/models/nightly-model/1.0.0/model.onnx',
	})]),
});
const sourceRevision = 'a'.repeat(40);
const execFileAsync = promisify(execFile);
const packageIdentity = Object.freeze({
	productId: 'framescaper',
	applicationVersion: '1.0.0-rc.5',
	sourceRevision,
	target: 'linux-x64',
	application: Object.freeze({ fileName: 'framescaper.asar', byteLength: 12, sha256: 'b'.repeat(64) }),
	stageManifest: Object.freeze({ fileName: 'stage-manifest.json', byteLength: 34, sha256: 'c'.repeat(64) }),
});

function publicDelivery(requests) {
	return async (url, init) => {
		requests.push({ url, method: init.method, range: init.headers.Range ?? null });
		const ranged = init.headers.Range === 'bytes=0-0';
		return new Response(init.method === 'HEAD' ? null : bytes.subarray(0, 1), {
			status: ranged ? 206 : 200,
			headers: {
				'Access-Control-Allow-Origin': 'https://soundscaper.org',
				'Access-Control-Expose-Headers': 'Content-Range',
				'Content-Length': String(ranged ? 1 : bytes.length),
				...(ranged ? { 'Content-Range': `bytes 0-0/${String(bytes.length)}` } : {}),
			},
		});
	};
}

test('nightly evidence combines live public delivery with the packaged installer full-hash result', async () => {
	const requests = [];
	const delivery = await verifyCatalogModelDelivery(model, { fetchImpl: publicDelivery(requests) });
	assert.deepEqual(requests, [
		{ url: model.artifacts[0].url, method: 'HEAD', range: null },
		{ url: model.artifacts[0].url, method: 'GET', range: 'bytes=0-0' },
	], 'Public evidence must not issue another full-body GET.');
	const installation = {
		model: { modelId: model.modelId, version: model.version, availability: 'installed',
			installedBytes: bytes.length, artifactSha256s: [model.artifacts[0].sha256] },
		elapsedMs: 42,
		artifacts: [{ modelId: model.modelId, fileName: 'model.onnx',
			completedBytes: bytes.length, totalBytes: bytes.length }],
	};
	assert.deepEqual(createModelInstallEvidence({
		model, delivery, installation, packageIdentity,
		checkedAt: '2026-09-13T00:00:00.000Z',
	}), {
		schemaVersion: 1,
		kind: 'soundscaper-nightly-local-model-install',
		checkedAt: '2026-09-13T00:00:00.000Z',
		sourceRevision,
		modelId: 'nightly-model',
		version: '1.0.0',
		target: 'linux-x64',
		package: packageIdentity,
		checks: ['public-head', 'byte-range', 'cors', 'full-sha256'],
		artifacts: model.artifacts,
		installation: {
			availability: 'installed', installedBytes: bytes.length, elapsedMs: 42,
			artifactSha256s: [model.artifacts[0].sha256],
			progress: installation.artifacts,
			runtimeProgress: [],
		},
	});
});

test('nightly evidence recognizes only the runtime archives required by the model', async () => {
	const delivery = await verifyCatalogModelDelivery(model, { fetchImpl: publicDelivery([]) });
	const artifact = { modelId: model.modelId, fileName: 'model.onnx',
		completedBytes: bytes.length, totalBytes: bytes.length };
	const runtime = { modelId: model.modelId, fileName: 'sherpa-onnx-node.tar.gz',
		completedBytes: 120, totalBytes: 120 };
	const installation = { model: { modelId: model.modelId, version: model.version,
		availability: 'installed', installedBytes: bytes.length,
		artifactSha256s: [model.artifacts[0].sha256] }, elapsedMs: 1,
	artifacts: [runtime, artifact] };
	const evidence = createModelInstallEvidence({ model, delivery, installation, packageIdentity });
	assert.deepEqual(evidence.installation.progress, [artifact]);
	assert.deepEqual(evidence.installation.runtimeProgress, [runtime]);
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, artifacts: [{ ...runtime, fileName: 'llama-cpp.tar.gz' }, artifact] },
		packageIdentity }), /foreign artifact/u);
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, artifacts: [{ ...runtime, completedBytes: 119 }, artifact] },
		packageIdentity }), /finish.*runtime/u);
});

test('the packaged test runtime archive mapping matches every production model', () => {
	for (const entry of catalog.entries) {
		assert.deepEqual(expectedRuntimeArchiveFileNames(entry.modelId, entry.task),
			assistanceRuntimeFamiliesForModel(entry.modelId, entry.task)
				.map((familyId) => `${familyId}.tar.gz`));
	}
});

test('nightly evidence rejects a public descriptor or installed byte count that differs from the catalog', async () => {
	const delivery = await verifyCatalogModelDelivery(model, { fetchImpl: publicDelivery([]) });
	const installation = { model: { modelId: model.modelId, version: model.version,
		availability: 'installed', installedBytes: bytes.length,
		artifactSha256s: [model.artifacts[0].sha256] }, elapsedMs: 1,
	artifacts: [{ modelId: model.modelId, fileName: 'model.onnx',
		completedBytes: bytes.length, totalBytes: bytes.length }] };
	assert.throws(() => createModelInstallEvidence({ model, delivery: [{ ...delivery[0], sha256: 'f'.repeat(64) }],
		installation, packageIdentity }), /public delivery.*catalog/u);
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, model: { ...installation.model, installedBytes: bytes.length - 1 } },
		packageIdentity }), /installed byte count/u);
	assert.throws(() => createModelInstallEvidence({ model, delivery, installation,
		packageIdentity: { ...packageIdentity, unchecked: true } }), /package identity.*fields/u);
});

test('nightly evidence requires complete artifact progress and authenticated installed hashes', async () => {
	const delivery = await verifyCatalogModelDelivery(model, { fetchImpl: publicDelivery([]) });
	const installation = { model: { modelId: model.modelId, version: model.version,
		availability: 'installed', installedBytes: bytes.length,
		artifactSha256s: [model.artifacts[0].sha256] }, elapsedMs: 1,
	artifacts: [{ modelId: model.modelId, fileName: 'model.onnx',
		completedBytes: bytes.length, totalBytes: bytes.length }] };
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, artifacts: [] }, packageIdentity }),
	/artifact filename set/u);
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, model: { ...installation.model,
			artifactSha256s: ['f'.repeat(64)] } }, packageIdentity }),
	/installed artifact SHA-256s/u);
	assert.throws(() => createModelInstallEvidence({ model, delivery,
		installation: { ...installation, model: { ...installation.model,
			artifactSha256s: undefined } }, packageIdentity }),
	/installed artifact SHA-256s/u);
});

test('package identity binds the exact staged application, manifest, target, and source revision', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'nightly-package-identity-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	const productRoot = join(payloadRoot, 'products');
	await mkdir(join(productRoot, 'framescaper'), { recursive: true });
	const nightlyManifest = Buffer.from(`${JSON.stringify({
		schemaVersion: 1, kind: 'soundscaper-desktop-nightly-tests', applicationVersion: '1.0.0-rc.9',
		sourceRevision, target: { platform: 'linux', arch: 'x64' },
	})}\n`);
	const productManifest = Buffer.from(`${JSON.stringify({
		schemaVersion: 1, productId: 'framescaper', applicationVersion: '1.0.0-rc.5',
		sourceRevision, target: { platform: 'linux', arch: 'x64' },
	})}\n`);
	const application = Buffer.from('packaged app');
	await writeFile(join(payloadRoot, 'stage-manifest.json'), nightlyManifest);
	await writeFile(join(productRoot, 'framescaper/stage-manifest.json'), productManifest);
	await writeFile(join(productRoot, 'framescaper.asar'), application);
	assert.deepEqual(await readNightlyPackageIdentity({
		payloadRoot, productRoot, productId: 'framescaper', target: 'linux-x64',
	}), {
		productId: 'framescaper', applicationVersion: '1.0.0-rc.5', sourceRevision,
		target: 'linux-x64',
		application: { fileName: 'framescaper.asar', byteLength: application.byteLength,
			sha256: createHash('sha256').update(application).digest('hex') },
		stageManifest: { fileName: 'stage-manifest.json', byteLength: productManifest.byteLength,
			sha256: createHash('sha256').update(productManifest).digest('hex') },
	});
	await writeFile(join(productRoot, 'framescaper/stage-manifest.json'),
		Buffer.from(productManifest.toString().replace(sourceRevision, 'd'.repeat(40))));
	await assert.rejects(readNightlyPackageIdentity({
		payloadRoot, productRoot, productId: 'framescaper', target: 'linux-x64',
	}), /source revision/u);
});

test('package identity hashes raw ASAR bytes when the nightly tests run through Electron', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'nightly-package-electron-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	const productRoot = join(payloadRoot, 'products');
	const applicationSource = join(payloadRoot, 'application');
	await mkdir(join(productRoot, 'framescaper'), { recursive: true });
	await mkdir(applicationSource);
	const stagePlatform = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform];
	assert.ok(stagePlatform);
	const target = `${process.platform}-${process.arch}`;
	const nightlyManifest = {
		schemaVersion: 1, kind: 'soundscaper-desktop-nightly-tests', sourceRevision,
		target: { platform: stagePlatform, arch: process.arch },
	};
	const productManifest = {
		schemaVersion: 1, productId: 'framescaper', applicationVersion: '1.0.0-rc.5', sourceRevision,
		target: { platform: stagePlatform, arch: process.arch },
	};
	await writeFile(join(payloadRoot, 'stage-manifest.json'), `${JSON.stringify(nightlyManifest)}\n`);
	await writeFile(join(productRoot, 'framescaper/stage-manifest.json'), `${JSON.stringify(productManifest)}\n`);
	await writeFile(join(applicationSource, 'package.json'), '{"name":"nightly-product-fixture"}\n');
	const applicationPath = join(productRoot, 'framescaper.asar');
	await createPackage(applicationSource, applicationPath);
	const moduleUrl = pathToFileURL(join(import.meta.dirname,
		'electron/local-assistance-models/model-delivery-evidence.js')).href;
	const options = JSON.stringify({ payloadRoot, productRoot, productId: 'framescaper', target });
	const { stdout } = await execFileAsync(electronPath, [
		'--input-type=module', '--eval',
		'const api = await import(process.argv[1]);'
			+ 'process.stdout.write(JSON.stringify(await api.readNightlyPackageIdentity(JSON.parse(process.argv[2]))));',
		moduleUrl, options,
	], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
	const identity = JSON.parse(stdout);
	const applicationBytes = await readFile(applicationPath);
	assert.deepEqual(identity.application, {
		fileName: 'framescaper.asar', byteLength: applicationBytes.byteLength,
		sha256: createHash('sha256').update(applicationBytes).digest('hex'),
	});
});
