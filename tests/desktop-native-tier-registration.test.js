/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { IPC } from '../desktop/constants.js';
import {
	nativeTierPluginObservation as pluginObservation,
	nativeTierScanEntry as scanEntry,
} from './helpers/desktop-native-tier-fixtures.js';
import {
	DesktopNativeAudioSessionService,
	DesktopPluginHostService,
	DesktopPluginQuarantine,
	DesktopPluginRegistry,
	NATIVE_CHANNELS,
	PLUGIN_FAULT_KINDS,
	ROOT,
	ReadCapabilityStore,
	admitCustomRoot,
	admittedRootIds,
	createRegistration,
	createScannerQuarantinePort,
	createSettings,
	disposeDesktopNativeTier,
	isGranted,
	observeScannedPlugins,
	recordScannedPlugins,
	registerDesktopHelperProbe,
	registerDesktopNativeTier,
	registrationOptions,
	revokeDesktopNativeTierOwner,
	scanDigestFor,
	temporaryUserData,
	writeQuarantine,
} from './helpers/desktop-native-tier-harness.js';

test('the shared IPC map and the sandbox preload declare the very same channels', async () => {
	const preloadSource = await readFile(join(ROOT, 'desktop', 'preload.mjs'), 'utf8');
	const declaration = /const CHANNELS = Object\.freeze\((\{[\s\S]*?\n\}),?\n?\);/u.exec(preloadSource);
	assert.ok(declaration, 'the preload declares its channel table as one frozen literal');
	const declared = vm.runInNewContext(`(${declaration[1]})`, { Object });
	// The preload runs as a sandboxed plain script and cannot import the shared
	// map, so the two tables are compared instead: a channel main registers
	// under a name the bridge does not invoke is a surface nobody can reach.
	assert.deepEqual({ ...declared }, { ...IPC });
});

test('registering the native tier claims every declared channel exactly once', async (context) => {
	const registration = createRegistration(await temporaryUserData(context));
	for (const channel of registration.channels) {
		assert.equal(typeof channel, 'string', 'every registered channel is a defined string');
		assert.notEqual(channel, '');
	}
	assert.equal(new Set(registration.channels).size, registration.channels.length,
		'a channel registered twice makes Electron refuse the second handler and exit the application');
	assert.deepEqual([...registration.channels].sort(), [...NATIVE_CHANNELS].sort());
	assert.notEqual(registration.tier.audio.supervisorPort, registration.tier.plugins.supervisorPort,
		'audio sessions and plug-in scans must never share a process lifecycle or quarantine generation');
	assert.ok(registration.tier.audio.sessions instanceof DesktopNativeAudioSessionService);
	assert.ok(registration.tier.plugins.hostService instanceof DesktopPluginHostService);
	await disposeDesktopNativeTier(registration.tier);
});

test('the native tier refuses an options bag missing a seam it forwards', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const complete = registrationOptions(userDataPath);
	for (const missing of [
		'channels', 'handle', 'ownerFor', 'settings', 'desktopRoot', 'userDataPath', 'parentWindow',
		'productId', 'nativePluginStateAuthority',
	]) {
		const options = { ...complete };
		delete options[missing];
		assert.throws(() => registerDesktopNativeTier(options), new RegExp(missing, 'u'),
			`a native tier registered without ${missing} must fail by name rather than deep inside a helper`);
	}
});

test('the renderer can change native-audio preference through the bounded main channel', async (context) => {
	let ownerReads = 0;
	const registration = createRegistration(await temporaryUserData(context), { nativeAudioHelperEnabled: false }, {
		ownerFor: () => { ownerReads += 1; return {}; },
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));

	assert.deepEqual(registration.tier.audio.controlSnapshot(), { enabled: false, quarantined: false });
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, false);
	assert.equal(await registration.invoke(IPC.nativeAudioSetEnabled, true), true);
	assert.deepEqual(registration.tier.audio.controlSnapshot(), { enabled: true, quarantined: false });
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, true);
	assert.equal(ownerReads, 1, 'the setter must validate the active renderer owner before changing authority');
	assert.equal(await registration.invoke(IPC.nativeAudioSetEnabled, 'true'), false,
		'the main boundary must not coerce renderer input');
	assert.equal(ownerReads, 2);
});

