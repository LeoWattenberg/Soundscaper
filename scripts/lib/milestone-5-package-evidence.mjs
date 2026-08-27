/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import {
	lstat, mkdtemp, open, readFile, readdir, realpath, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	basename, dirname, isAbsolute, join, relative, resolve, sep,
} from 'node:path';

import {
	desktopReleaseTargetPackageInventory,
	regularDesktopReleaseFileNames,
	validateDesktopRuntimeManifests,
} from '../desktop-release-assets.mjs';
import { auditDesktopPackageArtifactContent } from './desktop-package-artifact-extractor.mjs';
import {
	completeMilestone5PackageReleaseAuthentication,
	MILESTONE_5_PACKAGE_RELEASE_AUTHENTICATION_POLICY,
	milestone5PackageReleaseAuthenticationEvidenceName,
	preauthenticateMilestone5PackageReleaseAuthentication,
} from './milestone-5-package-release-authentication.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const AUDITED_PACKAGE_EVIDENCE = new WeakSet();
const OPTION_FIELDS = Object.freeze([
	'repositoryRoot', 'packageRoot', 'productId', 'targetId',
]);
const PACKAGE_FILE_PATTERN = /\.(?:appimage|deb|dmg|exe|zip)$/iu;
const RUNTIME_MANIFEST_PATTERN = /^runtime-manifest-.+\.json$/iu;
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAXIMUM_RUNTIME_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAXIMUM_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * Authenticate one isolated product/target package root. The returned object is
 * an in-process authority: serialize it for evidence, but re-audit the files to
 * regain authority in another process.
 */
