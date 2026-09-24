/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { verifyMirroredArtifact } from '../scripts/lib/local-model-mirror-publication.mjs';
import {
	publishAssistanceRuntimeBundles,
	verifyAssistanceRuntimeBundles,
} from '../scripts/publish-assistance-runtime-assets.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('runtime publication uploads immutable R2 keys and reads public bytes back before success', async () => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-publish-'));
	try {
		const bytes = Buffer.from('pinned archive');
		const sha256 = hash(bytes);
		const families = ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p'];
		const sourceFile = { path: 'engine', byteLength: 6, sha256: 'a'.repeat(64), executable: true };
		const native = { version: '1.0.0', runtimePrefix: 'assistance/sherpa-onnx/1.0.0',
			commonPackage: { name: 'sherpa-onnx-node', files: { engine: { byteLength: 6, sha256: sourceFile.sha256 } } },
			targets: { 'linux-x64': { status: 'built', package: { name: 'sherpa-onnx-linux-x64',
				files: { engine: { byteLength: 6, sha256: sourceFile.sha256 } } } } } };
		const family = { manifests: Object.fromEntries(families.slice(1, 4).map((familyId) => [familyId, {
			runtimeVersion: '1.0.0', runtimePrefix: `assistance/${familyId}/1.0.0`,
			targets: [{ id: 'linux-x64', status: 'authenticated', files: [sourceFile] }],
		}])) };
		const kokoro = { runtimeVersion: '1.0.0', runtimePrefix: 'assistance/kokoro-g2p/1.0.0',
			targetId: 'linux-x64', executable: 'engine', files: [{ path: sourceFile.path,
				byteLength: sourceFile.byteLength, sha256: sourceFile.sha256 }] };
		const bundles = await Promise.all(families.map(async (familyId) => {
			const file = join(root, familyId, '1.0.0/linux-x64', `${sha256}.tar.gz`);
			await mkdir(join(root, familyId, '1.0.0/linux-x64'), { recursive: true });
			await writeFile(file, bytes);
			const runtimePrefix = familyId === 'sherpa-onnx-node'
				? native.runtimePrefix : `assistance/${familyId}/1.0.0`;
			return { familyId, runtimeVersion: '1.0.0', runtimePrefix,
				installPath: familyId === 'sherpa-onnx-node' ? runtimePrefix : `${runtimePrefix}/linux-x64`,
				files: familyId === 'sherpa-onnx-node'
					? ['sherpa-onnx-node', 'sherpa-onnx-linux-x64'].map((name) => ({
						...sourceFile, path: `node_modules/${name}/engine` })) : [sourceFile],
				archive: { url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/1.0.0/linux-x64/${sha256}.tar.gz`,
					byteLength: bytes.length, sha256 } };
		}));
		const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, targetId: 'linux-x64', bundles }));
		const authority = { manifestBytes, targetId: 'linux-x64',
			receipt: { targetId: 'linux-x64', signingFiles: [],
				manifest: { path: 'config/assistance-runtime-distribution.json',
					byteLength: manifestBytes.length, sha256: hash(manifestBytes) },
				bundles: bundles.map(({ familyId, archive }) => ({ familyId,
					byteLength: archive.byteLength, sha256: archive.sha256 })) },
			nativeManifestBytes: Buffer.from(JSON.stringify(native)),
			familyManifestBytes: Buffer.from(JSON.stringify(family)),
			kokoroManifestBytes: Buffer.from(JSON.stringify(kokoro)) };
		const calls = [];
		await publishAssistanceRuntimeBundles({ authority, archivesRoot: root,
			client: { bucket: 'soundscaper-assets', endpoint: new URL('https://example.eu.r2.cloudflarestorage.com') },
			upload: async (input) => { calls.push(['upload', input.key, input.file]); return { status: 0 }; },
			verify: async (input) => { calls.push(['verify', input.url]); },
		});
		assert.deepEqual(calls, bundles.flatMap((bundle) => [
			['upload', `runtime/assistance/${bundle.familyId}/1.0.0/linux-x64/${sha256}.tar.gz`,
				join(root, bundle.familyId, '1.0.0/linux-x64', `${sha256}.tar.gz`)],
			['verify', bundle.archive.url],
		]));
		let misdirectedUploads = 0;
		await assert.rejects(publishAssistanceRuntimeBundles({ authority, archivesRoot: root,
			client: { bucket: 'soundscaper-assets', endpoint: new URL(
				'https://example.eu.r2.cloudflarestorage.com.attacker.r2.cloudflarestorage.com') },
			upload: async () => { misdirectedUploads += 1; return { status: 0 }; },
			verify: async () => {},
		}), /EU soundscaper-assets R2 bucket/u);
		assert.equal(misdirectedUploads, 0);
		const publicChecks = [];
		const verified = await verifyAssistanceRuntimeBundles({ authority, archivesRoot: root,
			verify: async (input) => { publicChecks.push(input); return input; } });
		assert.deepEqual(verified, { targetId: 'linux-x64', verified: families.length });
		assert.deepEqual(publicChecks, bundles.map(({ archive }) => ({ url: archive.url, artifact: archive })));
		await assert.rejects(verifyAssistanceRuntimeBundles({ authority, archivesRoot: root,
			verify: async () => { throw new Error('public archive is absent'); } }), /public archive is absent/u);
		const wrongBytes = Buffer.from('pinned archivf');
		await assert.rejects(verifyAssistanceRuntimeBundles({ authority, archivesRoot: root,
			verify: ({ url, artifact }) => verifyMirroredArtifact({ url, artifact,
				fetchImpl: async (_url, init) => {
					const ranged = init.headers.Range === 'bytes=0-0';
					const body = ranged ? bytes.subarray(0, 1) : wrongBytes;
					const headers = { 'Access-Control-Allow-Origin': 'https://soundscaper.org',
						'Access-Control-Expose-Headers': 'Content-Length,Content-Range,ETag',
						'Content-Length': String(init.method === 'HEAD' ? bytes.length : body.length) };
					if (ranged) headers['Content-Range'] = `bytes 0-0/${bytes.length}`;
					return new Response(init.method === 'HEAD' ? null : body,
						{ status: ranged ? 206 : 200, headers });
				},
			}) }), /served.*not the recorded/u);
		await writeFile(join(root, bundles[0].familyId, '1.0.0/linux-x64', `${sha256}.tar.gz`), 'changed');
		await assert.rejects(verifyAssistanceRuntimeBundles({ authority, archivesRoot: root,
			verify: async () => { throw new Error('public verification must not run'); } }), /digest|length/u);
		await assert.rejects(publishAssistanceRuntimeBundles({ authority, archivesRoot: root,
			client: { bucket: 'soundscaper-assets', endpoint: new URL('https://example.eu.r2.cloudflarestorage.com') },
			upload: async () => { throw new Error('upload should not run'); }, verify: async () => {} }),
		/digest|length/u);
		const forged = structuredClone(JSON.parse(manifestBytes));
		forged.bundles[1].files[0].sha256 = 'c'.repeat(64);
		const forgedBytes = Buffer.from(JSON.stringify(forged));
		const forgedAuthority = { ...authority, manifestBytes: forgedBytes,
			receipt: { ...authority.receipt, manifest: { ...authority.receipt.manifest,
				byteLength: forgedBytes.length, sha256: hash(forgedBytes) } } };
		await assert.rejects(verifyAssistanceRuntimeBundles({ authority: forgedAuthority, archivesRoot: root,
			verify: async () => { throw new Error('public verification must not run'); } }),
		/authenticated source manifest/u);
		await assert.rejects(publishAssistanceRuntimeBundles({
			authority: forgedAuthority,
			archivesRoot: root,
			client: { bucket: 'soundscaper-assets', endpoint: new URL('https://example.eu.r2.cloudflarestorage.com') },
			upload: async () => { throw new Error('upload should not run'); }, verify: async () => {},
		}), /authenticated source manifest/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
