/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import {
	basename, dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';
import { inflateSync } from 'node:zlib';

// electron-builder 26.15.6's reviewed no-EULA launcher varies only by the
// product executable. A dependency update must deliberately repin these bytes.
const APPIMAGE_APP_RUN_SHA256 = Object.freeze({
	framescaper: '58beef2a44a9bd1000163dda8c6c06e1d388f2b574c22b87e021f12609457abb',
	soundscaper: '09e40e04d06d2388bd82e75f790dc94e8e8f661437061ac4eef3ab573fce83d8',
});
const APPIMAGE_COMPATIBILITY_LIBRARY_AUTHORITY = Object.freeze({
	'linux-x64': Object.freeze({
		'libXss.so.1': Object.freeze({
			byteLength: 14_488,
			sha256: '270fe6e4d430118793d01cac5c6081d0ea9e244cfcf510475bc779bef21b754a',
		}),
		'libXtst.so.6': Object.freeze({
			byteLength: 22_880,
			sha256: '38f9ccb12d2c477aad85db6279afc334d9f250f613884c188ace7232b83e9b68',
		}),
		'libappindicator.so.1': Object.freeze({
			byteLength: 52_128,
			sha256: '033b8803f20b98e8cd56fc8e75e3a71a552f75c0cff9bd0937f3ddd6ee5d2145',
		}),
		'libgconf-2.so.4': Object.freeze({
			byteLength: 192_296,
			sha256: 'ba977334112bb81f6457ee4aad833c6d5f1ff731c718073cd50777d613b23185',
		}),
		'libindicator.so.7': Object.freeze({
			byteLength: 60_648,
			sha256: '3b61ae3424c4800975c1806245a2d286f6e1fc49cd9350913075c27a95f3c7a0',
		}),
		'libnotify.so.4': Object.freeze({
			byteLength: 31_304,
			sha256: '8f42294247a886c5a94b2a0ce1c0b65e953616d7efe8da664b3826cdeae47948',
		}),
	}),
	'linux-arm64': Object.freeze({}),
});
// electron-builder 26.15.6 copies this helper from its SHA-256-pinned
// nsis-3.0.4.1 toolset after afterPack has sealed the application resources.
// It is package machinery, not application content, so authenticate it before
// excluding it from the normalized NSIS-installed closure.
const NSIS_ELEVATE_HELPER_AUTHORITY = Object.freeze({
	byteLength: 107_520,
	sha256: '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37',
});
const APPIMAGE_ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256, 512]);
const MAXIMUM_WRAPPER_FILE_BYTES = 64 * 1024 * 1024;
const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const AUDACITY_MIME_TYPE = 'application/x-audacity-project';
const CRC32_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
}));

export async function validateDesktopPackageInstalledLayout({
	extraction, packageFormat, resourcesRoot, productId, targetId,
}) {
	const productName = desktopProductName(productId);
	let executable;
	let applicationRoot;
	if (targetId.startsWith('linux-')) {
		if (basename(resourcesRoot) !== 'resources') throw new Error('The Linux package resource layout is invalid.');
		applicationRoot = dirname(resourcesRoot);
		const relativeRoot = portableRelative(extraction, applicationRoot);
		const validAppImageRoot = packageFormat === '.appimage' && relativeRoot === '';
		const validDebianRoot = packageFormat === '.deb' && relativeRoot === `opt/${productName}`;
		const validDirectAuditRoot = packageFormat === null
			&& (relativeRoot === `usr/lib/${productId}` || relativeRoot === `opt/${productName}`);
		if (!validAppImageRoot && !validDebianRoot && !validDirectAuditRoot) {
			throw new Error('The Linux package application layout is invalid.');
		}
		executable = resolve(applicationRoot, productId);
	} else if (targetId.startsWith('win-')) {
		if (basename(resourcesRoot) !== 'resources') throw new Error('The Windows package resource layout is invalid.');
		applicationRoot = dirname(resourcesRoot);
		const relativeRoot = portableRelative(extraction, applicationRoot);
		if (relativeRoot !== '' && relativeRoot !== productName) {
			throw new Error('The Windows package application layout is invalid.');
		}
		executable = resolve(applicationRoot, `${productName}.exe`);
	} else {
		const contents = dirname(resourcesRoot);
		applicationRoot = dirname(contents);
		if (basename(resourcesRoot) !== 'Resources' || basename(contents) !== 'Contents'
			|| basename(dirname(contents)) !== `${productName}.app`
			|| portableRelative(extraction, resourcesRoot) !== `${productName}.app/Contents/Resources`) {
			throw new Error('The macOS package resource layout is invalid.');
		}
		executable = resolve(contents, 'MacOS', productName);
	}
	const metadata = await lstat(executable).catch(() => null);
	if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
		throw new Error('The extracted package does not bind the resource closure to its product executable.');
	}
	return { applicationRoot, executable };
}