test('production audio-session IPC reaches the real service and keeps unavailable targets closed', async (context) => {
	const registration = createRegistration(await temporaryUserData(context));
	context.after(() => disposeDesktopNativeTier(registration.tier));
	const outcome = await registration.invoke(IPC.nativeAudioSessionOpen, {
		candidates: [{ backend: 'pipewire', deviceHandle: 'opaque-device-1' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2,
	});
	assert.deepEqual(outcome, {
		status: 'refused', code: 'backend-absent',
		message: 'No requested audio backend is present.',
		attempts: [{
			backend: 'pipewire', status: 'backend-absent',
			detail: 'That native audio backend remains behind its production activation gate.',
		}],
	});
	assert.equal(registration.tier.audio.realtimeBroker.snapshot().owned, false);
});

test('checked-in production policy blocks third-party hosting before an available payload is consulted', async (context) => {
	let helperCreations = 0;
	const registration = createRegistration(await temporaryUserData(context), {}, {
		isPluginHostFormatActivated: undefined,
		createPluginHostHelper: () => {
			helperCreations += 1;
			return {
				describePayload: () => Promise.resolve({ status: 'available' }),
				supervisor: { runJob: () => Promise.reject(new Error('must not run')), dispose: () => undefined },
			};
		},
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	const availability = await registration.invoke(IPC.nativePluginAvailability);
	const vst3 = availability.consent.formats.find(({ format }) => format === 'vst3');
	assert.deepEqual({ supported: vst3.supported, granted: vst3.granted, roots: vst3.roots }, {
		supported: false, granted: false, roots: [],
	});
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginConsent, { format: 'vst3', action: 'grant' }),
		/blocked by production policy/u,
	);
	assert.equal((await registration.invoke(IPC.nativePluginScan, {
		format: 'vst3', rootId: 'renderer-cannot-name-a-path',
	})).code, 'consent-required');
	const admission = registration.tier.plugins.registry.record(pluginObservation({ format: 'vst3' }));
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') return;
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginInstantiate, {
			installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
		}),
		/production activation gate/u,
	);
	assert.equal(helperCreations, 0, 'policy refusal must happen before payload or spawn authority is consulted');
});

test('checked-in production policy never offers or executes the fixture format', async (context) => {
	const registration = createRegistration(await temporaryUserData(context), {}, {
		isPluginHostFormatActivated: undefined,
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	const fixture = (await registration.invoke(IPC.nativePluginAvailability)).consent.formats
		.find(({ format }) => format === 'fixture');
	assert.deepEqual({ supported: fixture.supported, granted: fixture.granted, roots: fixture.roots }, {
		supported: false, granted: false, roots: [],
	});
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'grant' }),
		/blocked by production policy/u,
	);
	const admission = registration.tier.plugins.registry.record(pluginObservation());
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') return;
	await assert.rejects(() => registration.invoke(IPC.nativePluginReviewInstallation, {
		installationId: admission.installationId, action: 'allow',
	}), /blocked by production policy/u);
	await assert.rejects(() => registration.invoke(IPC.nativePluginInstantiate, {
		installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
	}), /production activation gate/u);
});

