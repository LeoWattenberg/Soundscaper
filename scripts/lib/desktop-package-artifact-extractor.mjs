/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native-platform, non-executing extraction of one desktop release artifact. */

import { execFile } from 'node:child_process';
import {
	lstat, mkdtemp, open, readdir, realpath, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	basename, extname, isAbsolute, join, resolve,
} from 'node:path';
import { promisify } from 'node:util';

import { auditExtractedDesktopPackageContent } from './desktop-package-content-manifest.mjs';

const executeFile = promisify(execFile);
const MAXIMUM_TOOL_OUTPUT = 1024 * 1024;
const EXTRACTION_TIMEOUT_MS = 5 * 60_000;

export async function auditDesktopPackageArtifactContent({
	packagePath,
	repositoryRoot,
	runtimeManifestBytes,
	productId,
	targetId,
}, dependencies = {}) {
	const artifact = await canonicalFile(packagePath, 'desktop package artifact');
	const root = await canonicalDirectory(repositoryRoot, 'desktop package repository root');
	const extension = extname(artifact).toLowerCase();
	assertFormatTarget(extension, targetId);
	const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'm5-package-extract-')));
	try {
		if (extension === '.dmg') {
			if (process.platform === 'darwin') {
				return await withMountedDmg(artifact, async (mountedRoot) => (
					auditExtractedDesktopPackageContent({
						extractedRoot: mountedRoot,
						packageFormat: extension,
						runtimeManifestBytes,
						productId,
						targetId,
					}, dependencies)
				));
			}
			const extractedRoot = join(temporaryRoot, 'content');
			const extractedVolumeRoot = await extractDmgWithSevenZip({
				artifact,
				extractedRoot,
				productId,
				sevenZip: await sevenZipExecutable(root),
				targetId,
			});
			return await auditExtractedDesktopPackageContent({
				extractedRoot: extractedVolumeRoot,
				packageFormat: extension,
				runtimeManifestBytes,
				productId,
				targetId,
			}, dependencies);
		}
		const extractedRoot = join(temporaryRoot, 'content');
		if (extension === '.appimage') {
			const offset = await appImageSquashfsOffset(artifact, targetId);
			await run('unsquashfs', [
				'-no-progress', '-offset', String(offset), '-d', extractedRoot, artifact,
			], 'AppImage extraction');
		} else if (extension === '.deb') {
			await run('dpkg-deb', ['--extract', artifact, extractedRoot], 'Debian package extraction');
		} else {
			const sevenZip = await sevenZipExecutable(root);
			await run(sevenZip, ['x', '-y', '-bd', `-o${extractedRoot}`, artifact],
				extension === '.exe' ? 'NSIS extraction' : 'ZIP extraction');
			if (extension === '.exe') {
				const nested = await findFiles(extractedRoot, (name) => /app-(?:32|64|arm64)\.7z$/iu.test(name));
				if (nested.length !== 1) {
					throw new Error(`The NSIS package must contain one application archive; found ${nested.length}.`);
				}
				const applicationRoot = join(temporaryRoot, 'application');
				await run(sevenZip, ['x', '-y', '-bd', `-o${applicationRoot}`, nested[0]],
					'NSIS application extraction');
				return await auditExtractedDesktopPackageContent({
					extractedRoot: applicationRoot,
					packageFormat: extension,
					runtimeManifestBytes,
					productId,
					targetId,
				}, dependencies);
			}
		}
		return await auditExtractedDesktopPackageContent({
			extractedRoot,
			packageFormat: extension,
			runtimeManifestBytes,
			productId,
			targetId,
		}, dependencies);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function appImageSquashfsOffset(path, targetId = null) {
	let handle;
	try {
		handle = await open(path, 'r');
		const metadata = await handle.stat();
		const header = Buffer.alloc(64);
		const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
		if (bytesRead !== header.byteLength || header[0] !== 0x7f
			|| header.subarray(1, 4).toString('ascii') !== 'ELF'
			|| header.subarray(8, 11).toString('latin1') !== 'AI\x02') {
			throw new Error('The AppImage has no ELF/AppImage type-2 header.');
		}
		const elfClass = header[4];
		const byteOrder = header[5];
		if (![1, 2].includes(elfClass) || ![1, 2].includes(byteOrder)) {
			throw new Error('The AppImage ELF class or byte order is unsupported.');
		}
		if (targetId !== null) {
			const expectedMachine = targetId === 'linux-x64' ? 62
				: targetId === 'linux-arm64' ? 183 : null;
			if (expectedMachine === null || elfClass !== 2 || byteOrder !== 1
				|| header.readUInt16LE(18) !== expectedMachine) {
				throw new Error('The AppImage runtime has the wrong target architecture.');
			}
		}
		const littleEndian = byteOrder === 1;
		const sectionOffset = elfClass === 2
			? unsigned64(header, 40, littleEndian)
			: unsigned32(header, 32, littleEndian);
		const sectionEntrySize = unsigned16(header, elfClass === 2 ? 58 : 46, littleEndian);
		const sectionCount = unsigned16(header, elfClass === 2 ? 60 : 48, littleEndian);
		const minimumEntrySize = elfClass === 2 ? 64 : 40;
		const offset = sectionOffset + sectionEntrySize * sectionCount;
		if (!Number.isSafeInteger(offset) || sectionOffset < header.byteLength
			|| sectionEntrySize < minimumEntrySize || sectionCount < 1
			|| offset > metadata.size - 96) {
			throw new Error('The AppImage ELF section table does not locate a bounded payload.');
		}
		const squashfs = Buffer.alloc(96);
		const payloadRead = await handle.read(squashfs, 0, squashfs.byteLength, offset);
		const blockSize = unsigned32(squashfs, 12, true);
		const blockLog = unsigned16(squashfs, 22, true);
		const bytesUsed = unsigned64(squashfs, 40, true);
		if (payloadRead.bytesRead !== squashfs.byteLength
			|| squashfs.subarray(0, 4).toString('ascii') !== 'hsqs'
			|| unsigned32(squashfs, 4, true) < 1
			|| blockSize < 4_096 || blockSize > 1024 * 1024
			|| blockSize !== 2 ** blockLog
			|| unsigned16(squashfs, 20, true) < 1 || unsigned16(squashfs, 20, true) > 6
			|| unsigned16(squashfs, 26, true) < 1
			|| unsigned16(squashfs, 28, true) !== 4 || unsigned16(squashfs, 30, true) !== 0
			|| bytesUsed < squashfs.byteLength || bytesUsed > metadata.size - offset) {
			throw new Error('The AppImage ELF-derived offset has no bounded SquashFS v4 payload.');
		}
		return offset;
	} finally {
		await handle?.close();
	}
}

function unsigned16(bytes, offset, littleEndian) {
	return littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
}

function unsigned32(bytes, offset, littleEndian) {
	return littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
}

function unsigned64(bytes, offset, littleEndian) {
	const value = littleEndian ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN;
	return Number(value);
}

async function withMountedDmg(artifact, operation) {
	const { stdout } = await run('hdiutil', [
		'attach', '-readonly', '-nobrowse', '-noverify', '-plist', artifact,
	], 'DMG attachment');
	const mountPoints = [...stdout.matchAll(
		/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/gu,
	)].map((match) => decodeXml(match[1]));
	if (mountPoints.length !== 1 || !isAbsolute(mountPoints[0])) {
		throw new Error('The DMG attachment did not produce one mounted volume.');
	}
	const mountedRoot = await realpath(mountPoints[0]);
	try {
		return await operation(mountedRoot);
	} finally {
		await run('hdiutil', ['detach', mountedRoot], 'DMG detachment');
	}
}

async function sevenZipExecutable(repositoryRoot) {
	if (process.platform !== 'win32') return '7z';
	const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
	const path = resolve(repositoryRoot, `node_modules/electron-winstaller/vendor/7z-${architecture}.exe`);
	await canonicalFile(path, 'bundled 7-Zip extractor');
	return path;
}

async function findFiles(root, predicate) {
	const matches = [];
	let visited = 0;
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			visited += 1;
			if (visited > 100_000) throw new Error('The extracted package inventory exceeds its limit.');
			if (entry.isSymbolicLink()) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && predicate(entry.name)) matches.push(path);
		}
	}
	await visit(root);
	return matches;
}