export async function validateDesktopPackageSpecificResources({
	nsisElevateHelperAuthority = NSIS_ELEVATE_HELPER_AUTHORITY,
	packageFormat, productId, resourcesRoot, targetId,
}) {
	if (packageFormat === '.exe') {
		desktopProductName(productId);
		if (!targetId.startsWith('win-')) {
			throw new Error('Only Windows NSIS packages may carry the elevate helper.');
		}
		const authority = authenticatedFileAuthority(
			nsisElevateHelperAuthority, 'NSIS elevate helper',
		);
		const bytes = await directRegularBytes(
			resourcesRoot, 'elevate.exe', 1024 * 1024, null, 'NSIS elevate helper',
		);
		if (bytes.byteLength !== authority.byteLength || digest(bytes) !== authority.sha256) {
			throw new Error('The Windows package does not contain the pinned NSIS elevate helper.');
		}
		assertPe32ElevateHelper(bytes);
		return ['elevate.exe'];
	}
	if (packageFormat !== '.deb') return [];
	if (!targetId.startsWith('linux-')) {
		throw new Error('Only Linux Debian packages may carry AppArmor package metadata.');
	}
	const productName = desktopProductName(productId);
	const expected = Buffer.from([
		'abi <abi/4.0>,',
		'include <tunables/global>',
		'',
		`profile "${productId}" "/opt/${productName}/${productId}" flags=(unconfined) {`,
		'  userns,',
		'',
		'  # Site-specific additions and overrides. See local/README for details.',
		`  include if exists <local/${productId}>`,
		'}',
	].join('\n'), 'utf8');
	const bytes = await directRegularBytes(
		resourcesRoot, 'apparmor-profile', 4 * 1024, 0o644, 'Debian AppArmor profile',
	);
	if (!bytes.equals(expected)) {
		throw new Error('The Debian AppArmor profile does not match its installed product identity.');
	}
	return ['apparmor-profile'];
}