test('production plug-in IPC instantiates, runs, stores state and drains its isolated host', async (context) => {
	const owner = {};
	const disposedHosts = [];
	const registration = createRegistration(await temporaryUserData(context), {}, {
		ownerFor: () => owner,
		openPersistentPluginSession: async () => ({
			closed: new Promise(() => {}),
			transferTo: () => undefined,
			authenticateState: (value) => Uint8Array.from(value.bytes),
			vendorWindowCapability: (windowId) => `${windowId}.${'c'.repeat(64)}`,
			close: async () => undefined,
		}),
		createPluginHostHelper: () => ({
			describePayload: () => Promise.resolve({ status: 'available' }),
			supervisor: {
				runJob: () => Promise.resolve({
					reportedLatencyFrames: 32, latencyStable: true, blocksRendered: 8,
					renderedSha256: 'a'.repeat(64), stateBytes: 0, stateRefusal: null,
				}),
				dispose: () => { disposedHosts.push(true); },
			},
		}),
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	const admission = registration.tier.plugins.registry.record(pluginObservation());
	assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') return;
	assert.deepEqual(
		await registration.invoke(IPC.nativePluginReviewInstallation, {
			installationId: admission.installationId, action: 'allow',
		}),
		registration.tier.plugins.registry.describe(),
	);
	const instance = await registration.invoke(IPC.nativePluginInstantiate, {
		installationId: admission.installationId, instanceId: null, sampleRate: 48_000,
	});
	assert.equal(instance.format, 'fixture');
	assert.equal(registration.tier.plugins.hostIsolation.snapshot().hostCount, 1);
	const offline = await registration.invoke(IPC.nativePluginRunOffline, { instanceId: instance.instanceId });
	assert.equal(offline.blocksRendered, 8);
	assert.equal(offline.instance.latencySamples, 32);
	const persisted = await registration.invoke(IPC.nativePluginPersistState, {
		instanceId: instance.instanceId, generation: 1, bytes: Uint8Array.of(1, 2, 3),
	});
	assert.equal(persisted.outcome.status, 'persisted');
	assert.equal(persisted.projectState.stateBody.byteLength, 3);
	assert.equal((await registration.invoke(IPC.nativePluginOpenVendorUi, {
		instanceId: instance.instanceId,
	})).status, 'opened');
	await revokeDesktopNativeTierOwner(registration.tier, owner);
	assert.equal(registration.tier.plugins.hostIsolation.snapshot().hostCount, 0);
	assert.equal(disposedHosts.length, 1);
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginRunOffline, { instanceId: instance.instanceId }),
		/belongs to another renderer/u,
	);
});

test('a renderer with no active owner cannot change native-audio authority', async (context) => {
	const registration = createRegistration(await temporaryUserData(context), { nativeAudioHelperEnabled: false }, {
		ownerFor: () => { throw new Error('The renderer is no longer the active owner.'); },
	});
	context.after(() => disposeDesktopNativeTier(registration.tier));

	await assert.rejects(
		() => registration.invoke(IPC.nativeAudioSetEnabled, true),
		/active owner/u,
	);
	assert.equal((await registration.invoke(IPC.nativeAudioAvailability)).enabled, false);
});

test('the native tier ready seam restores the durable plug-in quarantine', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const digest = 'a'.repeat(64);
	await writeQuarantine(userDataPath, [digest]);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	assert.equal(registration.tier.plugins.quarantine.snapshot().loaded, false);
	await registration.tier.ready();
	const snapshot = registration.tier.plugins.quarantine.snapshot();
	assert.equal(snapshot.loaded, true, 'a quarantine nobody loaded refuses every scan it is consulted about');
	assert.deepEqual(snapshot.records.map((record) => record.digest), [digest]);
});

test('a scan request reaches the service as a well-formed scan root location', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const rootPath = join(userDataPath, 'fixture-plug-ins');
	await mkdir(rootPath);
	await writeQuarantine(userDataPath, [scanDigestFor('fixture', rootPath)]);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	const rootId = await admitCustomRoot(registration, rootPath);

	// The location carries the documented scan digest, so the durable quarantine
	// recognizes this root-and-format pair rather than throwing on a missing key.
	const quarantined = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(quarantined.status, 'failed');
	assert.equal(quarantined.code, 'digest-quarantined');

	assert.deepEqual(
		await registration.invoke(IPC.nativePluginClearQuarantine, {
			digest: scanDigestFor('fixture', rootPath),
			clearance: 'rescan',
		}),
		{ cleared: true },
	);
	// A cleared digest scans again, and the location's identity is captured from
	// the directory itself, so a root that has gone is refused rather than
	// handed to a helper as an undefined identity.
	const cleared = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(cleared.status, 'failed');
	assert.notEqual(cleared.code, 'digest-quarantined');
	assert.notEqual(cleared.code, 'unknown-root');
	await rm(rootPath, { recursive: true });
	const vanished = await registration.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.equal(vanished.status, 'failed');
	assert.equal(vanished.code, 'unknown-root');
});