export async function extractDmgWithSevenZip({
	artifact, extractedRoot, productId, sevenZip, targetId,
}, { execute = executeFile } = {}) {
	const { applicationsLinkPath, volumeName } = expectedDmgExtractionLayout({
		artifact, productId, targetId,
	});
	// electron-builder DMGs carry one volume-root Applications -> /Applications
	// alias. Authenticate its archive record and bytes before excluding that link.
	const listing = await run(sevenZip, [
		'l', '-slt', '-bd', '-spd', artifact, applicationsLinkPath,
	], 'DMG Applications alias listing', { execute });
	assertExpectedDmgApplicationsAliasListing(listing, applicationsLinkPath);
	const link = await run(sevenZip, [
		'e', '-so', '-bd', '-spd', artifact, applicationsLinkPath,
	], 'DMG Applications alias inspection', { execute });
	if (link.stderr !== '' || link.stdout !== '/Applications') {
		throw new Error('The DMG Applications alias does not target /Applications exactly.');
	}
	// Match a mounted filesystem view: HFS alternate streams are metadata, not
	// colon-suffixed installed files. Every other unsafe link still fails 7-Zip.
	const extraction = await run(sevenZip, [
		'x', '-y', '-bd', '-sns-', '-spd', `-x!${applicationsLinkPath}`,
		`-o${extractedRoot}`, artifact,
	], 'DMG extraction', { execute });
	assertSuccessfulDmgExtraction(extraction);
	return extractedDmgVolumeRoot(extractedRoot, volumeName);
}