export async function normalizeDesktopPackageInstalledClosure(
	files,
	{
		appImageCompatibilityLibraryAuthority = APPIMAGE_COMPATIBILITY_LIBRARY_AUTHORITY,
		applicationRoot, applicationVersion, packageFormat, productId,
		packageResourceExclusions, targetId,
	},
) {
	desktopProductName(productId);
	const excluded = new Set(packageResourceExclusions.map((name) => `resources/${name}`));
	if (packageFormat !== '.appimage') return files.filter(({ path }) => !excluded.has(path));
	const iconTarget = `usr/share/icons/hicolor/512x512/apps/${productId}.png`;
	const inventory = new Map(files.map((file) => [file.path, file]));
	for (const name of ['.DirIcon', `${productId}.png`]) {
		const link = inventory.get(name);
		if (link?.type !== 'symlink' || link.target !== iconTarget || link.mode !== 0o777) {
			throw new Error(`The AppImage wrapper has an invalid ${name} icon link.`);
		}
		excluded.add(name);
	}
	const appRun = inventory.get('AppRun');
	if (appRun?.type !== 'file' || appRun.mode !== 0o755) {
		throw new Error('The AppImage wrapper has no executable AppRun entry.');
	}
	excluded.add('AppRun');
	const desktopEntry = `org.${productId}.desktop`;
	if (inventory.get(desktopEntry)?.type !== 'file' || inventory.get(desktopEntry).mode !== 0o644) {
		throw new Error('The AppImage wrapper has no product desktop entry.');
	}
	excluded.add(desktopEntry);
	const wrapperFiles = new Set([
		...appImageLibraries(targetId, appImageCompatibilityLibraryAuthority)
			.map(([name]) => `usr/lib/${name}`),
		...APPIMAGE_ICON_SIZES.map(
			(size) => `usr/share/icons/hicolor/${size}x${size}/apps/${productId}.png`,
		),
		`usr/share/mime/packages/${productId}.xml`,
	]);
	if ([...wrapperFiles].some((path) => (
		inventory.get(path)?.type !== 'file' || inventory.get(path).mode !== 0o644
	))) {
		throw new Error('The AppImage wrapper has an incomplete compatibility-file inventory.');
	}
	for (const file of files.filter(({ path }) => path.startsWith('usr/'))) {
		if (!wrapperFiles.has(file.path) || file.type !== 'file') {
			throw new Error(`The AppImage wrapper contains unsupported metadata ${file.path}.`);
		}
		excluded.add(file.path);
	}
	await validateAppImageWrapperContent({
		appImageCompatibilityLibraryAuthority,
		applicationRoot,
		applicationVersion,
		inventory,
		productId,
		targetId,
	});
	return files.filter(({ path }) => !excluded.has(path));
}

async function validateAppImageWrapperContent({
	appImageCompatibilityLibraryAuthority,
	applicationRoot,
	applicationVersion,
	inventory,
	productId,
	targetId,
}) {
	const appRun = await authenticatedWrapperBytes(applicationRoot, inventory.get('AppRun'));
	if (digest(appRun) !== APPIMAGE_APP_RUN_SHA256[productId]) {
		throw new Error('The AppImage AppRun launcher differs from the pinned builder launcher.');
	}
	const desktopEntryPath = `org.${productId}.desktop`;
	const desktopEntry = await authenticatedWrapperBytes(applicationRoot, inventory.get(desktopEntryPath));
	if (!desktopEntry.equals(expectedDesktopEntry(productId, applicationVersion))) {
		throw new Error('The AppImage desktop entry does not bind the expected product launch semantics.');
	}
	const mimePath = `usr/share/mime/packages/${productId}.xml`;
	const mime = await authenticatedWrapperBytes(applicationRoot, inventory.get(mimePath));
	if (!mime.equals(expectedMimeCatalog(productId))) {
		throw new Error('The AppImage MIME catalog does not bind the expected project associations.');
	}
	for (const size of APPIMAGE_ICON_SIZES) {
		const path = `usr/share/icons/hicolor/${size}x${size}/apps/${productId}.png`;
		assertPngIcon(await authenticatedWrapperBytes(applicationRoot, inventory.get(path)), size, path);
	}
	for (const [name, expected] of appImageLibraries(
		targetId, appImageCompatibilityLibraryAuthority,
	)) {
		const path = `usr/lib/${name}`;
		const bytes = await authenticatedWrapperBytes(applicationRoot, inventory.get(path));
		if (bytes.byteLength !== expected.byteLength || digest(bytes) !== expected.sha256) {
			throw new Error(`The AppImage compatibility library ${path} differs from the pinned toolset.`);
		}
		assertElfSharedLibrary(bytes, targetId, path);
	}
}

