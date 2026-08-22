/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	framescaperImageSequenceImportAuthorityMounted,
	startFramescaperNativeServicesRegistration,
} from '../desktop/framescaper-native-services-registration.mjs';

test('Soundscaper never starts the Framescaper service database', async () => {
	const registration = await startFramescaperNativeServicesRegistration(options('soundscaper'), {
		modules: {
			startMediaRuntime: () => { throw new Error('must not start media'); },
			startRuntime: () => { throw new Error('must not start'); },
			registerIpc: () => { throw new Error('must not register'); },
			createNodePorts: () => { throw new Error('must not create filesystem ports'); },
			createExternalDisplayPort: () => { throw new Error('must not create display ports'); },
		},
		loadCapabilityPolicy: () => { throw new Error('must not load policy'); },
	});
	assert.equal(registration, null);
});

test('Framescaper owns one runtime, authenticates every IPC caller, and closes idempotently', async () => {
	let runtimeOptions;
	let ipcOptions;
	let closes = 0;
	let ipcDisposals = 0;
	let mediaDisposals = 0;
	let openFxDisposals = 0;
	let openFxServiceDisposals = 0;
	let openFxServiceDisables = 0;
	let mediaAvailable = false;
	let authorityOptions;
	let renderInputOptions;
	let selectedV20AuthorityOptions;
	let queueCapacityOptions;
	let brokerOptions;
	let nodePortOptions;
	let brokerDisposals = 0;
	let renderInputOwnerDisposals = 0;
	let imageSequenceOwnerDisposals = 0;
	let imageSequenceDisposals = 0;
	let failImageSequenceDispose = false;
	let renderInputReclaims = 0;
	let externalDisplayStops = 0;
	const controller = Object.freeze({ kind: 'controller' });
	const mediaRuntime = {
		available: () => mediaAvailable,
		payloadAvailability: { status: 'unavailable', reason: 'payload-pending-external', detail: 'No payload.' },
		reason: 'payload-pending-external: No payload.',
		snapshot: () => null,
		selfTestEvidence: () => null,
		selectedV20RenderSelfTestEvidence: () => null,
		runJob: async () => ({ output: true }),
		dispose: () => { mediaDisposals += 1; },
	};
	const openFxRuntime = {
		available: () => false,
		selfTestPassed: () => false,
		payloadAvailability: { status: 'unavailable', reason: 'payload-pending-external', detail: 'No OFX payload.' },
		reason: 'payload-pending-external: No OFX payload.',
		manager: null,
		dispose: () => { openFxDisposals += 1; },
	};
	const openFxService = {
		scan: async () => null, inventory: () => [], control: async () => ({}),
		execute: async () => ({ mode: 'bypass' }),
		disable: () => { openFxServiceDisables += 1; },
		dispose: () => { openFxServiceDisposals += 1; },
	};
	const nodePorts = {
		mintOpaqueId: () => 'a'.repeat(40), selectRoot: async () => null,
		probeRoot: async () => null, watchScan: async () => [], watchProbe: async () => null,
		watchRegisterLocator: async () => ({}), watchReleaseLocator: async () => true,
		scratchCleanup: {}, publicationPortFor: () => ({}), checkpointInspectFor: () => async () => null,
		checkpointStore: { read: async () => null, write: async () => undefined },
	};
	const externalDisplay = Object.freeze({
		kind: 'external-display',
		stop: () => { externalDisplayStops += 1; },
	});
	const prepared = Object.freeze({ request: { kind: 'media-render' }, publish: async () => undefined });
	const queueCapacity = async () => Object.freeze({
		availableCpuCores: 4, availableProcessTreeRssBytes: 1024 ** 3,
		availableScratchBytes: 1024 ** 3, volumeFreeBytes: 20 * 1024 ** 3,
		reservedFreeBytes: 10 * 1024 ** 3, busyHardwareBackends: [],
	});
	const projectAuthorityRuntime = {
		revalidate: async (_record, _root, rootAuthorized) => ({
			projectRevisionMatches: true, planFingerprintMatches: true,
			inputFingerprintsMatch: true, rootGrantAuthorized: rootAuthorized, rootGrantValid: true,
			licensingCleared: false, helperBuildMatches: false, scratchIdentityMatches: true,
		}),
		prepare: async () => prepared,
		projectState: () => Object.freeze({ open: true, writable: true }),
		watchProject: () => Object.freeze({ schemaVersion: 20, projectId: 'project-1', projectRevision: 1, open: true, writable: true }),
	};
	const renderInputStaging = Object.freeze({
		begin: async () => ({}), receive: async () => undefined, finalize: async () => ({}),
		abandonOwner: async () => { renderInputOwnerDisposals += 1; return 2; },
		reclaim: async (records) => { renderInputReclaims += 1; assert.deepEqual(records, []); },
	});
	const watchImportBroker = {
		offer: async () => true, recorded: () => true, claim: () => null,
		complete: async () => true, dispose: async () => { brokerDisposals += 1; },
	};
	const registrationInput = options('framescaper');
	const registration = await startFramescaperNativeServicesRegistration(registrationInput, {
		modules: {
			ImageSequenceSelectionBroker: class extends TestImageSequenceSelectionBroker {
				disposeOwner() { imageSequenceOwnerDisposals += 1; return 1; }
				dispose() {
					imageSequenceDisposals += 1;
					if (failImageSequenceDispose) throw new Error('selection cleanup failed');
				}
			},
			startMediaRuntime: async () => mediaRuntime,
			startOpenFxRuntime: async () => openFxRuntime,
			createOpenFxService: () => openFxService,
			createNodePorts: (value) => { nodePortOptions = value; return nodePorts; },
			createExternalDisplayPort: () => externalDisplay,
			createQueueCapacityProvider: (value) => { queueCapacityOptions = value; return queueCapacity; },
			createCapabilityReport: (value) => Object.freeze({ value }),
			createProjectAuthority: (value) => { authorityOptions = value; return projectAuthorityRuntime; },
			createRenderInputStaging: (value) => { renderInputOptions = value; return renderInputStaging; },
			createSelectedV20ProjectAuthority: (value) => {
				selectedV20AuthorityOptions = value;
				return projectAuthorityRuntime;
			},
			createWatchImportBroker: (value) => { brokerOptions = value; return watchImportBroker; },
			externalDisplaySupport: () => Object.freeze({ supported: true, reason: null }),
			startRuntime: (value) => {
				runtimeOptions = value;
				return { controller, queue: { list: () => [] }, ready: Promise.resolve(),
					close: () => { closes += 1; } };
			},
			registerIpc: (value) => {
				ipcOptions = value;
				return Object.freeze({ dispose: () => { ipcDisposals += 1; } });
			},
		},
		loadCapabilityPolicy: async () => Object.freeze({
			nativeCodecsCleared: true, proxyCodecCleared: true,
			imageSequencesCleared: true, openFxCleared: false,
		}),
	});
	assert.ok(registration);
	assert.match(runtimeOptions.databasePath, /framescaper-native-services\.sqlite$/u);
	assert.equal(runtimeOptions.runtimeAvailable(), false);
	assert.equal(renderInputReclaims, 1);
	mediaAvailable = true;
	assert.equal(runtimeOptions.runtimeAvailable(), true);
	assert.equal(runtimeOptions.nativeQueueExecution.pool, mediaRuntime);
	assert.equal(runtimeOptions.nativeQueueExecution.capacity, queueCapacity);
	assert.match(queueCapacityOptions.scratchRoot, /framescaper-native-scratch$/u);
	const capabilities = runtimeOptions.capabilities();
	assert.equal(capabilities.value.media.payloadBuilt, false);
	assert.equal(capabilities.value.media.buildFingerprint, null);
	assert.equal(capabilities.value.openFx.payloadBuilt, false);
	assert.equal(capabilities.value.openFx.selfTestPassed, false);
	assert.equal(capabilities.value.queueSourceAuthorityMounted, true);
	assert.equal(capabilities.value.queueCapacityAuthorityMounted, true);
	assert.equal(capabilities.value.watchProjectMutationMounted, true);
	assert.equal(capabilities.value.imageSequenceImportMounted, false);
	assert.equal(capabilities.value.externalDisplay.placementSupported, true);
	mediaRuntime.payloadAvailability = {
		status: 'available', descriptor: { sha256: 'b'.repeat(64) },
	};
	mediaRuntime.reason = null;
	mediaRuntime.selfTestEvidence = () => ({ professionalCharacteristicsMatches: true });
	mediaRuntime.selectedV20RenderSelfTestEvidence = () => ({ ready: true });
	const attestedCapabilities = runtimeOptions.capabilities();
	assert.equal(attestedCapabilities.value.media.professionalCharacteristicsSelfTestPassed, true);
	assert.equal(attestedCapabilities.value.media.selectedV20RenderSelfTestPassed, true);
	assert.equal(attestedCapabilities.value.imageSequenceImportMounted, false,
		'an attested probe does not route or ship the dormant V25 mutation surface');
	assert.equal(await runtimeOptions.nativeQueueExecution.prepare({}, {}), prepared);
	assert.deepEqual(await runtimeOptions.revalidate({ record: {}, root: {}, rootAuthorized: true }), {
		projectRevisionMatches: true, planFingerprintMatches: true,
		inputFingerprintsMatch: true, rootGrantAuthorized: true, rootGrantValid: true,
		licensingCleared: false, helperBuildMatches: false, scratchIdentityMatches: true,
	});
	assert.equal(authorityOptions.project, registrationInput.projectAuthority);
	assert.equal(authorityOptions.checkpointStore, nodePorts.checkpointStore);
	assert.equal(authorityOptions.checkpointInspectFor, nodePorts.checkpointInspectFor);
	assert.match(renderInputOptions.root, /framescaper-native-render-inputs$/u);
	assert.equal(renderInputOptions.mintStageId, nodePorts.mintOpaqueId);
	assert.equal(selectedV20AuthorityOptions.project, projectAuthorityRuntime);
	assert.equal(selectedV20AuthorityOptions.renderInputs, renderInputStaging);
	assert.equal(runtimeOptions.checkpointStore, nodePorts.checkpointStore);
	assert.equal(authorityOptions.licensingCleared({ taskKind: 'encoded-export' }), true);
	assert.equal(authorityOptions.licensingCleared({ taskKind: 'proxy-generation' }), true);
	assert.equal(authorityOptions.licensingCleared({ taskKind: 'image-sequence-export' }), true);
	assert.equal(nodePortOptions.watchLocator, registrationInput.watchImportAuthority.locator);
	assert.equal(runtimeOptions.nativeMediaEnabled(), false);
	assert.equal(runtimeOptions.selectRoot, nodePorts.selectRoot);
	assert.equal(runtimeOptions.watchScan, nodePorts.watchScan);
	assert.equal(runtimeOptions.externalDisplay, externalDisplay);
	assert.deepEqual(runtimeOptions.watchProjectState('project-1'), { open: true, writable: true });
	assert.equal(await runtimeOptions.watchImportFile(), false, 'the default-off master blocks watch mutation');
	registrationInput.settings.snapshot = () => ({
		nativeMediaEnabled: true, nativeHardwareDecodeEnabled: false,
		nativeHardwareEncodeEnabled: false, ofxConsentEnabled: false,
	});
	assert.equal(await runtimeOptions.watchImportFile(), true);
	registrationInput.settings.snapshot = () => ({
		nativeMediaEnabled: false, nativeHardwareDecodeEnabled: false,
		nativeHardwareEncodeEnabled: false, ofxConsentEnabled: false,
	});
	assert.equal(typeof runtimeOptions.watchImportRecorded, 'function');
	assert.equal(brokerOptions.currentOwner, registrationInput.watchImportAuthority.currentOwner);
	assert.deepEqual(runtimeOptions.preferences(), {
		nativeMediaEnabled: false, hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false, ofxConsentEnabled: false,
	});
	assert.equal(await runtimeOptions.setPreference('hardware-decode', true), true);
	assert.equal(await runtimeOptions.setPreference('native-media', false), false);
	assert.equal(externalDisplayStops, 1,
		'disabling the master closes a still-presenting session immediately');
	assert.equal(openFxServiceDisables, 1);
	let owners = 0;
	registration.registerRendererBridge({
		handle: () => undefined,
		removeHandler: () => undefined,
		on: () => undefined,
		removeListener: () => undefined,
		ownerFor: () => { owners += 1; return {}; },
	});
	assert.equal(ipcOptions.controller, controller);
	assert.equal(typeof ipcOptions.imageSequenceSelections.select, 'function',
		'the pathless picker remains mounted while project mutation stays fail closed');
	assert.deepEqual(ipcOptions.authorizeOwner({}), {});
	assert.equal(typeof ipcOptions.watchImports.claim, 'function');
	assert.equal(ipcOptions.renderInputs, renderInputStaging);
	assert.equal(typeof ipcOptions.openFx.scan, 'function');
	assert.deepEqual(await registration.executeOpenFx({}), { mode: 'bypass' });
	assert.equal(owners, 1);
	assert.equal(await registration.revokeOwner({}), 3);
	assert.equal(openFxServiceDisables, 2,
		'losing the renderer owner aborts scanner and per-fingerprint OpenFX work');
	assert.equal(renderInputOwnerDisposals, 1);
	assert.equal(imageSequenceOwnerDisposals, 1);
	assert.throws(() => registration.registerRendererBridge({}), /already registered/iu);
	failImageSequenceDispose = true;
	await assert.rejects(() => registration.dispose(), /selection cleanup failed/u);
	assert.equal(await registration.dispose(), false);
	assert.equal(ipcDisposals, 1);
	assert.equal(closes, 1);
	assert.equal(mediaDisposals, 1);
	assert.equal(openFxDisposals, 1);
	assert.equal(openFxServiceDisposals, 1);
	assert.equal(brokerDisposals, 1);
	assert.equal(imageSequenceDisposals, 1);
});

