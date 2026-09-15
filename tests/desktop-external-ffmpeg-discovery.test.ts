/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import test from 'node:test';

import { createExternalFfmpegCandidateLocator } from '../desktop/external-ffmpeg-node-runtime.ts';

const LOCAL = 'C:\\Users\\tester\\AppData\\Local';
const USER_PACKAGES = win32.join(LOCAL, 'Microsoft', 'WinGet', 'Packages');
const MACHINE_PACKAGES = 'C:\\Program Files\\WinGet\\Packages';

test('WinGet discovery finds user and machine links and nested portable packages without PATH', async () => {
	const userLinks = win32.join(LOCAL, 'Microsoft', 'WinGet', 'Links');
	const userPackage = win32.join(USER_PACKAGES, 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe');
	const machinePackage = win32.join(MACHINE_PACKAGES, 'BtbN.FFmpeg.GPL_Microsoft.Winget.Source_8wekyb3d8bbwe');
	const userBin = win32.join(userPackage, 'ffmpeg-8.0-full_build', 'bin');
	const machineBin = win32.join(machinePackage, 'bin');
	const machineLinks = 'C:\\Program Files\\WinGet\\Links';
	const x86Links = 'C:\\Program Files (x86)\\WinGet\\Links';
	const directories = new Map([
		[USER_PACKAGES, ['Other.Package', win32.basename(userPackage)]],
		[userPackage, ['ffmpeg-8.0-full_build']],
		[MACHINE_PACKAGES, [win32.basename(machinePackage)]],
	]);
	const executable = executablePairs('win32', [userLinks, machineLinks, x86Links, userBin, machineBin]);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'win32', arch: 'x64',
		environment: { LOCALAPPDATA: LOCAL, ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
		listSubdirectories: (path) => Promise.resolve(directories.get(path) ?? []),
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), [
		userLinks, machineLinks, x86Links, userBin, machineBin,
	].map((directory) => win32.join(directory, 'ffmpeg.exe')));
	assert.ok(candidates.every((candidate) => candidate.source === 'package-manager'));
});

test('WinGet environment names and duplicate candidates are case insensitive', async () => {
	const bin = win32.join(LOCAL, 'Microsoft', 'WinGet', 'Links');
	const executable = executablePairs('win32', [bin]);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'win32', arch: 'arm64',
		environment: { localappdata: LOCAL, Path: bin.toUpperCase() },
		listSubdirectories: () => Promise.resolve([]),
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0]?.ffmpegPath, win32.join(bin, 'ffmpeg.exe'));
});

test('WinGet discovery derives the user root from USERPROFILE and honors machine roots on another drive', async () => {
	const bins = ['D:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links', 'E:\\Apps\\WinGet\\Links'];
	const executable = executablePairs('win32', bins);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'win32', arch: 'x64',
		environment: { USERPROFILE: 'D:\\Users\\tester', ProgramW6432: 'E:\\Apps' },
		listSubdirectories: () => Promise.resolve([]),
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), bins.map((bin) => win32.join(bin, 'ffmpeg.exe')));
});

test('Homebrew discovery includes opt, versioned formulas, and Cellar releases on macOS', async () => {
	const directories = new Map([
		['/opt/homebrew/opt', ['unrelated', 'ffmpeg@7']],
		['/opt/homebrew/Cellar', ['ffmpeg', 'unrelated']],
		['/opt/homebrew/Cellar/ffmpeg', ['7.1.2', '8.0_1']],
		['/usr/local/Cellar', ['ffmpeg@6']],
		['/usr/local/Cellar/ffmpeg@6', ['6.1.3']],
	]);
	const bins = [
		'/opt/homebrew/opt/ffmpeg/bin', '/opt/homebrew/opt/ffmpeg@7/bin',
		'/opt/homebrew/Cellar/ffmpeg/8.0_1/bin', '/opt/homebrew/Cellar/ffmpeg/7.1.2/bin',
		'/usr/local/bin', '/usr/local/Cellar/ffmpeg@6/6.1.3/bin',
	];
	const executable = executablePairs('darwin', bins);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'darwin', arch: 'arm64', environment: {},
		listSubdirectories: (path) => Promise.resolve(directories.get(path) ?? []),
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), bins.map((bin) => posix.join(bin, 'ffmpeg')));
});