async function authenticatedWrapperBytes(root, descriptor) {
	if (!descriptor || descriptor.type !== 'file' || descriptor.byteLength > MAXIMUM_WRAPPER_FILE_BYTES) {
		throw new Error('The AppImage wrapper file descriptor is invalid.');
	}
	const path = resolve(root, descriptor.path);
	if (!contained(root, path)) throw new Error('The AppImage wrapper file leaves its application root.');
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== descriptor.byteLength
		|| (before.mode & 0o777) !== descriptor.mode) {
		throw new Error(`The AppImage wrapper file ${descriptor.path} changed before validation.`);
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`The AppImage wrapper file ${descriptor.path} changed while opening.`);
		}
		const bytes = await handle.readFile();
		if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256) {
			throw new Error(`The AppImage wrapper file ${descriptor.path} changed during validation.`);
		}
		return bytes;
	} finally {
		await handle?.close();
	}
}

async function directRegularBytes(root, name, maximum, expectedMode, label) {
	const path = resolve(root, name);
	if (dirname(path) !== root) throw new Error(`The ${label} path is invalid.`);
	const before = await lstat(path);
	const wrongMode = expectedMode !== null && (before.mode & 0o777) !== expectedMode;
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum
		|| wrongMode) {
		throw new Error(expectedMode === null
			? `The ${label} is not an admitted regular file.`
			: `The ${label} is not an admitted regular file with mode 0644.`);
	}
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`The ${label} changed while opening.`);
		}
		return await handle.readFile();
	} finally {
		await handle?.close();
	}
}

function authenticatedFileAuthority(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) {
		throw new TypeError(`The ${label} authority is invalid.`);
	}
	return value;
}

function assertPe32ElevateHelper(bytes) {
	const peOffset = bytes.length >= 0x40 ? bytes.readUInt32LE(0x3c) : -1;
	if (bytes.length < 0x40 || bytes.subarray(0, 2).toString('ascii') !== 'MZ'
		|| peOffset < 0x40 || peOffset > bytes.length - 6
		|| bytes.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0'
		|| bytes.readUInt16LE(peOffset + 4) !== 0x014c) {
		throw new Error('The NSIS elevate helper is not the expected 32-bit x86 PE executable.');
	}
}

function expectedDesktopEntry(productId, applicationVersion) {
	if (typeof applicationVersion !== 'string' || !/^[\w.+-]{1,160}$/u.test(applicationVersion)) {
		throw new Error('The AppImage application version is invalid.');
	}
	const framescaper = productId === 'framescaper';
	const productName = desktopProductName(productId);
	const mimeTypes = [SCAPE_MIME_TYPE, SCAPE_MIME_TYPE, ...(framescaper ? [] : [AUDACITY_MIME_TYPE])];
	return Buffer.from(`${[
		'[Desktop Entry]',
		`Name=${productName}`,
		'Exec=AppRun --no-sandbox %U',
		'Terminal=false',
		'Type=Application',
		`Icon=${productId}`,
		`StartupWMClass=org.${productId}`,
		`X-AppImage-Version=${applicationVersion}`,
		`Comment=${framescaper
			? 'Framescaper is a local-first video editor with offline project and media export support.'
			: 'Soundscaper is a local-first multitrack audio editor with offline project and media export support.'}`,
		`MimeType=${mimeTypes.join(';')};`,
		`Categories=AudioVideo;${framescaper ? 'Video' : 'Audio'};`,
	].join('\n')}\n`, 'utf8');
}

function expectedMimeCatalog(productId) {
	const productName = desktopProductName(productId);
	const associations = [
		[SCAPE_MIME_TYPE, productId === 'framescaper' ? ['fscape'] : ['sscape']],
		[SCAPE_MIME_TYPE, ['scape']],
		...(productId === 'framescaper' ? [] : [[AUDACITY_MIME_TYPE, ['aup3', 'aup4']]]),
	];
	const entries = associations.flatMap(([mimeType, extensions]) => [
		`<mime-type type="${mimeType}">`,
		`  <comment>${productName} document</comment>`,
		...extensions.map((extension) => `  <glob pattern="*.${extension}"/>`),
		'  <generic-icon name="x-office-document"/>',
		'</mime-type>',
	]);
	return Buffer.from([
		'<?xml version="1.0"?>',
		'<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
		...entries,
		'</mime-info>',
	].join('\n'), 'utf8');
}

