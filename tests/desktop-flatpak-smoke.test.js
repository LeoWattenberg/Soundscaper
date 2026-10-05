/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test from 'node:test';

import { resolveDesktopSmokeInvocation } from '../scripts/desktop-smoke.mjs';
import { SOUNDSCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE } from '../scripts/lib/desktop-smoke.mjs';

const options = {
	executable: '/release/desktop/linux-unpacked/soundscaper',
	platform: 'linux',
	productId: 'soundscaper',
	profile: '/tmp/soundscaper-desktop-smoke-test',
	useXvfb: false,
};
const appArgs = [
	`--user-data-dir=${options.profile}`,
	'--soundscaper-smoke',
	`--soundscaper-smoke-app-data=${join(options.profile, 'application-data')}`,
];

test('installed Flatpak smoke launches the selected product with limited profile access', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const flatpakId = `org.${productId}.desktop`;
		assert.deepEqual(resolveDesktopSmokeInvocation({ ...options, productId, flatpakId }), {
			command: 'flatpak',
			args: ['run', '--user', `--filesystem=${options.profile}`, flatpakId, ...appArgs],
		});
	}
});

test('installed Flatpak smoke preserves Xvfb and ordinary unpacked launches', () => {
	const flatpakId = 'org.soundscaper.desktop';
	assert.deepEqual(resolveDesktopSmokeInvocation({ ...options, flatpakId, useXvfb: true }), {
		command: 'xvfb-run',
		args: ['-a', 'flatpak', 'run', '--user', `--filesystem=${options.profile}`, flatpakId, ...appArgs],
	});
	assert.deepEqual(resolveDesktopSmokeInvocation(options), {
		command: options.executable,
		args: appArgs,
	});
	assert.deepEqual(resolveDesktopSmokeInvocation({ ...options, useXvfb: true }), {
		command: 'xvfb-run',
		args: ['-a', options.executable, ...appArgs],
	});
});

test('installed Flatpak smoke rejects empty, foreign, and mismatched IDs and non-Linux hosts', () => {
	for (const flatpakId of ['', 'org.example.desktop', 'org.framescaper.desktop', 'org.soundscaper', '--command=sh']) {
		assert.throws(
			() => resolveDesktopSmokeInvocation({ ...options, flatpakId }),
			/SOUNDSCAPER_SMOKE_FLATPAK_ID must be org\.soundscaper\.desktop/u,
		);
	}
	assert.throws(
		() => resolveDesktopSmokeInvocation({ ...options, productId: 'framescaper', flatpakId: 'org.soundscaper.desktop' }),
		/SOUNDSCAPER_SMOKE_FLATPAK_ID must be org\.framescaper\.desktop/u,
	);
	for (const platform of ['darwin', 'win32']) {
		assert.throws(
			() => resolveDesktopSmokeInvocation({ ...options, flatpakId: 'org.soundscaper.desktop', platform }),
			/Flatpak desktop smoke requires Linux/u,
		);
	}
});

test('installed Flatpak smoke CLI cleans its profile and enforces the full payload contract', {
	skip: process.platform !== 'linux',
}, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-flatpak-smoke-test-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const invocationPath = join(directory, 'invocation.json');
	await writeFile(join(directory, 'flatpak'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.SMOKE_TEST_INVOCATION, JSON.stringify(process.argv.slice(2)));
console.log('SOUNDSCAPER_DESKTOP_SMOKE ' + process.env.SMOKE_TEST_PAYLOAD);
`, { mode: 0o755 });
	const payload = validPayload();
	const env = {
		...process.env,
		PATH: `${directory}${delimiter}${process.env.PATH}`,
		SCAPE_PRODUCT: 'soundscaper',
		SMOKE_TEST_INVOCATION: invocationPath,
		SOUNDSCAPER_SMOKE_ARCH: 'x64',
		SOUNDSCAPER_SMOKE_FLATPAK_ID: 'org.soundscaper.desktop',
		SOUNDSCAPER_SMOKE_XVFB: 'false',
	};
	for (const nodeExposed of [false, true]) {
		const result = spawnSync(process.execPath, [resolve('scripts/desktop-smoke.mjs')], {
			encoding: 'utf8',
			env: { ...env, SMOKE_TEST_PAYLOAD: JSON.stringify({ ...payload, nodeExposed }) },
			timeout: 10_000,
		});
		assert.equal(result.error, undefined);
		assert.equal(result.status, nodeExposed ? 1 : 0, result.stderr);
		if (nodeExposed) assert.match(result.stderr, /Smoke exposed Node\.js globals/u);
		else assert.match(result.stdout, /^SOUNDSCAPER_DESKTOP_SMOKE /u);
		const args = JSON.parse(await readFile(invocationPath, 'utf8'));
		const profile = args[4].slice('--user-data-dir='.length);
		assert.deepEqual(args, [
			'run', '--user', `--filesystem=${profile}`, 'org.soundscaper.desktop',
			`--user-data-dir=${profile}`, '--soundscaper-smoke',
			`--soundscaper-smoke-app-data=${join(profile, 'application-data')}`,
		]);
		assert.equal(existsSync(profile), false, 'the smoke profile must be removed on success and failure');
	}
});

function validPayload() {
	return {
		bridge: [...SOUNDSCAPER_DESKTOP_SMOKE_EXPECTED_BRIDGE],
		desktopChrome: {
			documentDesktop: true, shellDesktop: true, fullBleed: true, customHeader: true,
			titlebarDraggable: true, controlsNoDrag: true, controlsVisible: true,
			maximizeEnabled: true, controlOrder: ['fullscreen', 'minimize', 'maximize', 'quit'],
			fileAccessKey: 'Alt+F',
		},
		environment: { arch: 'x64', platform: 'linux', version: '1.0.0' },
		hasEditor: true,
		nodeExposed: false,
		saveOwnerReady: true,
		title: 'Soundscaper',
		url: 'soundscaper-app://bundle/',
	};
}
