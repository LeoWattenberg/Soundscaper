/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import appImageUtil from 'app-builder-lib/out/targets/appimage/appImageUtil.js';

import {
	normalizeDesktopPackageInstalledClosure,
	validateDesktopPackageSpecificResources,
} from '../scripts/lib/desktop-package-format-layout.mjs';
import { createPngFixture } from './helpers/png-fixture.mjs';

const VERSION = '1.0.0-rc.1';
const LIBRARIES = [
	'libXss.so.1',
	'libXtst.so.6',
	'libappindicator.so.1',
	'libgconf-2.so.4',
	'libindicator.so.7',
	'libnotify.so.4',
];
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

test('AppImage wrapper normalization authenticates x64 metadata and retains only the application', async (context) => {
	const fixture = await appImageFixture(context, 'linux-x64');
	const normalized = await normalizeFixture(fixture);
	assert.deepEqual(normalized.map(({ path }) => path), ['resources/app.asar']);
});

test('AppImage arm64 normalization requires the exact empty compatibility-library inventory', async (context) => {
	const fixture = await appImageFixture(context, 'linux-arm64');
	assert.deepEqual((await normalizeFixture(fixture)).map(({ path }) => path), ['resources/app.asar']);
	await writeFixtureFile(join(fixture.root, 'usr/lib/libXss.so.1'), elfSharedLibrary(183));
	await assert.rejects(normalizeFixture(fixture), /unsupported metadata/iu);
});

test('AppImage wrapper normalization rejects launcher, desktop, MIME, and library substitutions', async (context) => {
	for (const scenario of [
		{
			name: 'AppRun',
			pattern: /pinned builder launcher/iu,
			mutate: (root) => writeFile(join(root, 'AppRun'), '#!/bin/sh\nexec ./malicious\n'),
		},
		{
			name: 'desktop Exec',
			pattern: /launch semantics/iu,
			mutate: async (root) => writeFile(
				join(root, 'org.soundscaper.desktop'),
				(await readFile(join(root, 'org.soundscaper.desktop'), 'utf8'))
					.replace('Exec=AppRun --no-sandbox %U', 'Exec=/tmp/foreign'),
			),
		},
		{
			name: 'MIME',
			pattern: /MIME catalog/iu,
			mutate: async (root) => writeFile(
				join(root, 'usr/share/mime/packages/soundscaper.xml'),
				(await readFile(join(root, 'usr/share/mime/packages/soundscaper.xml'), 'utf8'))
					.replace('*.sscape', '*.foreign'),
			),
		},
	]) {
		const fixture = await appImageFixture(context, 'linux-x64');
		await scenario.mutate(fixture.root);
		await assert.rejects(normalizeFixture(fixture), scenario.pattern, scenario.name);
	}

	const extra = await appImageFixture(context, 'linux-x64');
	await writeFixtureFile(join(extra.root, 'usr/lib/libunmanaged.so.1'), elfSharedLibrary(62));
	await assert.rejects(normalizeFixture(extra), /unsupported metadata/iu);

	for (const [name, bytes] of [
		['wrong architecture', elfSharedLibrary(183)],
		['non-ELF', Buffer.alloc(64, 0x5a)],
	]) {
		const fixture = await appImageFixture(context, 'linux-x64');
		await writeFixtureFile(join(fixture.root, 'usr/lib/libXss.so.1'), bytes);
		fixture.authority['linux-x64']['libXss.so.1'] = descriptor(bytes);
		await assert.rejects(normalizeFixture(fixture), /wrong ELF architecture/iu, name);
	}
});