test('a runtime startup failure releases the session display subscription', async () => {
	let disposals = 0;
	await assert.rejects(() => startFramescaperNativeServicesRegistration(options('framescaper'), {
		modules: {
			ImageSequenceSelectionBroker: TestImageSequenceSelectionBroker,
			startMediaRuntime: async () => ({ available: () => false, dispose: () => undefined }),
			startOpenFxRuntime: async () => ({
				available: () => false, selfTestPassed: () => false, dispose: () => undefined,
				payloadAvailability: { status: 'unavailable' }, reason: 'unavailable', manager: null,
			}),
			createOpenFxService: () => ({
				scan: async () => null, inventory: () => [], control: async () => ({}),
				execute: async () => ({}), disable: () => undefined,
				dispose: () => undefined,
			}),
			createNodePorts: () => ({}),
			createExternalDisplayPort: () => ({ dispose: () => { disposals += 1; } }),
			createProjectAuthority: () => ({
				revalidate: async () => ({}), prepare: async () => ({}),
				projectState: () => ({ open: false, writable: false }),
				watchProject: () => null,
			}),
			createRenderInputStaging: () => ({}),
			createSelectedV20ProjectAuthority: ({ project }) => project,
			createWatchImportBroker: () => ({ dispose: async () => undefined }),
			startRuntime: (value) => {
				assert.equal(value.nativeQueueExecution, undefined);
				assert.equal(value.capabilities().value.queueCapacityAuthorityMounted, false);
				throw new Error('startup failed');
			},
			registerIpc: () => { throw new Error('must not register'); },
			createCapabilityReport: (value) => ({ value }),
			externalDisplaySupport: () => ({ supported: false, reason: 'unsupported-platform' }),
		},
		loadCapabilityPolicy: async () => ({
			nativeCodecsCleared: false, proxyCodecCleared: false,
			imageSequencesCleared: false, openFxCleared: false,
		}),
	}), /startup failed/u);
	assert.equal(disposals, 1);
});