test('an unrecognized consent action is refused rather than granted', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const registration = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(registration.tier));
	await registration.tier.ready();
	await assert.rejects(
		() => registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'not-an-action' }),
		/not an admitted plug-in consent action/u,
	);
	assert.equal(await isGranted(registration, 'fixture'), false,
		'an authorization surface must never fall open to an action it does not recognize');
	await registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'grant' });
	assert.equal(await isGranted(registration, 'fixture'), true);
	const rootPath = join(userDataPath, 'removable');
	await mkdir(rootPath);
	const rootId = await admitCustomRoot(registration, rootPath, { granted: true });
	await registration.invoke(IPC.nativePluginConsent, { format: 'fixture', action: 'remove-root', rootId });
	assert.deepEqual(await admittedRootIds(registration, 'fixture'), []);
});

test('plug-in consent and its picked folders survive a restart', async (context) => {
	const userDataPath = await temporaryUserData(context);
	const rootPath = join(userDataPath, 'kept-plug-ins');
	await mkdir(rootPath);
	const first = createRegistration(userDataPath);
	await first.tier.ready();
	const rootId = await admitCustomRoot(first, rootPath);
	await disposeDesktopNativeTier(first.tier);

	const second = createRegistration(userDataPath);
	context.after(() => disposeDesktopNativeTier(second.tier));
	await second.tier.ready();
	assert.equal(await isGranted(second, 'fixture'), true, 'a consent decision the user made must outlive the process');
	assert.deepEqual(await admittedRootIds(second, 'fixture'), [rootId]);
	const outcome = await second.invoke(IPC.nativePluginScan, { format: 'fixture', rootId });
	assert.notEqual(outcome.code, 'unknown-root');
});

test('a scanner fault is quarantined in the shape the durable store requires', async () => {
	const written = [];
	const quarantine = new DesktopPluginQuarantine({
		filePath: '/quarantine.json',
		fileSystem: {
			readFile: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
			writeFile: (_path, contents) => { written.push(contents); return Promise.resolve(); },
		},
	});
	await quarantine.load();
	const port = createScannerQuarantinePort(quarantine);
	const digest = 'b'.repeat(64);
	port.quarantine(digest, 'scanner-crash');
	await port.settle();
	assert.deepEqual(quarantine.snapshot().records, [
		{ digest, scope: 'scanner', kind: 'crash', quarantinedAt: quarantine.describe(digest).quarantinedAt },
	]);
	assert.equal(written.length, 1, 'a scanner fault that is never written is a quarantine that never survives');
	assert.equal(port.isQuarantined(digest), true);

	port.quarantine('c'.repeat(64), 'not-a-reason');
	await assert.rejects(() => port.settle(), /not-a-reason/u,
		'an unmappable scanner fault must be loud rather than swallowed');
	for (const reason of ['scanner-crash', 'scanner-hang', 'malformed-answer',
		'oversize-answer', 'malformed-plugin', 'oversize-plugin', 'identity-change']) {
		port.quarantine(createHash('sha256').update(reason).digest('hex'), reason);
	}
	await port.settle();
	for (const record of quarantine.snapshot().records) {
		assert.ok(PLUGIN_FAULT_KINDS.includes(record.kind), `${record.kind} is a fault kind the store admits`);
		assert.equal(record.scope, 'scanner');
	}
});

