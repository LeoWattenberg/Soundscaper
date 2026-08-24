/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	createFramescaperNativeQueueStorageAuthority,
	failClosedFramescaperMediaRevalidation,
	imageSequenceImportAuthorityPort,
	registrationOptions,
} from './framescaper-native-services-options.mjs';
import { createFramescaperOpenFxCurrentProjectAuthority, createFramescaperOpenFxFrameRegistration } from './framescaper-openfx-frame-registration.mjs';
/** Mount the dormant service database for Framescaper only; payload availability stays explicit. */
export async function startFramescaperNativeServicesRegistration(value, dependencies = {}) {
	const options = registrationOptions(value);
	if (options.productId !== 'framescaper') return null;
	const modules = dependencies.modules ?? await loadRuntimeModules();
	const reserveBackend = modules.createV14QueueReservationAuthority({
		platform: options.externalDisplay.platform,
		hardwareEncodeEnabled: () => options.settings.snapshot().nativeHardwareEncodeEnabled === true,
	});
	const capabilityPolicy = await (dependencies.loadCapabilityPolicy ?? loadCapabilityPolicy)();
	const scratchRoot = resolve(options.userDataPath, 'framescaper-native-scratch');
	const nodePorts = modules.createNodePorts({
		scratchRoot,
		selectDirectory: options.selectDirectory,
		...(options.watchImportAuthority === null ? {} : {
			watchLocator: options.watchImportAuthority.locator,
		}),
	});
	let storageAuthority = null;
	const renderInputStaging = modules.createRenderInputStaging({
		root: resolve(options.userDataPath, 'framescaper-native-render-inputs'),
		mintStageId: nodePorts.mintOpaqueId, createMessageChannel: options.createMessageChannel,
		storageAdmission: (...args) => storageAuthority === null
			? Promise.reject(new Error('Selected V14 storage admission is unavailable.'))
			: storageAuthority.admitStage(...args),
	});
	const capacityFactory = modules.createQueueCapacityProvider;
	const queueCapacity = capacityFactory === undefined ? null : capacityFactory({ scratchRoot });
	if (queueCapacity !== null && typeof queueCapacity !== 'function') throw new TypeError('Framescaper native queue capacity authority is invalid.');
	const mediaRuntime = await modules.startMediaRuntime({
		enabled: () => options.settings.snapshot().nativeMediaEnabled === true,
		v14: Object.freeze({
			scratchRoot: resolve(options.userDataPath, 'framescaper-native-v14-helper'),
			createMessageChannel: options.createMessageChannel,
		}),
	});
	let openFxRuntime;
	try { openFxRuntime = await modules.startOpenFxRuntime(); }
	catch (error) {
		mediaRuntime.dispose();
		throw error;
	}
	let imageSequenceSelectionBroker;
	try {
		imageSequenceSelectionBroker = new modules.ImageSequenceSelectionBroker({
			selectFiles: options.selectImageSequenceFiles,
			mintOpaqueId: nodePorts.mintOpaqueId,
		});
	} catch (error) {
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	let runtime;
	let releaseRuntime;
	const runtimeReady = new Promise((resolveRuntime) => { releaseRuntime = resolveRuntime; });
	const proxyOutputBroker = new modules.ProxyOutputBroker({
		queueRecord: (jobId) => runtime?.queue.read(jobId) ?? null,
		rootGrant: (grantId) => runtime?.roots.read(grantId) ?? null,
		mintClaimId: nodePorts.mintOpaqueId,
	});
	let imageSequenceImport = null;
	const projectBodyAuthority = options.projectAuthority === null ? null : modules.createProjectAuthority({
		project: options.projectAuthority,
		scratchRoot,
		executable: () => mediaExecutable(mediaRuntime),
		createMessageChannel: options.createMessageChannel,
		probeRoot: nodePorts.probeRoot,
		publicationPortFor: nodePorts.publicationPortFor,
		publicationFenceFor: (record, root) => {
			const assert = async () => {
				const currentRuntime = await runtimeReady;
				const service = currentRuntime.publicationFence;
				if (service === null) throw new Error('Native publication fencing is unavailable.');
				await service.for(record, root).beforePublication();
			};
			return Object.freeze({ beforePublication: assert, afterPublication: assert });
		},
		checkpointStore: nodePorts.checkpointStore,
		checkpointInspectFor: nodePorts.checkpointInspectFor,
		onCheckpointError: options.onServiceError,
		reserveScratch: async (request) => {
			const currentRuntime = await runtimeReady;
			const existing = currentRuntime.scratch.read(request.jobId);
			if (existing !== null) {
				if (existing.directoryName !== request.directoryName
					|| existing.manifestDigest !== request.manifestDigest
					|| existing.rootIdentity !== request.rootIdentity
					|| existing.reservedBytes !== request.requestedBytes
					|| existing.state !== 'reserved') {
					throw new Error('Recovered native scratch no longer matches its exact reservation.');
				}
				return;
			}
			const now = Date.now();
			currentRuntime.scratch.reserve(
				{ ...request, createdAtMs: now }, currentRuntime.lease.lease(), now,
			);
		},
		settleScratch: async (jobId, outcome) => {
			const currentRuntime = await runtimeReady;
			await currentRuntime.scratch.settle(
				jobId, outcome, Date.now(), nodePorts.scratchCleanup, currentRuntime.lease.lease(),
			);
		},
		scratchMatches: async (record, manifestDigest) => {
			const currentRuntime = await runtimeReady;
			const reservation = currentRuntime.scratch.read(record.jobId);
			if (reservation === null || reservation.state !== 'reserved'
				|| reservation.directoryName !== `job-${record.jobId}`
				|| reservation.manifestDigest !== manifestDigest) return false;
			const observed = await nodePorts.scratchCleanup.inspect(reservation.directoryName);
			return observed?.jobId === record.jobId
				&& observed.manifestDigest === reservation.manifestDigest
				&& observed.rootIdentity === reservation.rootIdentity;
		},
		licensingCleared: (record) => queueOperationCleared(capabilityPolicy, record),
	});
	const projectAuthority = projectBodyAuthority === null ? null
			: modules.createSelectedV28ProjectAuthority({
				project: options.projectAuthority, watch: projectBodyAuthority, runtime: mediaRuntime,
				renderInputs: renderInputStaging,
			platform: options.externalDisplay.platform, probeRoot: nodePorts.probeRoot,
			hardwareEncodeEnabled: () => options.settings.snapshot().nativeHardwareEncodeEnabled === true,
			publicationPortFor: nodePorts.publicationPortFor,
			publicationFenceFor: (record, root) => {
				const assert = async () => {
					const currentRuntime = await runtimeReady;
					const service = currentRuntime.publicationFence;
					if (service === null) throw new Error('Native publication fencing is unavailable.');
					await service.for(record, root).beforePublication();
				};
				return Object.freeze({ beforePublication: assert, afterPublication: assert });
			},
			licensingCleared: (record) => queueOperationCleared(capabilityPolicy, record),
				recordProxyOutput: (record, root, receipt) => (
					proxyOutputBroker.recordPublished(record, root, receipt)
				),
			});
	storageAuthority = projectAuthority === null || queueCapacity === null ? null
		: createFramescaperNativeQueueStorageAuthority({
			projectAuthority: () => projectAuthority, renderInputStaging, queueCapacity,
			runtime: () => runtimeReady, reserveBackend,
		});
	const currentOpenFxProject = createFramescaperOpenFxCurrentProjectAuthority(options.projectAuthority); let openFxService, openFxFrames;
	try {
		openFxService = modules.createOpenFxService({
			runtime: openFxRuntime,
			scratchRoot: resolve(options.userDataPath, 'framescaper-openfx-scratch'),
			preferences: () => preferenceSnapshot(options.settings.snapshot()),
			policyCleared: () => capabilityPolicy.openFxCleared === true,
			selectPluginBinary: options.selectOpenFxPluginBinary,
			createMessageChannel: options.createMessageChannel,
			currentProject: currentOpenFxProject,
			videoTimingAssets: (plan) => projectBodyAuthority?.openFxTimingAssets(plan)
				?? Promise.reject(new Error('OpenFX project timing authority is unavailable.')),
			mintOpaqueId: nodePorts.mintOpaqueId,
		});
		openFxFrames = await (modules.createOpenFxFrameRegistration
			?? createFramescaperOpenFxFrameRegistration)({
			openFxService, projectBodyAuthority, createMessageChannel: options.createMessageChannel,
			currentProject: ({ project }, effect) => currentOpenFxProject(project, effect),
			mintOpaqueId: nodePorts.mintOpaqueId, onError: options.onServiceError,
		});
	} catch (error) {
		imageSequenceSelectionBroker.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	// V28 evaluates exact OpenFX planes; the live stage relays that carrier once.
	const watchImportBroker = projectAuthority === null || options.watchImportAuthority === null
		? null
		: modules.createWatchImportBroker({
			currentOwner: options.watchImportAuthority.currentOwner,
			isOwnerCurrent: options.watchImportAuthority.isOwnerCurrent,
			inspectProject: (projectId) => projectAuthority.watchProject(projectId),
			alreadyImported: (projectId, digest) => projectAuthority.watchImportAlreadyPresent(projectId, digest),
			inspectImported: (projectId, binId, digest) => projectAuthority.watchImportState(projectId, binId, digest),
			createLocator: nodePorts.watchRegisterLocator,
			releaseLocator: nodePorts.watchReleaseLocator,
			mintOpaqueId: nodePorts.mintOpaqueId,
		});
	let externalDisplay;
	try { externalDisplay = modules.createExternalDisplayPort(options.externalDisplay); }
	catch (error) {
		void watchImportBroker?.dispose().catch(options.onServiceError);
		imageSequenceSelectionBroker.dispose();
		openFxService.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	try {
		runtime = modules.startRuntime({
			databasePath: resolve(options.userDataPath, 'framescaper-native-services.sqlite'),
			leaseId: randomUUID(),
			instanceId: options.instanceId,
			processId: options.processId,
			runtimeAvailable: () => mediaRuntime.available(),
			nativeMediaEnabled: () => options.settings.snapshot().nativeMediaEnabled === true,
			reserveQueue: reserveBackend,
			capabilities: () => modules.createCapabilityReport(capabilityReportOptions({
				preferences: preferenceSnapshot(options.settings.snapshot()),
				mediaRuntime,
				openFxRuntime,
				policy: capabilityPolicy,
				externalDisplay: options.externalDisplay,
				externalDisplaySupport: modules.externalDisplaySupport,
				queueSourceAuthorityMounted: projectAuthority !== null, queueCapacityAuthorityMounted: queueCapacity !== null,
				watchProjectMutationMounted: watchImportBroker !== null,
				imageSequenceImportMounted: imageSequenceImport !== null,
			})),
				revalidate: ({ record, root, rootAuthorized }) => projectAuthority === null
					? failClosedFramescaperMediaRevalidation(mediaRuntime.available(), rootAuthorized)
				: projectAuthority.revalidate(record, root, rootAuthorized),
			...(projectAuthority === null || queueCapacity === null ? {} : { nativeQueueExecution: {
					capacity: queueCapacity,
					prepare: (record, root) => projectAuthority.prepare(record, root),
					onError: options.onServiceError,
			} }),
			preferences: () => preferenceSnapshot(options.settings.snapshot()),
			setPreference: async (preference, enabled) => {
				const result = await setPreference(options.settings, preference, enabled);
				if (preference === 'native-media') {
					if (result === true) await mediaRuntime.activate();
					else {
						mediaRuntime.deactivate();
						externalDisplay.stop();
					}
				}
				if ((preference === 'native-media' || preference === 'ofx-consent')
					&& result === false) openFxService.disable();
				return result;
			},
			onFenced: options.onFenced,
			onWatchError: options.onServiceError,
			mintOpaqueId: nodePorts.mintOpaqueId,
			mintJobId: nodePorts.mintOpaqueId,
			selectRoot: nodePorts.selectRoot,
			probeRoot: nodePorts.probeRoot,
			watchScan: nodePorts.watchScan,
			watchProbe: nodePorts.watchProbe,
			watchProjectState: projectAuthority === null
				? () => Object.freeze({ open: false, writable: false })
				: (projectId) => projectAuthority.projectState(projectId),
			watchImportFile: watchImportBroker === null
				? async () => false
				: (request) => options.settings.snapshot().nativeMediaEnabled === true
					? watchImportBroker.offer(request)
					: Promise.resolve(false),
			...(watchImportBroker === null ? {} : {
				watchImportRecorded: (request) => { void watchImportBroker.recorded(request); },
			}),
			scratchCleanup: nodePorts.scratchCleanup,
			publicationPortFor: nodePorts.publicationPortFor,
			checkpointInspectFor: nodePorts.checkpointInspectFor,
			checkpointStore: nodePorts.checkpointStore,
			externalDisplay,
			removeRenderInputs: (record) => renderInputStaging.remove(record),
		});
		releaseRuntime(runtime);
	} catch (error) {
		externalDisplay.dispose?.();
		void watchImportBroker?.dispose().catch(options.onServiceError);
		imageSequenceSelectionBroker.dispose();
		openFxService.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	try {
		await runtime.ready;
		await renderInputStaging.reclaim(runtime.queue.list());
		if (framescaperImageSequenceImportAuthorityMounted(options.imageSequenceImportAuthority)) imageSequenceImport = await modules.createImageSequenceImportRegistration({
			userDataPath: options.userDataPath, route: options.imageSequenceImportAuthority,
			project: options.projectAuthority, controller: runtime.controller, mediaRuntime,
			executable: () => mediaExecutable(mediaRuntime), createMessageChannel: options.createMessageChannel,
			mintOpaqueId: nodePorts.mintOpaqueId, runtimeAvailable: () => mediaRuntime.available() && options.settings.snapshot().nativeMediaEnabled === true, policyCleared: capabilityPolicy.imageSequencesCleared === true,
		});
	} catch (error) {
		await runtime.close();
		void watchImportBroker?.dispose().catch(options.onServiceError);
		imageSequenceSelectionBroker.dispose();
		openFxService.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	let ipc = null;
	let disposed = false;
	return Object.freeze({
		controller: runtime.controller,
		renderInputs: renderInputStaging,
		registerRendererBridge(bridge) {
			if (disposed) throw new Error('Framescaper native services are disposed.');
			if (ipc !== null) throw new Error('Framescaper native-services IPC is already registered.');
			const registered = modules.registerIpc({
				handle: bridge.handle,
				removeHandler: bridge.removeHandler,
				on: bridge.on,
				removeListener: bridge.removeListener,
				authorizeOwner: (event) => bridge.ownerFor(event),
				controller: runtime.controller,
				renderInputs: renderInputStaging,
				...(storageAuthority === null ? {} : { queueReservations: storageAuthority.reserveQueue }),
				...(watchImportBroker === null ? {} : {
					watchImports: Object.freeze({
						claim: (owner, request) => watchImportBroker.claim(owner, request),
						complete: (owner, request) => watchImportBroker.complete(owner, request),
					}),
				}),
				imageSequenceSelections: Object.freeze({
					select: (owner, request) => imageSequenceSelectionBroker.select(owner, request),
					read: (owner, request) => imageSequenceSelectionBroker.read(owner, request),
					release: (owner, request) => imageSequenceSelectionBroker.release(owner, request),
				}),
				proxyOutputs: Object.freeze({
					claim: (owner, request) => proxyOutputBroker.claim(owner, request),
					read: (owner, request) => proxyOutputBroker.read(owner, request),
					release: (owner, request) => proxyOutputBroker.release(owner, request),
				}),
					openFx: Object.freeze({
					scan: () => openFxService.scan(),
					inventory: () => openFxService.inventory(),
						control: (request) => openFxService.control(request),
						interact: (request) => openFxService.interact(request),
					}),
					openFxFrames: Object.freeze({ open: (...args) => openFxFrames.open(...args) }),
			});
			try { imageSequenceImport?.registerRendererBridge(bridge); }
			catch (error) { void Promise.resolve(registered.dispose()).catch(options.onServiceError); throw error; }
			ipc = registered;
			return ipc;
		},
		async revokeOwner(owner) {
			if (disposed) return 0;
			openFxService.disable();
			const revoked = await Promise.all([
				renderInputStaging.abandonOwner(owner),
				Promise.resolve().then(() => imageSequenceSelectionBroker.disposeOwner(owner)),
				proxyOutputBroker.disposeOwner(owner),
				imageSequenceImport?.revokeOwner(owner),
				openFxFrames.disposeOwner(owner),
			]);
			return revoked.reduce((total, value) => total
				+ (Number.isSafeInteger(value) ? value : 0), 0);
		},
		executeOpenFx: (request) => openFxService.execute(request),
		async dispose() {
			if (disposed) return false;
			disposed = true;
			const registeredIpc = ipc;
			ipc = null;
			const cleanups = [
				() => registeredIpc?.dispose(),
				() => runtime.close(),
				() => watchImportBroker?.dispose(),
				() => imageSequenceSelectionBroker.dispose(),
				() => proxyOutputBroker.dispose(),
					() => imageSequenceImport?.dispose(),
					() => openFxFrames.dispose(),
				() => openFxService.dispose(),
				() => openFxRuntime.dispose(),
				() => mediaRuntime.dispose(),
			];
			const results = await Promise.allSettled(
				cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
			);
			const failure = results.find((result) => result.status === 'rejected');
			if (failure !== undefined) throw failure.reason;
			return true;
		},
	});
}
function preferenceSnapshot(value) {
	return Object.freeze({
		nativeMediaEnabled: value.nativeMediaEnabled === true,
		hardwareDecodeEnabled: value.nativeHardwareDecodeEnabled === true,
		hardwareEncodeEnabled: value.nativeHardwareEncodeEnabled === true,
		ofxConsentEnabled: value.ofxConsentEnabled === true,
	});
}
function setPreference(settings, preference, enabled) {
	if (preference === 'native-media') return settings.setNativeMediaEnabled(enabled);
	if (preference === 'hardware-decode') return settings.setNativeHardwareDecodeEnabled(enabled);
	if (preference === 'hardware-encode') return settings.setNativeHardwareEncodeEnabled(enabled);
	if (preference === 'ofx-consent') return settings.setOfxConsentEnabled(enabled);
	throw new TypeError('Framescaper named an unsupported native-service preference.');
}
async function loadRuntimeModules() {
	const [runtime, ipc, nodePorts, externalDisplay, nativeMedia, openFx, openFxService,
		capabilityReport, displayController,
		projectAuthority, selectedV28Authority, watchImportBroker,
		imageSequenceSelection, imageSequenceImport, proxyOutputs, queueCapacity, renderInputs,
		backendAuthority] = await Promise.all([
		import('./project-library-runtime/desktop/native-services-runtime-v3.js'),
		import('./project-library-runtime/desktop/native-services-main-ipc.js'),
		import('./project-library-runtime/desktop/native-services-node-ports.js'),
		import('./project-library-runtime/desktop/native-services-external-display-port.js'),
		import('./framescaper-native-media-electron-runtime.mjs'),
		import('./framescaper-openfx-electron-runtime.mjs'),
		import('./project-library-runtime/desktop/openfx-main-service.js'),
		import('./project-library-runtime/desktop/native-media-capability-report.js'),
		import('./project-library-runtime/desktop/external-display-controller.js'),
		import('./project-library-runtime/desktop/native-services-project-authority.js'),
		import('./project-library-runtime/desktop/native-services-selected-v28-project-authority.js'),
		import('./project-library-runtime/desktop/native-services-watch-import-broker.js'),
		import('./project-library-runtime/desktop/native-image-sequence-selection.js'),
		import('./project-library-runtime/desktop/framescaper-native-image-sequence-registration.js'),
		import('./project-library-runtime/desktop/native-services-proxy-output-broker.js'),
		import('./project-library-runtime/desktop/native-queue-capacity-provider-v3.js'),
		import('./project-library-runtime/desktop/native-services-render-input-router.js'),
		import('./project-library-runtime/desktop/native-services-v14-backend-authority.js'),
	]);
	return Object.freeze({
		startRuntime: runtime.startFramescaperNativeServicesRuntimeV3,
		registerIpc: ipc.registerFramescaperNativeServicesMainIpc,
		createNodePorts: nodePorts.createFramescaperNativeServicesNodePorts,
		createExternalDisplayPort: externalDisplay.createFramescaperNativeExternalDisplayPort,
		createQueueCapacityProvider: queueCapacity.createFramescaperNativeQueueCapacityProviderV3,
		createV14QueueReservationAuthority: backendAuthority.createFramescaperNativeV14QueueReservationAuthority,
		createRenderInputStaging: (options) => (
			new renderInputs.FramescaperNativeRenderInputRouter(options)
		),
		startMediaRuntime: nativeMedia.startFramescaperNativeMediaElectronRuntime,
		startOpenFxRuntime: openFx.startFramescaperOpenFxElectronRuntime,
		createOpenFxService: (options) => new openFxService.FramescaperOpenFxMainService(options),
		createCapabilityReport: capabilityReport.createFramescaperNativeCapabilityReportV1,
		externalDisplaySupport: displayController.externalDisplayPlacementSupport,
		createProjectAuthority: (options) => new projectAuthority.FramescaperNativeProjectAuthority(options),
		createSelectedV28ProjectAuthority: (options) => (
			new selectedV28Authority.FramescaperNativeSelectedV28ProjectAuthority(options)
		),
		createWatchImportBroker: (options) => new watchImportBroker.FramescaperNativeWatchImportBroker(options),
		ImageSequenceSelectionBroker: imageSequenceSelection.FramescaperNativeImageSequenceSelectionBroker,
		createImageSequenceImportRegistration: imageSequenceImport.createFramescaperNativeImageSequenceRegistration,
		ProxyOutputBroker: proxyOutputs.FramescaperNativeProxyOutputBroker,
	});
}
function capabilityReportOptions({
	preferences, mediaRuntime, openFxRuntime, policy, externalDisplay, externalDisplaySupport,
	queueSourceAuthorityMounted, queueCapacityAuthorityMounted, watchProjectMutationMounted,
	imageSequenceImportMounted,
}) {
	const payload = mediaRuntime.payloadAvailability;
	const payloadBuilt = payload?.status === 'available';
	const pool = mediaRuntime.snapshot?.() ?? null;
	const mediaSelfTest = mediaRuntime.selfTestEvidence?.() ?? null;
	const selectedV20RenderSelfTest = mediaRuntime.selectedV20RenderSelfTestEvidence?.() ?? null;
	const selectedV28V14RenderSelfTest = mediaRuntime.selectedV28V14RenderSelfTestEvidence?.() ?? null;
	const quarantined = pool !== null && pool.quarantinedWorkers >= pool.configuredWorkers;
	const degraded = pool !== null && pool.quarantinedWorkers > 0 && !quarantined;
	const placement = externalDisplaySupport(externalDisplay.platform, externalDisplay.linuxSessionType);
	const mediaDetail = payloadBuilt && mediaRuntime.reason === null
		? 'The current-target media host passed authenticated utility-process self-tests.'
		: payloadBuilt
			? `The current-target media host is authenticated but inactive: ${String(mediaRuntime.reason)}.`
		: String(mediaRuntime.reason ?? `${String(payload?.reason ?? 'payload-unavailable')}: ${String(payload?.detail ?? 'No payload evidence exists.')}`);
	const openFxPayload = openFxRuntime.payloadAvailability;
	const openFxPayloadBuilt = openFxPayload?.status === 'available';
	const openFxSnapshots = openFxRuntime.manager?.snapshot().runtimes ?? [];
	const openFxQuarantined = openFxSnapshots.some((entry) => entry.quarantined === true);
	const openFxDetail = openFxPayloadBuilt
		? openFxRuntime.selfTestPassed()
			? 'The authenticated scanner and one fingerprint runtime passed utility-process self-tests.'
			: 'The authenticated OpenFX payload pair is mounted; scanner/runtime self-tests remain unobserved.'
		: String(openFxRuntime.reason ?? `${String(openFxPayload?.reason ?? 'payload-unavailable')}: ${String(openFxPayload?.detail ?? 'No payload evidence exists.')}`);
	return Object.freeze({
		preferences,
		media: Object.freeze({
			payloadBuilt,
			runtimeAvailable: mediaRuntime.available(),
			selfTestPassed: payloadBuilt && mediaRuntime.reason === null,
			// Professional probing is attested separately from selected V20 rendering.
			selectedV20RenderSelfTestPassed: payloadBuilt
				&& mediaRuntime.reason === null
				&& selectedV20RenderSelfTest?.ready === true,
			selectedV28V14RenderSelfTestPassed: payloadBuilt
				&& mediaRuntime.reason === null
				&& selectedV28V14RenderSelfTest?.ready === true,
			professionalCharacteristicsSelfTestPassed: payloadBuilt
				&& mediaRuntime.reason === null
				&& mediaSelfTest?.professionalCharacteristicsMatches === true,
			quarantined,
			degraded,
			buildFingerprint: payloadBuilt ? payload.descriptor.sha256 : null,
			detail: mediaDetail.slice(0, 512),
		}),
		policy,
		queueSourceAuthorityMounted, queueCapacityAuthorityMounted,
		watchProjectMutationMounted, imageSequenceImportMounted,
		externalDisplay: Object.freeze({
			placementSupported: placement.supported,
			sinkSelfTestPassed: placement.supported && externalDisplay.sinkSelfTestPassed(),
			detail: placement.supported
				? 'Dedicated sandboxed external-display sink is built; HDR downgrades explicitly to SDR.'
				: `External-display placement is unavailable: ${String(placement.reason)}.`,
		}),
		openFx: Object.freeze({
			payloadBuilt: openFxPayloadBuilt,
			runtimeAvailable: openFxRuntime.available(),
			selfTestPassed: openFxRuntime.selfTestPassed(),
			quarantined: openFxQuarantined,
			buildFingerprint: openFxPayloadBuilt ? openFxRuntimeFingerprint(openFxPayload.descriptor) : null,
			detail: openFxDetail.slice(0, 512),
		}),
	});
}
function openFxRuntimeFingerprint(descriptor) {
	return createHash('sha256').update(JSON.stringify(Object.freeze({
		target: descriptor.target,
		scannerSha256: descriptor.scanner.sha256,
		runtimeHostSha256: descriptor.runtimeHost.sha256,
		productionReadiness: descriptor.productionReadiness,
	}))).digest('hex');
}
/** A pathless picker is not exact V25 project mutation authority. */
export function framescaperImageSequenceImportAuthorityMounted(value) {
	if (value === null) return false;
	if (!imageSequenceImportAuthorityPort(value)) {
		throw new TypeError('Framescaper image-sequence import authority is invalid.');
	}
	try { return value.isRouted() === true; }
	catch { return false; }
}
async function loadCapabilityPolicy() {
	let value;
	try {
		value = JSON.parse(String(await readFile(resolve(
			import.meta.dirname, '../config/production-licensing-matrix.json',
		))));
	} catch (error) {
		throw new Error('Framescaper cannot read its native capability policy.', { cause: error });
	}
	return framescaperNativeCapabilityPolicy(value);
}
export function framescaperNativeCapabilityPolicy(value) {
	const nativeCodecsCleared = policyRowCleared(value, 'futureDistributionGates', 'native-codecs')
		&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-native-ffmpeg-current-set');
	const selectedRenderCodecCleared = nativeCodecsCleared
		&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-encode-prores-mov-422-hq');
	const proxyCodecCleared = nativeCodecsCleared
		&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-encode-prores-mov-proxy');
	return Object.freeze({
		nativeCodecsCleared,
		selectedRenderCodecCleared,
		proxyCodecCleared,
		imageSequencesCleared: nativeCodecsCleared
			&& [
				'codec-decode-png-image-sequence',
				'codec-decode-tiff-image-sequence',
				'codec-decode-openexr-image-sequence',
				'codec-encode-png-image-sequence',
				'codec-encode-tiff-image-sequence',
				'codec-encode-openexr-image-sequence',
			].every((id) => policyRowCleared(value, 'nativeFormatPolicies', id)),
		openFxCleared: policyRowCleared(value, 'futureDistributionGates', 'native-plugins')
			&& policyRowCleared(value, 'nativeFormatPolicies', 'plugin-format-ofx')
			&& policyRowCleared(value, 'runtimeProvenance', 'framescaper-openfx-1-5-1-source-candidate'),
	});
}
export function framescaperNativeQueueOperationCleared(policy, record) {
	if (record?.taskKind === 'encoded-export') return policy.selectedRenderCodecCleared === true;
	if (record?.taskKind === 'proxy-generation') return policy.proxyCodecCleared === true;
	if (record?.taskKind === 'image-sequence-export') return policy.imageSequencesCleared === true;
	return false;
}
const queueOperationCleared = framescaperNativeQueueOperationCleared;
export function framescaperNativePolicyRowCleared(value, collection, id) {
	const rows = value?.[collection];
	if (!Array.isArray(rows)) throw new TypeError(`Licensing policy ${collection} is absent.`);
	const matches = rows.filter((row) => row?.id === id);
	if (matches.length !== 1 || typeof matches[0]?.status !== 'string') {
		throw new TypeError(`Licensing policy row ${id} is absent or duplicated.`);
	}
	const accepted = collection === 'futureDistributionGates' ? ['enabled']
		: collection === 'nativeFormatPolicies' ? ['implemented']
			: collection === 'runtimeProvenance' ? ['documented', 'recorded'] : null;
	if (accepted === null) throw new TypeError(`Licensing policy ${collection} is unsupported.`);
	return accepted.includes(matches[0].status);
}
const policyRowCleared = framescaperNativePolicyRowCleared;
function mediaExecutable(mediaRuntime) {
	const payload = mediaRuntime.payloadAvailability;
	if (payload?.status !== 'available') return null;
	const { path, byteLength, sha256, identity } = payload.descriptor;
	return Object.freeze({ path, byteLength, sha256, identity });
}