test('desktop main mounts the Framescaper registration after settings and includes it in shutdown', async () => {
	const source = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
	assert.match(source, /startFramescaperNativeServicesRegistration/u);
	assert.match(source, /native services['"],\s*run:\s*\(\)\s*=>\s*nativeServices\?\.dispose/u);
	assert.match(source, /nativeServices\?\.registerRendererBridge/u);
	assert.match(source, /watchImportAuthority:[\s\S]*currentRendererSaveOwner[\s\S]*watchImportAuthority\(\)/u);
	assert.match(source, /imageSequenceImportAuthority:\s*null/u,
		'the selected V20 main composition must not attest a dormant V25 project mutation route');
	assert.ok(
		source.indexOf('await settings.load') < source.indexOf('startFramescaperNativeServicesRegistration({'),
		'native service settings authority must be loaded before its runtime starts',
	);
	assert.ok(source.indexOf("{ name: 'native services'") < source.indexOf("{ name: 'linked-video locators'"),
		'native watch claims must release their locator before the locator store closes');
});

test('only an exact routed V25/V26 mutation authority mounts image-sequence import', () => {
	const authority = Object.freeze({
		candidateGeneration: 25,
		projectMutationSurface: 'image-sequence-import',
		professionalCharacteristicsContract: 'video-source-characteristics-v25',
		isRouted: () => true,
	});
	assert.equal(framescaperImageSequenceImportAuthorityMounted(null), false);
	assert.equal(framescaperImageSequenceImportAuthorityMounted(authority), true);
	assert.equal(framescaperImageSequenceImportAuthorityMounted({
		...authority, isRouted: () => false,
	}), false);
	assert.throws(() => framescaperImageSequenceImportAuthorityMounted({
		...authority, candidateGeneration: 20,
	}), /authority is invalid/iu);
	assert.throws(() => framescaperImageSequenceImportAuthorityMounted({
		...authority, extra: true,
	}), /authority is invalid/iu);
});

function options(productId) {
	const settings = {
		snapshot: () => ({
			nativeMediaEnabled: false, nativeHardwareDecodeEnabled: false,
			nativeHardwareEncodeEnabled: false, ofxConsentEnabled: false,
		}),
		setNativeMediaEnabled: (enabled) => Promise.resolve(enabled),
		setNativeHardwareDecodeEnabled: (enabled) => Promise.resolve(enabled),
		setNativeHardwareEncodeEnabled: (enabled) => Promise.resolve(enabled),
		setOfxConsentEnabled: (enabled) => Promise.resolve(enabled),
	};
	return {
		productId,
		userDataPath: '/tmp/soundscaper-native-services-test',
		instanceId: 'instance-native-services',
		processId: 42,
		settings,
		onFenced: () => undefined,
		onServiceError: () => undefined,
		selectDirectory: async () => null,
		selectImageSequenceFiles: async () => null,
		selectOpenFxPluginBinary: async () => null,
		imageSequenceImportAuthority: null,
		createMessageChannel: () => ({ hostPort: {}, helperPort: {} }),
		projectAuthority: {
			projectState: () => ({ open: true, writable: true }),
			projectRecord: () => null,
			readProjectBundle: async () => null,
			readBody: async () => new Uint8Array(),
		},
		watchImportAuthority: {
			currentOwner: () => null,
			isOwnerCurrent: () => false,
			locator: { registerPath: async () => ({}), release: async () => false },
		},
		externalDisplay: {
			platform: 'linux', linuxSessionType: 'x11', isEnabled: () => false,
			listDisplays: () => [], createWindow: () => ({}), sinkSelfTestPassed: () => true,
			subscribe: () => () => undefined, onError: () => undefined,
		},
	};
}

class TestImageSequenceSelectionBroker {
	select() { return null; }
	read() { return new Uint8Array(); }
	release() { return true; }
	dispose() { return 0; }
}