function expectedDmgExtractionLayout({ artifact, productId, targetId }) {
	if (targetId !== 'mac-arm64' || typeof artifact !== 'string') {
		throw new Error('The DMG extraction target is invalid.');
	}
	const productName = productId === 'soundscaper' ? 'Soundscaper'
		: productId === 'framescaper' ? 'Framescaper' : null;
	if (productName === null) throw new Error('The DMG extraction product is invalid.');
	const name = basename(artifact);
	const prefix = `${productName}-`;
	const suffix = '-mac-arm64.dmg';
	if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
		throw new Error('The DMG artifact name does not bind its product and target.');
	}
	const version = name.slice(prefix.length, -suffix.length);
	if (!/^[\w][\w.+-]{0,159}$/u.test(version)) {
		throw new Error('The DMG artifact name has an invalid application version.');
	}
	const volumeName = `${productName} ${version}-arm64`;
	return { applicationsLinkPath: `${volumeName}/Applications`, volumeName };
}

function assertExpectedDmgApplicationsAliasListing(result, applicationsLinkPath) {
	const stdout = quietSevenZipOutput(result, 'DMG Applications alias listing');
	const marker = '\n----------\n';
	const markerIndex = stdout.indexOf(marker);
	if (markerIndex < 0 || markerIndex !== stdout.lastIndexOf(marker)) {
		throw new Error('The DMG Applications alias listing has invalid archive structure.');
	}
	const headerLines = stdout.slice(0, markerIndex).split('\n');
	if (!headerLines.includes('Type = Dmg') || !headerLines.includes('Type = HFS')) {
		throw new Error('The DMG Applications alias listing has invalid archive structure.');
	}
	const inventory = stdout.slice(markerIndex + marker.length).replace(/\n+$/u, '');
	const blocks = inventory.split(/\n\n+/u);
	if (blocks.length !== 1) {
		throw new Error('The DMG Applications alias listing did not select exactly one entry.');
	}
	const properties = new Map();
	for (const line of blocks[0].split('\n')) {
		const match = /^([^=]+) = (.*)$/u.exec(line);
		if (match === null || properties.has(match[1])) {
			throw new Error('The DMG Applications alias listing has ambiguous properties.');
		}
		properties.set(match[1], match[2]);
	}
	if (properties.get('Path') !== applicationsLinkPath
		|| properties.get('Folder') !== '-'
		|| properties.get('Size') !== '13'
		|| properties.get('Mode') !== 'lrwxr-xr-x'
		|| properties.get('Alternate Stream') !== '-') {
		throw new Error('The DMG Applications alias is not the expected symbolic link.');
	}
}

