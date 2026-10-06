/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	resolveDesktopProjectsDirectory,
	type DesktopProjectsDirectoryOptions,
} from '../desktop/desktop-projects-directory.ts';

const homePath = resolve('test-projects-home');
const configHomePath = join(homePath, '.config');
const defaults: DesktopProjectsDirectoryOptions = {
	platform: 'linux', homePath, configHomePath, environment: {},
};

function fromConfiguration(configuration: string, options = defaults): Promise<string | null> {
	return resolveDesktopProjectsDirectory({
		...options, readFile: () => Promise.resolve(configuration),
	});
}

test('Linux Projects resolves the localized directory from the XDG configuration base', async () => {
	const configBase = resolve('custom-config-base');
	const directory = await resolveDesktopProjectsDirectory({
		...defaults, configHomePath: configBase,
		readFile: (path, encoding) => {
			assert.equal(path, join(configBase, 'user-dirs.dirs'));
			assert.equal(encoding, 'utf8');
			return Promise.resolve('XDG_PROJECTS_DIR="$HOME/Projekte/Audio"\n');
		},
	});
	assert.equal(directory, join(homePath, 'Projekte', 'Audio'));
});

test('Projects supports HOME prefixes and absolute paths, including spaces', async () => {
	for (const value of ['$HOME/Audio Projects', '${HOME}/Audio Projects']) {
		assert.equal(await fromConfiguration(`XDG_PROJECTS_DIR="${value}"`),
			join(homePath, 'Audio Projects'));
	}
	assert.equal(await fromConfiguration('XDG_PROJECTS_DIR="/mnt/Studio Projects"'),
		'/mnt/Studio Projects');
});

test('an absolute Projects environment override wins without reading configuration', async () => {
	const override = resolve('preferred-projects');
	assert.equal(await resolveDesktopProjectsDirectory({
		...defaults, environment: { XDG_PROJECTS_DIR: override },
		readFile: () => { throw new Error('configuration must not be read'); },
	}), override);
	for (const value of [undefined, '', 'relative/path', '~/Projects', '/invalid\0directory']) {
		assert.equal(await fromConfiguration('XDG_PROJECTS_DIR="$HOME/Configured"', {
			...defaults, environment: { XDG_PROJECTS_DIR: value },
		}), join(homePath, 'Configured'));
	}
});

test('missing or unreadable configuration falls back to the conventional Projects directory', async () => {
	for (const configuration of ['', '# no Projects configured\nXDG_MUSIC_DIR="$HOME/Music"']) {
		assert.equal(await fromConfiguration(configuration), join(homePath, 'Projects'));
	}
	for (const code of ['ENOENT', 'EACCES']) {
		assert.equal(await resolveDesktopProjectsDirectory({
			...defaults,
			readFile: () => Promise.reject(Object.assign(new Error('cannot read'), { code })),
		}), join(homePath, 'Projects'));
	}
});

test('a Projects directory pointed at home remains disabled', async () => {
	for (const value of ['$HOME', '${HOME}', '$HOME/', `${homePath}/.`, homePath]) {
		assert.equal(await fromConfiguration(`XDG_PROJECTS_DIR="${value}"`), null, value);
	}
	assert.equal(await resolveDesktopProjectsDirectory({
		...defaults, environment: { XDG_PROJECTS_DIR: homePath },
		readFile: () => { throw new Error('disabled override must win'); },
	}), null);
});

test('Projects ignores unrelated and commented assignments and accepts trailing comments', async () => {
	assert.equal(await fromConfiguration([
		'# XDG_PROJECTS_DIR="/ignored"',
		'XDG_PROJECTS_DIRECTORY="/ignored"',
		'OTHER_XDG_PROJECTS_DIR="/ignored"',
		'\tXDG_PROJECTS_DIR = "$HOME/Studio #1"  # chosen directory',
	].join('\n')), join(homePath, 'Studio #1'));
});

test('the last valid Projects assignment wins while malformed assignments are ignored', async () => {
	assert.equal(await fromConfiguration([
		'XDG_PROJECTS_DIR="$HOME/First"',
		'XDG_PROJECTS_DIR="/mnt/Second"',
		'XDG_PROJECTS_DIR="relative"',
	].join('\n')), '/mnt/Second');
});

test('Projects decodes escaped characters without expanding escaped shell characters', async () => {
	const configuration = String.raw`XDG_PROJECTS_DIR="$HOME/Projet\ avec \"titre\" et \$budget et \\archive"`;
	assert.equal(await fromConfiguration(configuration),
		join(homePath, 'Projet avec "titre" et $budget et \\archive'));
});

test('Projects rejects malformed, relative, NUL-containing and executable shell values', async () => {
	for (const value of [
		'"relative"', '"~/Projects"', "'/mnt/Projects'", '/mnt/Projects',
		'"$HOMEbroken/Projects"', '"$OTHER/Projects"', '"${HOME:-/tmp}/Projects"',
		'"$HOME/$OTHER"', '"$HOME/${OTHER}"', '"$HOME/$(touch /tmp/xdg-projects-injected)"',
		'"$HOME/`touch /tmp/xdg-projects-injected`"', '"/mnt/invalid\0path"',
		'"/mnt/incomplete', '"/mnt/Projects"; touch /tmp/xdg-projects-injected',
		'"/mnt/Projects" "extra"', '"/mnt/multiline\npath"',
	]) {
		assert.equal(await fromConfiguration(`XDG_PROJECTS_DIR=${value}`),
			join(homePath, 'Projects'), value);
	}
});

test('non-Linux platforms keep the native chooser directory without reading XDG files', async () => {
	for (const platform of ['darwin', 'win32'] as const) {
		assert.equal(await resolveDesktopProjectsDirectory({
			...defaults, platform, environment: { XDG_PROJECTS_DIR: '/ignored' },
			readFile: () => { throw new Error('non-Linux must not read XDG files'); },
		}), null);
	}
});

test('Projects reads the user-dirs file without creating directories', async () => {
	const fixture = await mkdtemp(join(tmpdir(), 'soundscaper-projects-directory-'));
	try {
		const configBase = join(fixture, 'config');
		await mkdir(configBase);
		await writeFile(join(configBase, 'user-dirs.dirs'),
			'XDG_PROJECTS_DIR="$HOME/Not Yet Created"\n');
		assert.equal(await resolveDesktopProjectsDirectory({
			...defaults, homePath: fixture, configHomePath: configBase,
		}), join(fixture, 'Not Yet Created'));
		await assert.rejects(stat(join(fixture, 'Not Yet Created')), { code: 'ENOENT' });
		assert.equal(await resolveDesktopProjectsDirectory({
			...defaults, homePath: fixture, configHomePath: join(fixture, 'missing-config'),
		}), join(fixture, 'Projects'));
		await assert.rejects(stat(join(fixture, 'Projects')), { code: 'ENOENT' });
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
});

test('Linux Projects rejects unsafe base paths', async () => {
	for (const field of ['homePath', 'configHomePath'] as const) {
		for (const value of ['', 'relative/path', '/invalid\0path']) {
			await assert.rejects(resolveDesktopProjectsDirectory({
				...defaults, [field]: value, readFile: () => Promise.resolve(''),
			}), TypeError);
		}
	}
});