test('described scan entries reach the inventory the renderer lists', async () => {
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const result = {
		format: 'fixture',
		status: 'scanned',
		detail: '',
		entries: [scanEntry()],
	};
	const admissions = recordScannedPlugins(registry, result, { identityFor: () => ({ dev: 7, ino: 11 }) });
	assert.deepEqual(admissions.map((admission) => admission.status), ['recorded']);
	const view = registry.describe();
	assert.equal(view.entries.length, 1, 'an inventory nothing is ever recorded into is permanently empty');
	assert.equal(view.entries[0].name, 'Fixture Reverb');
	assert.equal(view.entries[0].installations[0].signature, 'trusted');
	assert.equal(view.entries[0].installations[0].compatibility, 'compatible');
	assert.equal(view.entries[0].eligible, true);
	assert.deepEqual(
		recordScannedPlugins(registry, result, { identityFor: () => null })
			.map((admission) => admission.status),
		['rejected'],
		'a binary that has gone is refused by name rather than recorded without its identity',
	);
});

test('the scan job answer fills the inventory on its way past', async (context) => {
	const binaryPath = join(await temporaryUserData(context), 'reverb.fixture');
	await writeFile(binaryPath, 'fixture', 'utf8');
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const answer = { format: 'fixture', status: 'scanned', detail: '', entries: [scanEntry({ binaryPath })] };
	const device = { backends: [] };
	const requests = [];
	const supervisor = observeScannedPlugins({
		runJob: (request) => {
			requests.push(request);
			return Promise.resolve(request.kind === 'plugin-scan' ? answer : device);
		},
		snapshot: () => ({ state: 'idle', quarantined: false }),
		clearQuarantine: () => {},
		dispose: () => {},
	}, registry);

	assert.equal(await supervisor.runJob({ kind: 'audio-device' }), device);
	assert.equal(registry.describe().entries.length, 0, 'only a scan job answers with plug-ins');
	assert.equal(await supervisor.runJob({ kind: 'plugin-scan' }), answer, 'the answer is handed back untouched');
	assert.deepEqual(registry.describe().entries.map((entry) => entry.name), ['Fixture Reverb']);
	assert.deepEqual(requests.map((request) => request.kind), ['audio-device', 'plugin-scan']);
});

test('the probe helper resolves its engine on use, not while the application registers', async (context) => {
	// Desktop codec policy ships no bundled FFmpeg, so a packaged application has
	// neither config/ffmpeg-runtime-manifest.json nor the engine beside it.
	// Reading them while registering made every packaged start emit an unhandled
	// rejection nobody could catch, long before any probe asked for a helper.
	const applicationRoot = await mkdtemp(join(tmpdir(), 'scape-helper-registration-'));
	context.after(() => rm(applicationRoot, { recursive: true, force: true }));
	const desktopRoot = join(applicationRoot, 'desktop');
	await mkdir(desktopRoot);
	const rejections = [];
	const recordRejection = (reason) => rejections.push(reason);
	process.on('unhandledRejection', recordRejection);
	context.after(() => process.off('unhandledRejection', recordRejection));

	const claimed = [];
	const service = registerDesktopHelperProbe({
		channels: IPC,
		handle: (channel) => claimed.push(channel),
		ownerFor: () => ({}),
		readCapabilities: new ReadCapabilityStore(),
		settings: createSettings({ nativeProbeHelperEnabled: false }),
		desktopRoot,
		packaged: true,
		resourcesPath: join(applicationRoot, 'resources'),
	});
	await new Promise((resolve) => { setImmediate(resolve); });

	assert.deepEqual(rejections, [],
		'registration must not read an engine the package is not allowed to carry');
	assert.deepEqual(claimed.sort(), [
		IPC.helperProbeAvailability, IPC.helperProbeAwait,
		IPC.helperProbeBegin, IPC.helperProbeCancel,
	].sort());
	assert.equal((await service.availability()).enabled, false);
});