export async function auditMilestone5PackageEvidence(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'Milestone 5 package-evidence options'),
		OPTION_FIELDS,
		'Milestone 5 package-evidence options',
	);
	const repositoryRoot = absoluteRoot(options.repositoryRoot, 'repositoryRoot');
	const packageRoot = absoluteRoot(options.packageRoot, 'packageRoot');
	const productId = boundedString(options.productId, 1, 40, 'package-evidence productId');
	const targetId = boundedString(options.targetId, 1, 40, 'package-evidence targetId');
	const auditPackageArtifactContent = dependencies.auditPackageArtifactContent
		?? auditDesktopPackageArtifactContent;
	// The shared inventory is the target/product vocabulary authority. Calling it
	// before composing a file name keeps untrusted identities out of path logic.
	desktopReleaseTargetPackageInventory(productId, targetId, 'identity-probe');

	const rootStats = await lstat(packageRoot);
	if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
		throw new Error('Milestone 5 package root must be a regular non-symbolic directory.');
	}
	const canonicalRoot = await realpath(packageRoot);
	const entries = await readdir(packageRoot, { withFileTypes: true });
	const rootNames = regularDesktopReleaseFileNames(entries);
	const manifestName = `runtime-manifest-${productId}-${targetId}.json`;
	const runtimeNames = rootNames.filter((name) => RUNTIME_MANIFEST_PATTERN.test(name));
	if (runtimeNames.length !== 1 || runtimeNames[0] !== manifestName) {
		throw new Error(`Milestone 5 package root must contain the one exact runtime manifest ${manifestName}.`);
	}
	const runtimeFile = await readAndDescribeRegularFile({
		canonicalRoot,
		label: 'Milestone 5 staged runtime manifest',
		maximumBytes: MAXIMUM_RUNTIME_MANIFEST_BYTES,
		name: manifestName,
		packageRoot,
		retainBytes: true,
	});
	const manifest = parseJson(runtimeFile.bytes, manifestName);
	const canonicalManifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	if (!runtimeFile.bytes.equals(canonicalManifestBytes)) {
		throw new Error('Milestone 5 staged runtime manifest is not the exact canonical staged JSON.');
	}
	if (manifest.schemaVersion !== 1) {
		throw new Error('Milestone 5 staged runtime manifest schemaVersion must be 1.');
	}
	const applicationVersion = boundedString(
		manifest.applicationVersion,
		1,
		160,
		'Milestone 5 staged runtime manifest applicationVersion',
	);
	if (!Object.hasOwn(manifest, 'sourceRevision')
		|| (manifest.sourceRevision !== null && !SOURCE_REVISION.test(String(manifest.sourceRevision)))) {
		throw new Error('Milestone 5 staged runtime manifest source revision is invalid.');
	}
	const sourceRevision = manifest.sourceRevision;
	validateDesktopRuntimeManifests([{ name: manifestName, value: manifest }]);
	const projectPackage = parseJson(
		await readFile(resolve(repositoryRoot, 'package.json')),
		'project package metadata',
	);
	if (projectPackage.version !== applicationVersion) {
		throw new Error('Milestone 5 staged runtime manifest application version disagrees with the project package.');
	}

	const targetInventory = desktopReleaseTargetPackageInventory(
		productId,
		targetId,
		applicationVersion,
	);
	const packageNames = rootNames.filter((name) => PACKAGE_FILE_PATTERN.test(name));
	const selected = targetInventory.map(({ label, pattern }) => {
		const matches = packageNames.filter((name) => pattern.test(name));
		if (matches.length !== 1) {
			throw new Error(`Milestone 5 package root expected exactly one ${label}.`);
		}
		return { label, name: matches[0] };
	});
	if (packageNames.length !== selected.length) {
		const expected = new Set(selected.map(({ name }) => name));
		const unexpected = packageNames.filter((name) => !expected.has(name));
		throw new Error(`Milestone 5 package root contains unexpected packaged files: ${unexpected.join(', ') || '<duplicate>'}.`);
	}
	const releaseAuthenticationName = milestone5PackageReleaseAuthenticationEvidenceName(
		productId,
		targetId,
	);
	const expectedRootNames = new Set([
		manifestName,
		...selected.map(({ name }) => name),
		...(rootNames.includes(releaseAuthenticationName) ? [releaseAuthenticationName] : []),
	]);
	const unexpectedRootNames = rootNames.filter((name) => !expectedRootNames.has(name));
	if (rootNames.length !== expectedRootNames.size || unexpectedRootNames.length > 0) {
		throw new Error(`Milestone 5 package root has foreign entries: ${unexpectedRootNames.join(', ') || '<duplicate>'}.`);
	}
	const snapshotRoot = await mkdtemp(join(tmpdir(), 'm5-package-snapshot-'));
	const canonicalSnapshotRoot = await realpath(snapshotRoot);
	const packages = [];
	try {
		for (const { label, name } of selected) {
			const snapshotPath = resolve(snapshotRoot, name);
			const file = await readAndDescribeRegularFile({
				canonicalRoot,
				label: `Milestone 5 ${label}`,
				maximumBytes: MAXIMUM_PACKAGE_BYTES,
				name,
				packageRoot,
				retainBytes: false,
				snapshotPath,
			});
			packages.push({
				label,
				name,
				byteLength: file.byteLength,
				sha256: file.sha256,
				content: null,
			});
		}
		let preauthentication;
		try {
			preauthentication = await preauthenticateMilestone5PackageReleaseAuthentication({
				repositoryRoot,
				packageRoot,
				productId,
				targetId,
				applicationVersion,
				sourceRevision,
				packages,
				...(dependencies.releaseAuthenticationPolicyBytes === undefined
					? {} : { policyBytes: dependencies.releaseAuthenticationPolicyBytes }),
			});
		} catch (error) {
			preauthentication = await invalidReleaseAuthenticationObservation({
				error,
				repositoryRoot,
				packageRoot,
				canonicalRoot,
				releaseAuthenticationName,
				policyBytes: dependencies.releaseAuthenticationPolicyBytes,
			});
		}
		for (const descriptor of packages) {
			const snapshotPath = resolve(snapshotRoot, descriptor.name);
			const content = await auditPackageArtifactContent({
				packagePath: snapshotPath,
				repositoryRoot,
				runtimeManifestBytes: runtimeFile.bytes,
				productId,
				targetId,
			});
			const after = await readAndDescribeRegularFile({
				canonicalRoot: canonicalSnapshotRoot,
				label: `Milestone 5 authenticated ${descriptor.label} snapshot`,
				maximumBytes: MAXIMUM_PACKAGE_BYTES,
				name: descriptor.name,
				packageRoot: snapshotRoot,
				retainBytes: false,
			});
			if (after.byteLength !== descriptor.byteLength || after.sha256 !== descriptor.sha256) {
				throw new Error(`Milestone 5 ${descriptor.label} snapshot changed during content extraction.`);
			}
			descriptor.content = packageContentSummary(content);
		}
		const [firstContent, ...otherContent] = packages.map(({ content }) => content);
		if (otherContent.some((content) => content.closureSha256 !== firstContent.closureSha256
			|| content.contentManifestSha256 !== firstContent.contentManifestSha256
			|| content.installedClosureSha256 !== firstContent.installedClosureSha256
			|| content.fileCount !== firstContent.fileCount || content.totalBytes !== firstContent.totalBytes
			|| content.installedFileCount !== firstContent.installedFileCount
			|| content.installedTotalBytes !== firstContent.installedTotalBytes)) {
			throw new Error('Milestone 5 target package formats contain different installed application closures.');
		}
		const releaseAuthentication = preauthentication.status !== 'authenticated-preflight'
			? preauthentication
			: completeMilestone5PackageReleaseAuthentication({ preauthentication, packages });
		return packageAudit({
			status: releaseAuthentication.status === 'authenticated'
				? 'installed-application-closure-audited'
				: releaseAuthentication.status === 'pending-external'
					? 'release-authentication-pending'
					: 'release-authentication-invalid-report-only',
			releaseAuthentication,
			productId,
			targetId,
			applicationVersion,
			sourceRevision,
			manifest,
			manifestName,
			runtimeFile,
			packages,
		});
	} finally {
		await rm(snapshotRoot, { recursive: true, force: true });
	}
}

