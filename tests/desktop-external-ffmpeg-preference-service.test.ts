/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegPreferenceService,
	type ExternalFfmpegPreferenceProbeResult,
	type ExternalFfmpegPreferenceSettings,
} from '../desktop/external-ffmpeg-preference-service.ts';
import { planExternalFfmpegInstall } from '../desktop/external-ffmpeg-installer.ts';

const PATH = '/opt/homebrew/bin/ffmpeg';
const IDENTITY = Object.freeze({
	version: '9.0.1', ffmpegSha256: '1'.repeat(64), ffprobeSha256: '2'.repeat(64),
	dependencyClosureSha256: '3'.repeat(64),
});
const CAPABILITIES = Object.freeze({ digest: '4'.repeat(64), probedAtEpochMs: 1_787_605_200_000 });

test('persisted executable evidence starts quarantined until this process probes it', async () => {
	const settings = settingsFixture({ executablePath: PATH, identity: IDENTITY, capabilities: CAPABILITIES });
	const service = createExternalFfmpegPreferenceService(ports(settings));
	assert.deepEqual(await service.status(), status('quarantined', {
		location: PATH, canClear: true,
		detail: 'The saved FFmpeg installation must be rescanned before use.',
	}));
	assert.equal(service.admission(), null);
});

test('Browse probes the exact chosen executable and commits only verified evidence', async () => {
	const settings = settingsFixture(null);
	const probes: Array<string | null> = [];
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		choose: () => Promise.resolve(PATH),
		probe: (selectedPath) => { probes.push(selectedPath); return Promise.resolve(available()); },
	}));
	assert.deepEqual(await service.choose(), status('ready', {
		location: PATH, version: '9.0.1', canClear: true,
		detail: 'FFmpeg 9.0.1 passed the compatibility probe.',
	}));
	assert.deepEqual(probes, [PATH]);
	assert.deepEqual(settings.calls, [
		['select', PATH],
		['evidence', { executablePath: PATH, identity: IDENTITY, capabilities: CAPABILITIES }],
	]);
	assert.deepEqual(service.admission(), {
		executablePath: PATH, version: '9.0.1', capabilityGeneration: '4'.repeat(64),
		identity: IDENTITY,
		capabilities: {
			encoders: ['libopus'], decoders: ['opus'], muxers: ['opus'],
			demuxers: ['ogg'], filters: ['aresample'],
		},
	});
});

test('an incompatible manual selection stays selected but has no trusted evidence', async () => {
	const settings = settingsFixture(null);
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		choose: () => Promise.resolve(PATH),
		probe: () => Promise.resolve({
			status: 'unavailable', state: 'unsupported', location: PATH,
			detail: 'The selected FFmpeg release is outside the supported range.',
		}),
	}));
	assert.deepEqual(await service.choose(), status('unsupported', {
		location: PATH, canClear: true,
		detail: 'The selected FFmpeg release is outside the supported range.',
	}));
	assert.deepEqual(settings.calls, [['select', PATH], ['clear-evidence', PATH]]);
	assert.equal(service.admission(), null);
	assert.equal((await service.choose()).state, 'unsupported');
});

test('cancelled Browse preserves state and Clear removes selection and admission', async () => {
	const settings = settingsFixture(null);
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		choose: () => Promise.resolve(null), probe: () => Promise.resolve(available()),
	}));
	assert.equal((await service.choose()).state, 'unconfigured');
	assert.deepEqual(settings.calls, []);

	const selectedSettings = settingsFixture(null);
	const selected = createExternalFfmpegPreferenceService(ports(selectedSettings, {
		choose: () => Promise.resolve(PATH), probe: () => Promise.resolve(available()),
	}));
	await selected.choose();
	assert.equal((await selected.clear()).state, 'unconfigured');
	assert.equal(selected.admission(), null);
	assert.deepEqual(selectedSettings.calls.at(-1), ['clear']);
});

test('Install discloses and confirms the exact main-owned plan before execution', async () => {
	const settings = settingsFixture(null);
	const planned = planExternalFfmpegInstall({ platform: 'darwin', architecture: 'arm64' });
	assert.equal(planned.status, 'planned');
	if (planned.status !== 'planned') return;
	const confirmations: unknown[] = [];
	const installations: unknown[] = [];
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		plan: () => planned,
		confirm: (plan) => { confirmations.push(plan); return Promise.resolve(true); },
		install: (plan) => {
			installations.push(plan);
			return Promise.resolve({ status: 'installed', exitCode: 0, stdout: 'private output', stderr: '' });
		},
		probe: () => Promise.resolve(available()),
	}));
	const result = await service.install();
	assert.equal(result.state, 'ready');
	assert.deepEqual(confirmations, [planned.plan]);
	assert.deepEqual(installations, [planned.plan]);
	assert.equal(result.detail.includes('private output'), false);
});

test('declined or failed installation never probes and exposes no process output', async () => {
	for (const [confirmed, outcome, expectedState] of [
		[false, { status: 'installed', exitCode: 0, stdout: '', stderr: '' }, 'unconfigured'],
		[true, { status: 'failed', reason: 'nonzero-exit', detail: 'failed', stdout: '/private/home', stderr: 'secret' }, 'error'],
	] as const) {
		let probes = 0;
		const service = createExternalFfmpegPreferenceService(ports(settingsFixture(null), {
			confirm: () => Promise.resolve(confirmed),
			install: () => Promise.resolve(outcome),
			probe: () => { probes += 1; return Promise.resolve(available()); },
		}));
		const result = await service.install();
		assert.equal(result.state, expectedState);
		assert.equal(result.detail.includes('/private/home'), false);
		assert.equal(result.detail.includes('secret'), false);
		assert.equal(probes, 0);
	}
});