test('Linux Homebrew discovery includes the user prefix and a configured prefix and Cellar', async () => {
	const bins = ['/custom/brew/bin', '/custom/cellar/ffmpeg/9.0.1/bin', '/home/tester/.linuxbrew/opt/ffmpeg/bin'];
	const executable = executablePairs('linux', bins);
	const directories = new Map([
		['/custom/cellar', ['ffmpeg']],
		['/custom/cellar/ffmpeg', ['9.0.1']],
	]);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'linux', arch: 'x64',
		environment: { HOME: '/home/tester', HOMEBREW_PREFIX: '/custom/brew', HOMEBREW_CELLAR: '/custom/cellar' },
		listSubdirectories: (path) => Promise.resolve(directories.get(path) ?? []),
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), bins.map((bin) => posix.join(bin, 'ffmpeg')));
});

test('package scanning tolerates inaccessible directories and skips unrelated packages and missing pairs', async () => {
	const packagePath = win32.join(USER_PACKAGES, 'Gyan.FFmpeg_Essentials');
	const packageBin = win32.join(packagePath, 'bin');
	const checked: string[] = [];
	const executable = executablePairs('win32', [packageBin, 'D:\\tools']);
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'win32', arch: 'x64',
		environment: { LOCALAPPDATA: LOCAL, PATH: 'D:\\tools', ProgramFiles: 'relative' },
		listSubdirectories(path) {
			checked.push(path);
			if (path === USER_PACKAGES) return Promise.resolve(['Other.Package', 'Gyan.FFmpeg_MissingPair', 'Gyan.FFmpeg_Essentials', '..', 'bad/ffmpeg']);
			return Promise.reject(new Error('access denied'));
		},
		isExecutable: (path) => Promise.resolve(executable.has(path) || path.endsWith('MissingPair\\ffmpeg.exe')),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), [
		win32.join(packageBin, 'ffmpeg.exe'), 'D:\\tools\\ffmpeg.exe',
	]);
	assert.ok(!checked.some((path) => path.includes('Other.Package') || path.includes('relative') || path.includes('bad')));
});

test('WinGet nested discovery is shallow and deterministic', async () => {
	const packageA = win32.join(USER_PACKAGES, 'A.FFmpeg');
	const packageZ = win32.join(USER_PACKAGES, 'Z.FFmpeg');
	const executable = executablePairs('win32', [packageA, packageZ]);
	const checked: string[] = [];
	const candidates = await createExternalFfmpegCandidateLocator({
		platform: 'win32', arch: 'x64', environment: { LOCALAPPDATA: LOCAL },
		listSubdirectories(path) {
			checked.push(path);
			return Promise.resolve(path === USER_PACKAGES ? ['Z.FFmpeg', 'A.FFmpeg'] : ['nested']);
		},
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	}).discover();
	assert.deepEqual(candidates.map((candidate) => candidate.ffmpegPath), [packageA, packageZ].map((path) => win32.join(path, 'ffmpeg.exe')));
	assert.ok(checked.every((path) => !path.includes('nested\\nested\\nested')));
});

test('the real filesystem scanner finds an unlinked Homebrew Cellar pair and ignores non-executable files', { skip: process.platform === 'win32' }, async () => {
	const prefix = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-discovery-'));
	try {
		const bin = join(prefix, 'Cellar', 'ffmpeg', '8.0_1', 'bin');
		await mkdir(bin, { recursive: true });
		for (const name of ['ffmpeg', 'ffprobe']) {
			await writeFile(join(bin, name), '', { mode: 0o700 });
		}
		const locator = createExternalFfmpegCandidateLocator({
			platform: 'linux', arch: 'x64', environment: { HOMEBREW_PREFIX: prefix },
		});
		assert.ok((await locator.discover()).some((candidate) => candidate.ffmpegPath === join(bin, 'ffmpeg')));
		await chmod(join(bin, 'ffprobe'), 0o600);
		assert.ok(!(await locator.discover()).some((candidate) => candidate.ffmpegPath === join(bin, 'ffmpeg')));
	} finally {
		await rm(prefix, { recursive: true, force: true });
	}
});

function executablePairs(platform: NodeJS.Platform, directories: readonly string[]): ReadonlySet<string> {
	const paths = platform === 'win32' ? win32 : posix;
	return new Set(directories.flatMap((directory) => ['ffmpeg', 'ffprobe'].map((program) => (
		paths.join(directory, platform === 'win32' ? `${program}.exe` : program)
	))));
}