test('AppImage wrapper normalization rejects missing, mislinked, mis-moded, and invalid image metadata', async (context) => {
	const missingLibrary = await appImageFixture(context, 'linux-x64');
	await rm(join(missingLibrary.root, 'usr/lib/libXss.so.1'));
	await assert.rejects(normalizeFixture(missingLibrary), /incomplete compatibility-file inventory/iu);

	const launcherMode = await appImageFixture(context, 'linux-x64');
	await chmod(join(launcherMode.root, 'AppRun'), 0o644);
	await assert.rejects(normalizeFixture(launcherMode), /executable AppRun/iu);

	const iconLink = await appImageFixture(context, 'linux-x64');
	await rm(join(iconLink.root, '.DirIcon'));
	await symlink(
		'usr/share/icons/hicolor/16x16/apps/soundscaper.png',
		join(iconLink.root, '.DirIcon'),
	);
	await assert.rejects(normalizeFixture(iconLink), /invalid \.DirIcon icon link/iu);

	for (const [name, bytes] of [
		['truncated', createPngFixture(16).subarray(0, 8)],
		['wrong dimensions', createPngFixture(24)],
		['wrong CRC', (() => {
			const corrupted = createPngFixture(16);
			corrupted[29] ^= 0xff;
			return corrupted;
		})()],
	]) {
		const fixture = await appImageFixture(context, 'linux-x64');
		await writeFixtureFile(
			join(fixture.root, 'usr/share/icons/hicolor/16x16/apps/soundscaper.png'), bytes,
		);
		await assert.rejects(normalizeFixture(fixture), /expected 16px PNG/iu, name);
	}
});

test('Debian-only resources are removed after their package-specific validation', async () => {
	const core = descriptorForPath('resources/app.asar', Buffer.from('application'));
	assert.deepEqual(await normalizeDesktopPackageInstalledClosure([
		core,
		descriptorForPath('resources/apparmor-profile', Buffer.from('profile')),
	], {
		applicationRoot: resolve('unused'),
		applicationVersion: VERSION,
		packageFormat: '.deb',
		productId: 'soundscaper',
		packageResourceExclusions: ['apparmor-profile'],
		targetId: 'linux-x64',
	}), [core]);
});

test('Debian AppArmor metadata binds exact product bytes and mode before exclusion', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-package-apparmor-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resourcesRoot = join(root, 'resources');
	const path = join(resourcesRoot, 'apparmor-profile');
	await writeFixtureFile(path, appArmorProfile());
	assert.deepEqual(await validateDesktopPackageSpecificResources({
		packageFormat: '.deb', productId: 'soundscaper', resourcesRoot, targetId: 'linux-x64',
	}), ['apparmor-profile']);
	await chmod(path, 0o600);
	await assert.rejects(validateDesktopPackageSpecificResources({
		packageFormat: '.deb', productId: 'soundscaper', resourcesRoot, targetId: 'linux-x64',
	}), /mode 0644/iu);
	await writeFixtureFile(path, Buffer.from('foreign profile'));
	await assert.rejects(validateDesktopPackageSpecificResources({
		packageFormat: '.deb', productId: 'soundscaper', resourcesRoot, targetId: 'linux-x64',
	}), /installed product identity/iu);
});

async function appImageFixture(context, targetId) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-package-format-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFixtureFile(join(root, 'resources/app.asar'), Buffer.from('application'));
	await writeFixtureFile(
		join(root, 'AppRun'),
		Buffer.from(appImageUtil.generateAppRunScript({ ExecutableName: 'soundscaper' })),
		0o755,
	);
	await writeFixtureFile(join(root, 'org.soundscaper.desktop'), desktopEntry());
	await writeFixtureFile(join(root, 'usr/share/mime/packages/soundscaper.xml'), mimeCatalog());
	for (const size of ICON_SIZES) await writeFixtureFile(
		join(root, `usr/share/icons/hicolor/${size}x${size}/apps/soundscaper.png`),
		createPngFixture(size),
	);
	const authority = { 'linux-x64': {}, 'linux-arm64': {} };
	if (targetId === 'linux-x64') {
		for (const name of LIBRARIES) {
			const bytes = elfSharedLibrary(62);
			await writeFixtureFile(join(root, `usr/lib/${name}`), bytes);
			authority['linux-x64'][name] = descriptor(bytes);
		}
	}
	const iconTarget = 'usr/share/icons/hicolor/512x512/apps/soundscaper.png';
	await symlink(iconTarget, join(root, '.DirIcon'));
	await symlink(iconTarget, join(root, 'soundscaper.png'));
	return { authority, root, targetId };
}