test('preference mutations are single-flight and never run a second probe concurrently', async () => {
	const pending = deferred<ExternalFfmpegPreferenceProbeResult>();
	let probes = 0;
	const service = createExternalFfmpegPreferenceService(ports(settingsFixture(null), {
		probe: () => { probes += 1; return pending.promise; },
	}));
	const first = service.rescan();
	await Promise.resolve();
	assert.equal((await service.status()).state, 'probing');
	assert.equal((await service.rescan()).state, 'probing');
	assert.equal(probes, 1);
	pending.resolve(available());
	assert.equal((await first).state, 'ready');
});

test('runtime identity failures quarantine only the admission that actually failed', async () => {
	const settings = settingsFixture(null);
	let evidence = available();
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		choose: () => Promise.resolve(PATH),
		probe: () => Promise.resolve(evidence),
	}));
	await service.choose();
	const failedAdmission = service.admission();
	assert.ok(failedAdmission);

	assert.deepEqual(
		await service.invalidateAdmission(failedAdmission, 'identity-changed'),
		status('quarantined', {
			location: PATH, canClear: true,
			detail: 'The admitted FFmpeg executable changed and must be rescanned.',
		}),
	);
	assert.equal(service.admission(), null);
	assert.deepEqual(settings.calls.at(-1), ['clear-evidence', PATH]);

	evidence = available({ ffmpegSha256: '5'.repeat(64), capabilityDigest: '6'.repeat(64) });
	assert.equal((await service.rescan()).state, 'ready');
	const replacement = service.admission();
	assert.ok(replacement);
	assert.notEqual(replacement.capabilityGeneration, failedAdmission.capabilityGeneration);
	const callsBeforeStaleFailure = settings.calls.length;
	assert.equal((await service.invalidateAdmission(failedAdmission, 'identity-changed')).state, 'ready');
	assert.equal(service.admission(), replacement);
	assert.equal(settings.calls.length, callsBeforeStaleFailure);
});

test('runtime invalidation wins over an in-flight rescan of the same admission', async () => {
	const settings = settingsFixture(null);
	const pending = deferred<ExternalFfmpegPreferenceProbeResult>();
	let usePending = false;
	const service = createExternalFfmpegPreferenceService(ports(settings, {
		choose: () => Promise.resolve(PATH),
		probe: () => usePending ? pending.promise : Promise.resolve(available()),
	}));
	await service.choose();
	const failedAdmission = service.admission();
	assert.ok(failedAdmission);
	usePending = true;
	const rescan = service.rescan();
	await Promise.resolve();
	await service.invalidateAdmission(failedAdmission, 'executable-unavailable');
	pending.resolve(available());
	assert.equal((await rescan).state, 'unavailable');
	assert.equal(service.admission(), null);
	assert.deepEqual(await service.status(), status('unavailable', {
		location: PATH, canClear: true,
		detail: 'The admitted FFmpeg executable is no longer available and must be rescanned.',
	}));
});

interface SettingsFixture extends ExternalFfmpegPreferenceSettings {
	readonly calls: unknown[][];
}

function settingsFixture(selection: ReturnType<ExternalFfmpegPreferenceSettings['snapshot']>['externalFfmpegSelection']): SettingsFixture {
	let current = selection;
	const calls: unknown[][] = [];
	return {
		calls,
		snapshot: () => ({ externalFfmpegSelection: current }),
		setExternalFfmpegSelection: (path) => {
			calls.push(['select', path]); current = { executablePath: path, identity: null, capabilities: null };
			return Promise.resolve(current);
		},
		setExternalFfmpegProbeMetadata: (value) => {
			calls.push(['evidence', value]); current = value; return Promise.resolve(current);
		},
		clearExternalFfmpegProbeMetadata: (path) => {
			calls.push(['clear-evidence', path]); current = { executablePath: path, identity: null, capabilities: null };
			return Promise.resolve(current);
		},
		clearExternalFfmpegSelection: () => { calls.push(['clear']); current = null; return Promise.resolve(null); },
	};
}

function ports(settings: SettingsFixture, overrides: Partial<Parameters<typeof createExternalFfmpegPreferenceService>[0]> = {}) {
	const planned = planExternalFfmpegInstall({ platform: 'darwin', architecture: 'arm64' });
	return {
		settings,
		choose: () => Promise.resolve(null),
		probe: () => Promise.resolve({ status: 'unavailable', state: 'unavailable', location: null, detail: 'No compatible FFmpeg was found.' } as const),
		plan: () => planned,
		confirm: () => Promise.resolve(false),
		install: () => Promise.resolve({ status: 'cancelled', detail: 'cancelled', stdout: '', stderr: '' } as const),
		...overrides,
	};
}

function available(overrides: Readonly<{
	readonly ffmpegSha256?: string;
	readonly capabilityDigest?: string;
}> = {}): ExternalFfmpegPreferenceProbeResult {
	const identity = Object.freeze({
		...IDENTITY,
		...(overrides.ffmpegSha256 === undefined ? {} : { ffmpegSha256: overrides.ffmpegSha256 }),
	});
	const capabilities = Object.freeze({
		...CAPABILITIES,
		...(overrides.capabilityDigest === undefined ? {} : { digest: overrides.capabilityDigest }),
	});
	return {
		status: 'available',
		evidence: { executablePath: PATH, identity, capabilities },
		capabilities: {
			encoders: ['libopus'], decoders: ['opus'], muxers: ['opus'],
			demuxers: ['ogg'], filters: ['aresample'],
		},
	};
}

function status(state: string, overrides: Record<string, unknown> = {}) {
	return {
		state, location: null, version: null, detail: '',
		canInstall: true, canBrowse: true, canClear: false, ...overrides,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}