function assertSuccessfulDmgExtraction(result) {
	const stdout = quietSevenZipOutput(result, 'DMG extraction');
	const lines = stdout.split('\n');
	if (!lines.includes('Type = Dmg') || !lines.includes('Type = HFS')
		|| !lines.includes('Everything is Ok')) {
		throw new Error('The DMG extraction did not authenticate a complete HFS image.');
	}
}

function quietSevenZipOutput(result, label) {
	if (result === null || typeof result !== 'object'
		|| typeof result.stdout !== 'string' || result.stderr !== '') {
		throw new Error(`${label} produced unexpected diagnostics.`);
	}
	const stdout = result.stdout.replaceAll('\r\n', '\n');
	if (/\b(?:Errors?|Warnings?)\b/iu.test(stdout)) {
		throw new Error(`${label} reported an archive diagnostic.`);
	}
	return stdout;
}

async function extractedDmgVolumeRoot(extractedRoot, volumeName) {
	const root = await canonicalDirectory(extractedRoot, 'DMG extraction root');
	const entries = await readdir(root, { withFileTypes: true });
	if (entries.length !== 1 || entries[0].name !== volumeName
		|| !entries[0].isDirectory() || entries[0].isSymbolicLink()) {
		throw new Error('The DMG extraction did not produce one exact volume root.');
	}
	const volumeRoot = await canonicalDirectory(join(root, volumeName), 'extracted DMG volume root');
	const volumeEntries = await readdir(volumeRoot, { withFileTypes: true });
	if (volumeEntries.some((entry) => entry.name === 'Applications')) {
		throw new Error('The extracted DMG volume root retained the Applications alias.');
	}
	return volumeRoot;
}

async function run(command, args, label, { execute = executeFile } = {}) {
	try {
		return await execute(command, args, {
			encoding: 'utf8',
			maxBuffer: MAXIMUM_TOOL_OUTPUT,
			timeout: EXTRACTION_TIMEOUT_MS,
			windowsHide: true,
		});
	} catch (error) {
		throw new Error(`${label} failed without package-content authority.`, { cause: error });
	}
}

function assertFormatTarget(extension, targetId) {
	const allowed = targetId.startsWith('linux-')
		? ['.appimage', '.deb']
		: targetId.startsWith('win-') ? ['.exe', '.zip'] : ['.dmg'];
	if (!allowed.includes(extension)) {
		throw new Error(`The desktop package format ${extension || '<none>'} does not match ${targetId}.`);
	}
}

async function canonicalFile(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	const metadata = await lstat(value);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || await realpath(value) !== value) {
		throw new Error(`The ${label} must be one canonical regular file.`);
	}
	return value;
}

async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`The ${label} must be an absolute normalized path.`);
	}
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(value) !== value) {
		throw new Error(`The ${label} must be one canonical regular directory.`);
	}
	return value;
}

function decodeXml(value) {
	return value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"').replaceAll('&apos;', "'");
}