async function invalidReleaseAuthenticationObservation({
	error,
	repositoryRoot,
	packageRoot,
	canonicalRoot,
	releaseAuthenticationName,
	policyBytes: suppliedPolicyBytes,
}) {
	const policyBytes = suppliedPolicyBytes === undefined
		? await readFile(resolve(repositoryRoot, MILESTONE_5_PACKAGE_RELEASE_AUTHENTICATION_POLICY))
		: Buffer.from(suppliedPolicyBytes);
	const evidence = await lstat(resolve(packageRoot, releaseAuthenticationName))
		.then(() => readAndDescribeRegularFile({
			canonicalRoot,
			label: 'Milestone 5 report-only package release authentication',
			maximumBytes: 1024 * 1024,
			name: releaseAuthenticationName,
			packageRoot,
			retainBytes: false,
		}))
		.catch((readError) => {
			if (readError.code === 'ENOENT') return null;
			throw readError;
		});
	return deepFreeze({
		status: 'invalid-report-only',
		blockedBy: error instanceof Error ? error.message : String(error),
		evidence: evidence === null ? null : {
			name: releaseAuthenticationName,
			byteLength: evidence.byteLength,
			sha256: evidence.sha256,
		},
		policyEvidence: {
			name: MILESTONE_5_PACKAGE_RELEASE_AUTHENTICATION_POLICY,
			byteLength: policyBytes.byteLength,
			sha256: createHash('sha256').update(policyBytes).digest('hex'),
		},
	});
}

function packageAudit({
	status,
	releaseAuthentication,
	productId,
	targetId,
	applicationVersion,
	sourceRevision,
	manifest,
	manifestName,
	runtimeFile,
	packages: packageDescriptors,
}) {
	const automatedEvidence = {
		schemaVersion: 1,
		productId,
		targetId,
		applicationVersion,
		sourceRevision,
		runtimeManifest: {
			name: manifestName,
			byteLength: runtimeFile.byteLength,
			sha256: runtimeFile.sha256,
		},
		packages: packageDescriptors.map((descriptor) => ({
			label: descriptor.label,
			name: descriptor.name,
			byteLength: descriptor.byteLength,
			sha256: descriptor.sha256,
			content: descriptor.content,
		})),
	};
	const audit = deepFreeze({
		schemaVersion: 1,
		status,
		automatedStatus: 'installed-application-closure-audited',
		automatedEvidenceSha256: createHash('sha256')
			.update(JSON.stringify(automatedEvidence)).digest('hex'),
		releaseAuthentication,
		productId,
		targetId,
		applicationVersion,
		sourceRevision,
		runtimeManifest: {
			name: manifestName,
			byteLength: runtimeFile.byteLength,
			sha256: runtimeFile.sha256,
			value: manifest,
		},
		desktopCodecPolicy: manifest.desktopCodecPolicy,
		packages: packageDescriptors,
		packageCount: packageDescriptors.length,
		totalPackageBytes: packageDescriptors.reduce(
			(total, descriptor) => total + descriptor.byteLength,
			0,
		),
	});
	AUDITED_PACKAGE_EVIDENCE.add(audit);
	return audit;
}

