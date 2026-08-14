/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	snapshotVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from './ffmpeg-runtime-manifest.mjs';

export async function publishFfmpegRuntime({
	repositoryRoot,
	executeWrangler,
	loadRelease,
} = {}) {
	const release = await (loadRelease
		? loadRelease()
		: verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' }));
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
	assert(release.manifest.authorizations.runtimePublication.status === 'approved',
		`runtime publication is blocked by ${release.manifest.authorizations.runtimePublication.blockedBy.join(', ')}`);
	const execute = executeWrangler ?? createWranglerExecutor(repositoryRoot);
	const basePrefix = release.manifest.runtime.publicPrefix;
	const prefix = `${basePrefix}/releases/${release.manifestSha256}`;
	const bucket = release.manifest.publication.bucket;
	const jurisdiction = release.manifest.publication.jurisdiction ?? null;
	const objects = [
		...snapshot.runtimeFiles.map((file) => ({
			key: `${prefix}/${file.name}`,
			bytes: file.bytes,
			contentType: file.contentType,
		})),
		{
			key: `${prefix}/${release.manifest.publication.noticeName}`,
			bytes: snapshot.evidence.notices.bytes,
			contentType: 'text/markdown; charset=utf-8',
		},
		{
			key: `${prefix}/${release.manifest.publication.correspondingSourceName}`,
			bytes: snapshot.evidence.correspondingSource.bytes,
			contentType: 'application/json; charset=utf-8',
		},
		{
			key: `${prefix}/${release.manifest.publication.manifestName}`,
			bytes: snapshot.manifestBytes,
			contentType: 'application/json; charset=utf-8',
		},
	];
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-runtime-cors-'));
	try {
		const corsPath = resolve(temporaryRoot, 'r2-cors.json');
		await mkdir(temporaryRoot, { recursive: true });
		await writeFile(corsPath, snapshot.corsBytes, { flag: 'wx' });
		assertCommandSucceeded(execute({ kind: 'cors', bucket, jurisdiction, file: corsPath }), 'apply runtime CORS policy');
		for (const object of objects) {
			assertCommandSucceeded(execute({
				kind: 'put',
				bucket,
				jurisdiction,
				...object,
				cacheControl: release.manifest.runtime.cacheControl,
			}), `upload ${object.key}`);
		}
		const pointer = runtimePointer(release, prefix);
		assertCommandSucceeded(execute({
			kind: 'put',
			bucket,
			jurisdiction,
			key: `${basePrefix}/latest.json`,
			bytes: pointer,
			contentType: 'application/json; charset=utf-8',
			cacheControl: 'no-store',
		}), 'publish runtime release pointer');
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
	return { objectCount: objects.length + 1, manifestSha256: release.manifestSha256 };
}

function runtimePointer(release, releasePrefix) {
	return Buffer.from(`${JSON.stringify({
		schemaVersion: 1,
		releaseId: release.manifestSha256,
		manifest: {
			path: `${releasePrefix}/${release.manifest.publication.manifestName}`,
			byteLength: release.manifestBytes.byteLength,
			sha256: release.manifestSha256,
		},
		files: Object.fromEntries(release.runtimeFiles.map((file) => [file.name, {
			path: `${releasePrefix}/${file.name}`,
			byteLength: file.byteLength,
			sha256: file.sha256,
		}])),
	}, null, 2)}\n`);
}

function createWranglerExecutor(repositoryRoot) {
	const root = resolve(repositoryRoot);
	const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
	// A jurisdiction-scoped bucket is invisible to a request that does not name
	// its jurisdiction, and reports itself as missing rather than as forbidden.
	const jurisdictionArguments = (jurisdiction) => (jurisdiction ? ['--jurisdiction', jurisdiction] : []);
	return (command) => {
		if (command.kind === 'put') {
			return spawnSync(process.execPath, [
				wrangler, 'r2', 'object', 'put', `${command.bucket}/${command.key}`,
				'--pipe',
				'--content-type', command.contentType,
				'--cache-control', command.cacheControl,
				'--remote',
				...jurisdictionArguments(command.jurisdiction),
			], {
				cwd: root,
				input: command.bytes,
				stdio: ['pipe', 'inherit', 'inherit'],
			});
		}
		return spawnSync(process.execPath, [
			wrangler, 'r2', 'bucket', 'cors', 'set', command.bucket,
			'--file', command.file,
			...jurisdictionArguments(command.jurisdiction),
		], { cwd: root, stdio: 'inherit' });
	};
}

function assertCommandSucceeded(result, label) {
	if (result?.error) throw result.error;
	if (result?.status !== 0) throw new Error(`Failed to ${label}: Wrangler exited with ${result?.status ?? 'no status'}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