async function normalizeFixture(fixture) {
	return normalizeDesktopPackageInstalledClosure(await installedFiles(fixture.root), {
		appImageCompatibilityLibraryAuthority: fixture.authority,
		applicationRoot: fixture.root,
		applicationVersion: VERSION,
		packageFormat: '.appimage',
		productId: 'soundscaper',
		packageResourceExclusions: [],
		targetId: fixture.targetId,
	});
}

async function installedFiles(root) {
	const files = [];
	async function visit(directory, prefix) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = join(directory, entry.name);
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			const metadata = await lstat(path);
			if (metadata.isDirectory()) await visit(path, name);
			else if (metadata.isSymbolicLink()) {
				const target = await readlink(path);
				files.push({
					...descriptorForPath(name, Buffer.from(target)), type: 'symlink', target,
					mode: metadata.mode & 0o777,
				});
			} else {
				files.push({
					...descriptorForPath(name, await readFile(path)), type: 'file',
					mode: metadata.mode & 0o777,
				});
			}
		}
	}
	await visit(root, '');
	return files;
}

async function writeFixtureFile(path, bytes, mode = 0o644) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
	await chmod(path, mode);
}

function descriptorForPath(path, bytes) {
	return { path, ...descriptor(bytes) };
}

function descriptor(bytes) {
	return {
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function elfSharedLibrary(machine) {
	const bytes = Buffer.alloc(64);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.writeUInt16LE(3, 16);
	bytes.writeUInt16LE(machine, 18);
	return bytes;
}

function desktopEntry() {
	return Buffer.from(`${[
		'[Desktop Entry]',
		'Name=Soundscaper',
		'Exec=AppRun --no-sandbox %U',
		'Terminal=false',
		'Type=Application',
		'Icon=soundscaper',
		'StartupWMClass=org.soundscaper',
		`X-AppImage-Version=${VERSION}`,
		'Comment=Soundscaper is a local-first multitrack audio editor with offline project and media export support.',
		'MimeType=application/vnd.soundscaper.scape+zip;application/vnd.soundscaper.scape+zip;application/x-audacity-project;',
		'Categories=AudioVideo;Audio;',
	].join('\n')}\n`);
}

function mimeCatalog() {
	return Buffer.from([
		'<?xml version="1.0"?>',
		'<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
		'<mime-type type="application/vnd.soundscaper.scape+zip">',
		'  <comment>Soundscaper document</comment>',
		'  <glob pattern="*.sscape"/>',
		'  <generic-icon name="x-office-document"/>',
		'</mime-type>',
		'<mime-type type="application/vnd.soundscaper.scape+zip">',
		'  <comment>Soundscaper document</comment>',
		'  <glob pattern="*.scape"/>',
		'  <generic-icon name="x-office-document"/>',
		'</mime-type>',
		'<mime-type type="application/x-audacity-project">',
		'  <comment>Soundscaper document</comment>',
		'  <glob pattern="*.aup3"/>',
		'  <glob pattern="*.aup4"/>',
		'  <generic-icon name="x-office-document"/>',
		'</mime-type>',
		'</mime-info>',
	].join('\n'));
}

function appArmorProfile() {
	return Buffer.from([
		'abi <abi/4.0>,',
		'include <tunables/global>',
		'',
		'profile "soundscaper" "/opt/Soundscaper/soundscaper" flags=(unconfined) {',
		'  userns,',
		'',
		'  # Site-specific additions and overrides. See local/README for details.',
		'  include if exists <local/soundscaper>',
		'}',
	].join('\n'));
}
