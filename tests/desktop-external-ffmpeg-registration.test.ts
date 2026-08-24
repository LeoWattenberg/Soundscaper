/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerExternalFfmpegPreferences } from '../desktop/external-ffmpeg-registration.mjs';
import { createExternalFfmpegInstallerBroker, planExternalFfmpegInstall } from '../desktop/external-ffmpeg-installer.ts';
import { registerExternalFfmpegPreferenceMainIpc } from '../desktop/external-ffmpeg-preference-main-ipc.ts';
import { createExternalFfmpegPreferenceService } from '../desktop/external-ffmpeg-preference-service.ts';

const CHANNELS = Object.freeze({
	externalFfmpegStatus: 'status', externalFfmpegChoose: 'choose', externalFfmpegClear: 'clear',
	externalFfmpegRescan: 'rescan', externalFfmpegInstall: 'install',
});
const PATH = '/opt/homebrew/bin/ffmpeg';

test('registration composes Browse, probe, confirmation, install, and exact IPC actions', async () => {
	const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
	const dialogs: unknown[] = [];
	const installs: unknown[] = [];
	const directories: unknown[] = [];
	const settings = settingsFixture();
	const registration = await registerExternalFfmpegPreferences({
		channels: CHANNELS,
		handle: (channel: string, listener: (...arguments_: unknown[]) => unknown) => { handlers.set(channel, listener); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
		settings,
		dialog: {
			showOpenDialog: async (_window: unknown, options: unknown) => {
				dialogs.push(['open', options]); return { canceled: false, filePaths: [PATH] };
			},
			showMessageBox: async (_window: unknown, options: unknown) => {
				dialogs.push(['confirm', options]); return { response: 1 };
			},
		},
		windowFor: () => ({ id: 'main-window' }),
		platform: 'darwin', architecture: 'arm64', userDataPath: '/user-data', environment: { PATH: '/bin' },
		mkdir: async (...arguments_: unknown[]) => { directories.push(arguments_); },
		loadModules: async () => ({
			createExternalFfmpegInstallerBroker,
			createExternalFfmpegInstallerNodeRunner: () => async (request: unknown) => {
				installs.push(request);
				return { status: 'exited', exitCode: 0, signal: null, stdout: '', stderr: '' };
			},
			createExternalFfmpegPreferenceNodeProbe: () => async () => available(),
			createExternalFfmpegPreferenceService,
			planExternalFfmpegInstall,
			registerExternalFfmpegPreferenceMainIpc,
		}),
	});
	assert.deepEqual([...handlers.keys()], ['status', 'choose', 'clear', 'rescan', 'install']);
	assert.deepEqual(directories, [['/user-data/external-ffmpeg', { recursive: true, mode: 0o700 }]]);
	assert.equal((await handlers.get('status')?.({} as never) as { state: string }).state, 'unconfigured');
	assert.equal((await handlers.get('choose')?.({} as never) as { state: string }).state, 'ready');
	assert.equal(settings.snapshot().externalFfmpegSelection?.executablePath, PATH);
	assert.equal((await handlers.get('install')?.({} as never) as { state: string }).state, 'ready');
	assert.equal(installs.length, 1);
	assert.match(JSON.stringify(dialogs), /brew install ffmpeg/u);
	assert.equal(registration.service.admission()?.executablePath, PATH);
	registration.dispose();
	assert.equal(handlers.size, 0);
});

test('cancelled file and install dialogs cause no mutation or package-manager process', async () => {
	const settings = settingsFixture();
	let installCalls = 0;
	const registration = await registerExternalFfmpegPreferences({
		channels: CHANNELS, handle() {}, removeHandler() {}, settings,
		dialog: {
			showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
			showMessageBox: () => Promise.resolve({ response: 0 }),
		},
		windowFor: () => null, platform: 'linux', architecture: 'x64',
		userDataPath: '/data', environment: {}, mkdir: () => Promise.resolve(),
		loadModules: async () => ({
			createExternalFfmpegInstallerBroker,
			createExternalFfmpegInstallerNodeRunner: () => async () => {
				installCalls += 1;
				return { status: 'exited', exitCode: 0, signal: null, stdout: '', stderr: '' };
			},
			createExternalFfmpegPreferenceNodeProbe: () => async () => available(),
			createExternalFfmpegPreferenceService,
			planExternalFfmpegInstall,
			registerExternalFfmpegPreferenceMainIpc,
		}),
	});
	assert.equal((await registration.service.choose()).state, 'unconfigured');
	assert.equal((await registration.service.install()).state, 'unconfigured');
	assert.equal(installCalls, 0);
	assert.equal(settings.snapshot().externalFfmpegSelection, null);
	registration.dispose();
});

test('Windows registration resolves WinGet from LOCALAPPDATA instead of inherited PATH', async () => {
	let plannedRequest: unknown;
	const registration = await registerExternalFfmpegPreferences({
		channels: CHANNELS, handle() {}, removeHandler() {}, settings: settingsFixture(),
		dialog: {
			showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
			showMessageBox: () => Promise.resolve({ response: 0 }),
		},
		windowFor: () => null, platform: 'win32', architecture: 'arm64',
		userDataPath: '/user-data',
		environment: {
			LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
			PATH: 'C:\\attacker-controlled',
		},
		mkdir: () => Promise.resolve(),
		loadModules: async () => ({
			createExternalFfmpegInstallerBroker,
			createExternalFfmpegInstallerNodeRunner: () => async () => ({
				status: 'exited', exitCode: 0, signal: null, stdout: '', stderr: '',
			}),
			createExternalFfmpegPreferenceNodeProbe: () => async () => available(),
			createExternalFfmpegPreferenceService,
			planExternalFfmpegInstall: (request: unknown) => {
				plannedRequest = request;
				return planExternalFfmpegInstall(request as Parameters<typeof planExternalFfmpegInstall>[0]);
			},
			registerExternalFfmpegPreferenceMainIpc,
		}),
	});
	await registration.service.status();
	assert.deepEqual(plannedRequest, {
		platform: 'win32', architecture: 'arm64',
		packageManagerExecutable: 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe',
	});
	registration.dispose();
});

function settingsFixture() {
	type Selection = Readonly<{
		executablePath: string;
		identity: Readonly<Record<string, unknown>> | null;
		capabilities: Readonly<Record<string, unknown>> | null;
	}>;
	let selection: Selection | null = null;
	return {
		snapshot: () => ({ externalFfmpegSelection: selection }),
		setExternalFfmpegSelection: async (path: string) => (selection = { executablePath: path, identity: null, capabilities: null }),
		setExternalFfmpegProbeMetadata: async (value: Selection) => (selection = value),
		clearExternalFfmpegProbeMetadata: async (path: string) => (selection = { executablePath: path, identity: null, capabilities: null }),
		clearExternalFfmpegSelection: async () => (selection = null),
	};
}

function available() {
	return {
		status: 'available' as const,
		evidence: {
			executablePath: PATH,
			identity: { version: '9.0.1', ffmpegSha256: '1'.repeat(64), ffprobeSha256: '2'.repeat(64), dependencyClosureSha256: '3'.repeat(64) },
			capabilities: { digest: '4'.repeat(64), probedAtEpochMs: 1 },
		},
		capabilities: { encoders: [], decoders: [], muxers: [], demuxers: [], filters: [] },
	};
}