function assertPngIcon(bytes, size, path) {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	let offset = 8;
	let sawHeader = false;
	let sawImageData = false;
	let sawEnd = false;
	let imageDataClosed = false;
	let channels = 0;
	const imageData = [];
	if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) {
		throw new Error(`The AppImage icon ${path} is not the expected ${size}px PNG.`);
	}
	while (offset < bytes.length) {
		if (offset + 12 > bytes.length) throw invalidPng(path, size);
		const byteLength = bytes.readUInt32BE(offset);
		const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
		const dataStart = offset + 8;
		const dataEnd = dataStart + byteLength;
		const chunkEnd = dataEnd + 4;
		if (!/^[A-Za-z]{4}$/u.test(type) || chunkEnd > bytes.length
			|| bytes.readUInt32BE(dataEnd) !== crc32(bytes.subarray(offset + 4, dataEnd))) {
			throw invalidPng(path, size);
		}
		if (!sawHeader) {
			if (type !== 'IHDR' || byteLength !== 13
				|| bytes.readUInt32BE(dataStart) !== size
				|| bytes.readUInt32BE(dataStart + 4) !== size
				|| bytes[dataStart + 8] !== 8 || ![2, 6].includes(bytes[dataStart + 9])
				|| bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0
				|| bytes[dataStart + 12] !== 0) throw invalidPng(path, size);
			channels = bytes[dataStart + 9] === 2 ? 3 : 4;
			sawHeader = true;
		} else if (type === 'IHDR') throw invalidPng(path, size);
		if (type === 'IDAT') {
			if (byteLength < 1 || sawEnd || imageDataClosed) throw invalidPng(path, size);
			sawImageData = true;
			imageData.push(bytes.subarray(dataStart, dataEnd));
		} else if (sawImageData && type !== 'IEND') {
			imageDataClosed = true;
		}
		if (type === 'IEND') {
			if (byteLength !== 0 || !sawImageData || chunkEnd !== bytes.length) {
				throw invalidPng(path, size);
			}
			sawEnd = true;
		} else if (type[0] === type[0].toUpperCase()
			&& type !== 'IHDR' && type !== 'IDAT' && type !== 'PLTE') {
			throw invalidPng(path, size);
		}
		offset = chunkEnd;
	}
	if (!sawHeader || !sawImageData || !sawEnd) throw invalidPng(path, size);
	const rowBytes = size * channels + 1;
	const expectedBytes = rowBytes * size;
	let pixels;
	try {
		pixels = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedBytes });
	} catch {
		throw invalidPng(path, size);
	}
	if (pixels.byteLength !== expectedBytes) throw invalidPng(path, size);
	for (let row = 0; row < size; row += 1) {
		if (pixels[row * rowBytes] > 4) throw invalidPng(path, size);
	}
}

function invalidPng(path, size) {
	return new Error(`The AppImage icon ${path} is not the expected ${size}px PNG.`);
}

function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}

function assertElfSharedLibrary(bytes, targetId, path) {
	const machine = targetId === 'linux-x64' ? 62 : targetId === 'linux-arm64' ? 183 : null;
	if (machine === null || bytes.length < 20
		|| !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
		|| bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1
		|| bytes.readUInt16LE(16) !== 3 || bytes.readUInt16LE(18) !== machine) {
		throw new Error(`The AppImage compatibility library ${path} has the wrong ELF architecture.`);
	}
}

function appImageLibraries(targetId, authority) {
	const libraries = authority?.[targetId];
	if (!libraries || typeof libraries !== 'object' || Array.isArray(libraries)) {
		throw new Error('The AppImage target identity or compatibility-library authority is unsupported.');
	}
	return Object.entries(libraries);
}

function desktopProductName(productId) {
	if (productId === 'framescaper') return 'Framescaper';
	if (productId === 'soundscaper') return 'Soundscaper';
	throw new TypeError('The desktop package product identity is unsupported.');
}

function portableRelative(root, path) {
	return relative(root, path).split(sep).join('/');
}

function contained(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