function packageContentSummary(content) {
	return {
		status: content.status,
		productId: content.productId,
		targetId: content.targetId,
		applicationVersion: content.applicationVersion,
		sourceRevision: content.sourceRevision,
		fileCount: content.fileCount,
		totalBytes: content.totalBytes,
		closureSha256: content.closureSha256,
		contentManifestByteLength: content.contentManifestByteLength,
		contentManifestSha256: content.contentManifestSha256,
		installedFileCount: content.installedFileCount,
		installedTotalBytes: content.installedTotalBytes,
		installedClosureSha256: content.installedClosureSha256,
	};
}

export function isAuditedMilestone5PackageEvidence(value) {
	return value !== null && typeof value === 'object' && AUDITED_PACKAGE_EVIDENCE.has(value);
}

async function readAndDescribeRegularFile({
	canonicalRoot,
	label,
	maximumBytes,
	name,
	packageRoot,
	retainBytes,
	snapshotPath = null,
}) {
	if (typeof name !== 'string' || basename(name) !== name || name.includes('/') || name.includes('\\')) {
		throw new Error(`${label} name is not one direct package-root file.`);
	}
	const path = resolve(packageRoot, name);
	if (dirname(path) !== packageRoot) throw new Error(`${label} path leaves its package root.`);
	const before = await lstat(path);
	if (before.isSymbolicLink() || !before.isFile()) {
		throw new Error(`${label} must be a regular non-symbolic file.`);
	}
	if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximumBytes) {
		throw new Error(`${label} byte length is outside the accepted range.`);
	}
	const canonicalPath = await realpath(path);
	if (!isContainedDirectFile(canonicalRoot, canonicalPath)) {
		throw new Error(`${label} real path is not contained by its package root.`);
	}
	let handle;
	let snapshotHandle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		if (snapshotPath !== null) {
			if (!isAbsolute(snapshotPath) || resolve(snapshotPath) !== snapshotPath) {
				throw new TypeError(`${label} snapshot path must be absolute and normalized.`);
			}
			snapshotHandle = await open(
				snapshotPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
				0o400,
			);
		}
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`${label} changed while it was being opened.`);
		}
		let bytes = null;
		let byteLength = 0;
		const hash = createHash('sha256');
		if (retainBytes) {
			bytes = await handle.readFile();
			byteLength = bytes.byteLength;
			hash.update(bytes);
		} else {
			const stream = handle.createReadStream({ autoClose: false });
			for await (const chunk of stream) {
				byteLength += chunk.byteLength;
				if (byteLength > maximumBytes) throw new Error(`${label} exceeds its byte limit.`);
				hash.update(chunk);
				if (snapshotHandle) await writeAll(snapshotHandle, chunk);
			}
		}
		const after = await handle.stat();
		if (byteLength !== before.size || after.size !== before.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
			throw new Error(`${label} changed while it was being hashed.`);
		}
		if (snapshotHandle) {
			await snapshotHandle.sync();
			const snapshot = await snapshotHandle.stat();
			if (!snapshot.isFile() || snapshot.size !== byteLength) {
				throw new Error(`${label} snapshot did not retain the authenticated bytes.`);
			}
		}
		return {
			byteLength,
			sha256: hash.digest('hex'),
			...(bytes === null ? {} : { bytes }),
		};
	} finally {
		await snapshotHandle?.close();
		await handle?.close();
	}
}

async function writeAll(handle, bytes) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
		if (bytesWritten < 1) throw new Error('Milestone 5 package snapshot write made no progress.');
		offset += bytesWritten;
	}
}

function absoluteRoot(value, field) {
	const path = boundedString(value, 1, 4_096, `Milestone 5 package-evidence ${field}`);
	if (!isAbsolute(path) || resolve(path) !== path) {
		throw new Error(`Milestone 5 package-evidence ${field} must be one canonical absolute path.`);
	}
	return path;
}

function isContainedDirectFile(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`)
		&& !isAbsolute(path) && !path.includes(sep);
}

function parseJson(bytes, label) {
	try {
		return snapshotStrictJsonData(JSON.parse(bytes.toString('utf8')), label);
	} catch (error) {
		throw new Error(`${label} must contain strict valid JSON.`, { cause: error });
	}
}
