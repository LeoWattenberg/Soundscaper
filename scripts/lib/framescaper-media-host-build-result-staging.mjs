/* SPDX-License-Identifier: AGPL-3.0-only */

/** No-overwrite checkout staging for a verified media-host CI result. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import {
	FRAMESCAPER_MEDIA_HOST_STAGED_BUILD_RESULT_RECEIPT,
	verifyFramescaperMediaHostBuildResult,
} from './framescaper-media-host-build-result.mjs';
import {
	FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
	FRAMESCAPER_MEDIA_HOST_ROOT,
	FRAMESCAPER_MEDIA_HOST_SOURCE_MANIFEST,
	deriveFramescaperMediaHostPayloadManifest,
} from './framescaper-media-host-build.mjs';

const MAXIMUM_BYTES = 512 * 1024 * 1024;

export async function stageFramescaperMediaHostBuildResult(options) {
	const verified = await verifyFramescaperMediaHostBuildResult({
		buildResultRoot: options?.buildResultRoot,
	});
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	assertCheckoutRevision(repositoryRoot, verified.receipt.sourceRevision);
	const sourcePath = resolve(repositoryRoot, FRAMESCAPER_MEDIA_HOST_SOURCE_MANIFEST);
	const sourceBytes = await canonicalFile(sourcePath, 'media-host source manifest');
	if (sha256(sourceBytes) !== verified.receipt.sourceManifestSha256) {
		throw new Error('The media-host build result is not bound to this source manifest.');
	}
	const notices = await canonicalFile(resolve(
		repositoryRoot, FRAMESCAPER_MEDIA_HOST_ROOT, 'THIRD_PARTY_NOTICES.md',
	), 'media-host third-party notices');
	if (sha256(notices) !== verified.receipt.compliance.thirdPartyNoticesSha256
		|| String(notices) !== verified.receipt.compliance.thirdPartyNotices) {
		throw new Error('The media-host build result is not bound to this notice closure.');
	}
	const source = JSON.parse(String(sourceBytes));
	const current = source.targets?.[verified.receipt.target];
	if (!current || current.status !== 'ci-generated' || current.blockedBy !== null
		|| current.toolchainIdentity !== null || current.payload !== null
		|| current.isolationPayload !== null || current.buildResult !== null) {
		throw new Error('Only one exact CI-generated media-host target can be staged.');
	}
	const targetRelative = `${FRAMESCAPER_MEDIA_HOST_ROOT}/prebuilt/${verified.receipt.target}`;
	const targetRoot = resolve(repositoryRoot, targetRelative);
	await assertMissing(targetRoot);
	await mkdir(dirname(targetRoot), { recursive: true, mode: 0o700 });
	await mkdir(targetRoot, { mode: 0o700 });
	let published = false;
	try {
		const staged = await stageResultFiles(verified, repositoryRoot, targetRelative);
		const stagedReceiptPath = `${targetRelative}/${FRAMESCAPER_MEDIA_HOST_STAGED_BUILD_RESULT_RECEIPT}`;
		await writeFile(resolve(repositoryRoot, stagedReceiptPath), verified.receiptBytes,
			{ flag: 'wx', mode: 0o444 });
		const buildResult = descriptor(stagedReceiptPath, verified.receiptBytes);
		const updatedSource = structuredClone(source);
		updatedSource.targets[verified.receipt.target] = {
			runtime: verified.receipt.runtime,
			status: 'built',
			blockedBy: null,
			toolchainIdentity: verified.receipt.toolchainIdentity,
			buildResult,
			payload: staged.payload,
			isolationPayload: staged.isolationPayload,
		};
		await publishManifests({
			repositoryRoot, sourcePath, sourceBytes, source: updatedSource,
			payload: deriveFramescaperMediaHostPayloadManifest(updatedSource),
		});
		published = true;
		return Object.freeze({ status: 'staged', target: verified.receipt.target, buildResult });
	} finally {
		if (!published) await rm(targetRoot, { recursive: true, force: true });
	}
}

async function stageResultFiles(verified, repositoryRoot, targetRelative) {
	const { receipt, buildResultRoot } = verified;
	const suffix = receipt.target.startsWith('win-') ? '.exe' : '';
	const mappings = [
		[receipt.payload, `${targetRelative}/framescaper-media-host${suffix}`, 0o555],
		[receipt.isolation.launcher,
			`${targetRelative}/isolation/milestone5-native-isolation-launcher${suffix}`, 0o555],
		[receipt.isolation.profile,
			`${targetRelative}/isolation/milestone5-native-isolation-profile.json`, 0o444],
		[receipt.isolation.broker,
			`${targetRelative}/isolation/milestone5-native-isolation-broker.json`, 0o444],
		...receipt.isolation.runtimeLibraries.map((entry) => [
			entry, `${targetRelative}/lib/${basename(entry.path)}`, 0o444,
		]),
	];
	const staged = [];
	for (const [source, path, mode] of mappings) {
		const output = resolve(repositoryRoot, ...path.split('/'));
		await mkdir(dirname(output), { recursive: true, mode: 0o700 });
		await copyFile(resolve(buildResultRoot, ...source.path.split('/')), output, 1);
		await chmod(output, mode);
		staged.push(descriptor(path, await canonicalFile(output, `staged ${basename(path)}`)));
	}
	return {
		payload: staged[0],
		isolationPayload: {
			launcherPayload: staged[1],
			sandboxProfilePayload: staged[2],
			brokerPolicyPayload: staged[3],
			runtimeLibraryPayloads: staged.slice(4),
		},
	};
}

async function publishManifests({ repositoryRoot, sourcePath, sourceBytes, source, payload }) {
	const payloadPath = resolve(repositoryRoot, FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST);
	const payloadBefore = await canonicalFile(payloadPath, 'media-host payload manifest');
	const suffix = `.media-result-${process.pid}-${Date.now()}`;
	const sourceTemp = `${sourcePath}${suffix}`;
	const payloadTemp = `${payloadPath}${suffix}`;
	try {
		await writeFile(sourceTemp, canonicalJson(source), { flag: 'wx', mode: 0o644 });
		await writeFile(payloadTemp, canonicalJson(payload), { flag: 'wx', mode: 0o644 });
		if (!(await canonicalFile(sourcePath, 'media-host source manifest')).equals(sourceBytes)
			|| !(await canonicalFile(payloadPath, 'media-host payload manifest')).equals(payloadBefore)) {
			throw new Error('A media-host manifest changed while staging was prepared.');
		}
		await rename(sourceTemp, sourcePath);
		await rename(payloadTemp, payloadPath);
	} finally {
		await rm(sourceTemp, { force: true });
		await rm(payloadTemp, { force: true });
	}
}

function assertCheckoutRevision(root, expected) {
	const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
		cwd: root, encoding: 'utf8', shell: false, maxBuffer: 1024 * 1024,
	});
	if (result.status !== 0 || result.stdout.trim() !== expected) {
		throw new Error('The media-host build result is not for this checkout revision.');
	}
}

async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be absolute and normalized.`);
	}
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(value) !== value) {
		throw new Error(`The ${label} must be one canonical directory.`);
	}
	return value;
}

async function canonicalFile(path, label) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 1 || before.size > MAXIMUM_BYTES) {
		throw new Error(`The ${label} must be one bounded canonical file.`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} changed while being read.`);
	}
	return bytes;
}

async function assertMissing(path) {
	try { await lstat(path); }
	catch (error) { if (error?.code === 'ENOENT') return; throw error; }
	throw new Error('The media-host target root already exists.');
}

function descriptor(path, bytes) {
	return Object.freeze({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}
function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
