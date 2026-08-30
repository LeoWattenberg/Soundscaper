/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	mkdir, mkdtemp, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	appImageSquashfsOffset,
	extractDmgWithSevenZip,
	withMountedDmg,
} from '../scripts/lib/desktop-package-artifact-extractor.mjs';

const DMG_VOLUME = 'Soundscaper 1.0.0-rc.1-arm64';
const DMG_APPLICATIONS_LINK = `${DMG_VOLUME}/Applications`;

test('DMG cleanup retains both the package-audit and detach failures', async () => {
	const auditError = new Error('package content mismatch');
	const detachError = new Error('volume remained busy');
	let calls = 0;
	await assert.rejects(() => withMountedDmg('/fixture/package.dmg', async () => {
		throw auditError;
	}, {
		runCommand: async () => {
			calls += 1;
			if (calls === 1) return {
				stdout: '<key>mount-point</key><string>/Volumes/Fixture</string>', stderr: '',
			};
			throw detachError;
		},
		resolveRealpath: async (value) => value,
	}), (error) => (
		error instanceof AggregateError
		&& error.cause === auditError
		&& error.errors[0] === auditError
		&& error.errors[1] === detachError
	));
});

test('foreign-platform DMG extraction authenticates the installer alias and volume root', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-dmg-extraction-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifact = join(root, 'Soundscaper-1.0.0-rc.1-mac-arm64.dmg');
	const extractedRoot = join(root, 'content');
	await writeFile(artifact, 'fixture');
	const calls = [];
	const execute = async (command, args) => {
		calls.push([command, args]);
		if (args[0] === 'l') return { stdout: dmgListing(), stderr: '' };
		if (args[0] === 'e') return { stdout: '/Applications', stderr: '' };
		await mkdir(join(extractedRoot, DMG_VOLUME), { recursive: true });
		return { stdout: dmgExtractionOutput(), stderr: '' };
	};
	assert.equal(await extractDmgWithSevenZip({
		artifact,
		extractedRoot,
		productId: 'soundscaper',
		sevenZip: '/fixture/7z',
		targetId: 'mac-arm64',
	}, { execute }), join(extractedRoot, DMG_VOLUME));
	assert.deepEqual(calls, [
		['/fixture/7z', ['l', '-slt', '-bd', '-spd', artifact, DMG_APPLICATIONS_LINK]],
		['/fixture/7z', ['e', '-so', '-bd', '-spd', artifact, DMG_APPLICATIONS_LINK]],
		['/fixture/7z', [
			'x', '-y', '-bd', '-sns-', '-spd', `-x!${DMG_APPLICATIONS_LINK}`,
			`-o${extractedRoot}`, artifact,
		]],
	]);
});

test('foreign-platform DMG extraction fails closed on alias and volume deviations', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-dmg-rejections-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifact = join(root, 'Soundscaper-1.0.0-rc.1-mac-arm64.dmg');
	await writeFile(artifact, 'fixture');
	for (const scenario of [
		{ label: 'regular alias', listing: dmgListing({ mode: '-rw-r--r--' }), target: '/Applications' },
		{ label: 'wrong path', listing: dmgListing({ path: `${DMG_VOLUME}/Other` }), target: '/Applications' },
		{ label: 'wrong size', listing: dmgListing({ size: '12' }), target: '/Applications' },
		{ label: 'alternate stream', listing: dmgListing({ alternateStream: '+' }), target: '/Applications' },
		{ label: 'duplicate alias', listing: dmgListing({ duplicate: true }), target: '/Applications' },
		{ label: 'wrong target', listing: dmgListing(), target: '/tmp' },
		{
			label: 'extraction warning', listing: dmgListing(), target: '/Applications',
			extractionOutput: `${dmgExtractionOutput()}Warnings: 1\n`,
		},
		{
			label: 'extraction stderr', listing: dmgListing(), target: '/Applications',
			extractionStderr: 'unexpected diagnostic\n',
		},
		{ label: 'extraction failure', listing: dmgListing(), target: '/Applications', extractionFailure: true },
		{ label: 'extra volume', listing: dmgListing(), target: '/Applications', extraRoot: true },
		{ label: 'retained alias', listing: dmgListing(), target: '/Applications', retainedAlias: true },
		{ label: 'symbolic volume', listing: dmgListing(), target: '/Applications', symbolicVolume: true },
	]) {
		const extractedRoot = join(root, scenario.label);
		const execute = async (_command, args) => {
			if (args[0] === 'l') return { stdout: scenario.listing, stderr: '' };
			if (args[0] === 'e') return { stdout: scenario.target, stderr: '' };
			if (scenario.extractionFailure === true) throw new Error('fixture extraction failure');
			if (scenario.symbolicVolume === true) {
				const target = join(root, `${scenario.label}-target`);
				await mkdir(target);
				await mkdir(extractedRoot);
				await symlink(target, join(extractedRoot, DMG_VOLUME), 'dir');
			} else {
				await mkdir(join(extractedRoot, DMG_VOLUME), { recursive: true });
			}
			if (scenario.extraRoot === true) await mkdir(join(extractedRoot, 'foreign'));
			if (scenario.retainedAlias === true) {
				await mkdir(join(extractedRoot, DMG_VOLUME, 'Applications'));
			}
			return {
				stdout: scenario.extractionOutput ?? dmgExtractionOutput(),
				stderr: scenario.extractionStderr ?? '',
			};
		};
		await assert.rejects(extractDmgWithSevenZip({
			artifact,
			extractedRoot,
			productId: 'soundscaper',
			sevenZip: '/fixture/7z',
			targetId: 'mac-arm64',
		}, { execute }), /Applications alias|volume root|DMG extraction/iu, scenario.label);
	}
});

test('AppImage extraction derives the payload from ELF structure and ignores decoy magic', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-appimage-offset-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'fixture.AppImage');
	const bytes = appImageBytes();
	bytes.set(Buffer.from('hsqs'), 128);
	await writeFile(path, bytes);
	assert.equal(await appImageSquashfsOffset(path), 4_096);
	assert.equal(await appImageSquashfsOffset(path, 'linux-x64'), 4_096);
	await assert.rejects(
		appImageSquashfsOffset(path, 'linux-arm64'),
		/AppImage runtime.*wrong target architecture/iu,
	);

	bytes.set(Buffer.from('nope'), 4_096);
	await writeFile(path, bytes);
	await assert.rejects(appImageSquashfsOffset(path), /ELF-derived offset.*SquashFS/iu);
});

test('AppImage extraction rejects an ELF section table that leaves the artifact', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-appimage-bounds-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'fixture.AppImage');
	const bytes = appImageBytes();
	bytes.writeBigUInt64LE(8_192n, 40);
	await writeFile(path, bytes);
	await assert.rejects(appImageSquashfsOffset(path), /section table.*bounded payload/iu);
});

function appImageBytes() {
	const bytes = Buffer.alloc(4_096 + 96);
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.set(Buffer.from('AI\x02', 'latin1'), 8);
	bytes.writeUInt16LE(2, 16);
	bytes.writeUInt16LE(62, 18);
	bytes.writeUInt32LE(1, 20);
	bytes.writeBigUInt64LE(4_032n, 40);
	bytes.writeUInt16LE(64, 52);
	bytes.writeUInt16LE(64, 58);
	bytes.writeUInt16LE(1, 60);
	const offset = 4_096;
	bytes.set(Buffer.from('hsqs'), offset);
	bytes.writeUInt32LE(1, offset + 4);
	bytes.writeUInt32LE(131_072, offset + 12);
	bytes.writeUInt16LE(1, offset + 20);
	bytes.writeUInt16LE(17, offset + 22);
	bytes.writeUInt16LE(1, offset + 26);
	bytes.writeUInt16LE(4, offset + 28);
	bytes.writeUInt16LE(0, offset + 30);
	bytes.writeBigUInt64LE(96n, offset + 40);
	return bytes;
}

function dmgListing({
	alternateStream = '-', duplicate = false, mode = 'lrwxr-xr-x',
	path = DMG_APPLICATIONS_LINK, size = '13',
} = {}) {
	const entry = [
		`Path = ${path}`,
		'Folder = -',
		`Size = ${size}`,
		`Mode = ${mode}`,
		`Alternate Stream = ${alternateStream}`,
		'Method = ',
	];
	return [
		'Type = Dmg',
		'Type = HFS',
		'',
		'----------',
		...entry,
		...(duplicate ? ['', ...entry] : []),
		'',
	].join('\n');
}

function dmgExtractionOutput() {
	return ['Type = Dmg', 'Type = HFS', 'Everything is Ok', ''].join('\n');
}
