/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/** Mount the dormant service database for Framescaper only; payload availability stays explicit. */
export async function startFramescaperNativeServicesRegistration(value, dependencies = {}) {
	const options = registrationOptions(value);
	if (options.productId !== 'framescaper') return null;
	const modules = dependencies.modules ?? await loadRuntimeModules();
	const capabilityPolicy = await (dependencies.loadCapabilityPolicy ?? loadCapabilityPolicy)();
	const nodePorts = modules.createNodePorts({
		scratchRoot: resolve(options.userDataPath, 'framescaper-native-scratch'),
		selectDirectory: options.selectDirectory,
		...(options.watchImportAuthority === null ? {} : {
			watchLocator: options.watchImportAuthority.locator,
		}),
	});
	const mediaRuntime = await modules.startMediaRuntime();
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
	const projectBodyAuthority = options.projectAuthority === null ? null : modules.createProjectAuthority({
		project: options.projectAuthority,
		scratchRoot: resolve(options.userDataPath, 'framescaper-native-scratch'),
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
	const renderInputStaging = projectBodyAuthority === null ? null : modules.createRenderInputStaging({
		root: resolve(options.userDataPath, 'framescaper-native-render-inputs'),
		mintStageId: nodePorts.mintOpaqueId,
	});
	const projectAuthority = projectBodyAuthority === null ? null
		: modules.createSelectedV20ProjectAuthority({
			project: projectBodyAuthority, renderInputs: renderInputStaging,
		});
	const watchImportBroker = projectAuthority === null || options.watchImportAuthority === null
		? null
		: modules.createWatchImportBroker({
			currentOwner: options.watchImportAuthority.currentOwner,
			isOwnerCurrent: options.watchImportAuthority.isOwnerCurrent,
			inspectProject: (projectId) => projectAuthority.watchProject(projectId),
			alreadyImported: (projectId, contentSha256) => (
				projectAuthority.watchImportAlreadyPresent(projectId, contentSha256)
			),
			createLocator: nodePorts.watchRegisterLocator,
			releaseLocator: nodePorts.watchReleaseLocator,
			mintOpaqueId: nodePorts.mintOpaqueId,
		});
	let externalDisplay;
	try { externalDisplay = modules.createExternalDisplayPort(options.externalDisplay); }
	catch (error) {
		imageSequenceSelectionBroker.dispose();
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
			capabilities: () => modules.createCapabilityReport(capabilityReportOptions({
				preferences: preferenceSnapshot(options.settings.snapshot()),
				mediaRuntime,
				openFxRuntime,
				policy: capabilityPolicy,
				externalDisplay: options.externalDisplay,
				externalDisplaySupport: modules.externalDisplaySupport,
				queueSourceAuthorityMounted: projectAuthority !== null,
				watchProjectMutationMounted: watchImportBroker !== null,
				imageSequenceImportMounted: framescaperImageSequenceImportAuthorityMounted(
					options.imageSequenceImportAuthority,
				),
			})),
			revalidate: ({ record, root, rootAuthorized }) => projectAuthority === null
				? failClosedMediaRevalidation(mediaRuntime.available(), rootAuthorized)
				: projectAuthority.revalidate(record, root, rootAuthorized),
			nativeQueueExecution: {
				pool: mediaRuntime,
				prepare: projectAuthority === null
					? async () => { throw new Error('Native queue source authority is not mounted.'); }
					: (record, root) => projectAuthority.prepare(record, root),
				onError: options.onServiceError,
			},
			preferences: () => preferenceSnapshot(options.settings.snapshot()),
			setPreference: async (preference, enabled) => {
				const result = await setPreference(options.settings, preference, enabled);
				if (preference === 'native-media' && result === false) externalDisplay.stop();
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
			...(renderInputStaging === null ? {} : {
				removeRenderInputs: (record) => renderInputStaging.remove(record),
			}),
			checkpointInspectFor: nodePorts.checkpointInspectFor,
			checkpointStore: nodePorts.checkpointStore,
			externalDisplay,
		});
		releaseRuntime(runtime);
	} catch (error) {
		externalDisplay.dispose?.();
		void watchImportBroker?.dispose().catch(options.onServiceError);
		imageSequenceSelectionBroker.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	try {
		await runtime.ready;
		await renderInputStaging?.reclaim(runtime.queue.list());
	} catch (error) {
		await runtime.close();
		void watchImportBroker?.dispose().catch(options.onServiceError);
		imageSequenceSelectionBroker.dispose();
		openFxRuntime.dispose();
		mediaRuntime.dispose();
		throw error;
	}
	let ipc = null;
	let disposed = false;
	return Object.freeze({
		controller: runtime.controller,
		registerRendererBridge(bridge) {
			if (disposed) throw new Error('Framescaper native services are disposed.');
			if (ipc !== null) throw new Error('Framescaper native-services IPC is already registered.');
			ipc = modules.registerIpc({
				handle: bridge.handle,
				removeHandler: bridge.removeHandler,
				on: bridge.on,
				removeListener: bridge.removeListener,
				authorizeOwner: (event) => bridge.ownerFor(event),
				controller: runtime.controller,
				...(renderInputStaging === null ? {} : { renderInputs: renderInputStaging }),
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
			});
			return ipc;
		},
		async revokeOwner(owner) {
			if (disposed) return 0;
			const [abandonedStages, releasedSelections] = await Promise.all([
				renderInputStaging === null ? 0 : renderInputStaging.abandonOwner(owner),
				Promise.resolve().then(() => imageSequenceSelectionBroker.disposeOwner(owner)),
			]);
			return abandonedStages + releasedSelections;
		},
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

function failClosedMediaRevalidation(helperBuildMatches, rootGrantAuthorized) {
	return Object.freeze({
		projectRevisionMatches: false,
		planFingerprintMatches: true,
		inputFingerprintsMatch: false,
		rootGrantAuthorized,
		rootGrantValid: false,
		licensingCleared: false,
		helperBuildMatches,
		scratchIdentityMatches: false,
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
	const [runtime, ipc, nodePorts, externalDisplay, nativeMedia, openFx, capabilityReport, displayController,
		projectAuthority, selectedV20Authority, renderInputStaging, watchImportBroker,
		imageSequenceSelection] = await Promise.all([
		import('./project-library-runtime/desktop/native-services-runtime.js'),
		import('./project-library-runtime/desktop/native-services-main-ipc.js'),
		import('./project-library-runtime/desktop/native-services-node-ports.js'),
		import('./project-library-runtime/desktop/native-services-external-display-port.js'),
		import('./framescaper-native-media-electron-runtime.mjs'),
		import('./framescaper-openfx-electron-runtime.mjs'),
		import('./project-library-runtime/desktop/native-media-capability-report.js'),
		import('./project-library-runtime/desktop/external-display-controller.js'),
		import('./project-library-runtime/desktop/native-services-project-authority.js'),
		import('./project-library-runtime/desktop/native-services-selected-v20-project-authority.js'),
		import('./project-library-runtime/desktop/native-services-render-input-staging.js'),
		import('./project-library-runtime/desktop/native-services-watch-import-broker.js'),
		import('./project-library-runtime/desktop/native-image-sequence-selection.js'),
	]);
	return Object.freeze({
		startRuntime: runtime.startFramescaperNativeServicesRuntime,
		registerIpc: ipc.registerFramescaperNativeServicesMainIpc,
		createNodePorts: nodePorts.createFramescaperNativeServicesNodePorts,
		createExternalDisplayPort: externalDisplay.createFramescaperNativeExternalDisplayPort,
		startMediaRuntime: nativeMedia.startFramescaperNativeMediaElectronRuntime,
		startOpenFxRuntime: openFx.startFramescaperOpenFxElectronRuntime,
		createCapabilityReport: capabilityReport.createFramescaperNativeCapabilityReportV1,
		externalDisplaySupport: displayController.externalDisplayPlacementSupport,
		createProjectAuthority: (options) => new projectAuthority.FramescaperNativeProjectAuthority(options),
		createSelectedV20ProjectAuthority: (options) => (
			new selectedV20Authority.FramescaperNativeSelectedV20ProjectAuthority(options)
		),
		createRenderInputStaging: (options) => (
			new renderInputStaging.FramescaperNativeRenderInputStaging(options)
		),
		createWatchImportBroker: (options) => new watchImportBroker.FramescaperNativeWatchImportBroker(options),
		ImageSequenceSelectionBroker: imageSequenceSelection.FramescaperNativeImageSequenceSelectionBroker,
	});
}

function capabilityReportOptions({
	preferences, mediaRuntime, openFxRuntime, policy, externalDisplay, externalDisplaySupport,
	queueSourceAuthorityMounted, watchProjectMutationMounted, imageSequenceImportMounted,
}) {
	const payload = mediaRuntime.payloadAvailability;
	const payloadBuilt = payload?.status === 'available';
	const pool = mediaRuntime.snapshot?.() ?? null;
	const mediaSelfTest = mediaRuntime.selfTestEvidence?.() ?? null;
	const selectedV20RenderSelfTest = mediaRuntime.selectedV20RenderSelfTestEvidence?.() ?? null;
	const quarantined = pool !== null && pool.quarantinedWorkers >= pool.configuredWorkers;
	const degraded = pool !== null && pool.quarantinedWorkers > 0 && !quarantined;
	const placement = externalDisplaySupport(externalDisplay.platform, externalDisplay.linuxSessionType);
	const mediaDetail = payloadBuilt
		? 'The current-target media host passed authenticated utility-process self-tests.'
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
			professionalCharacteristicsSelfTestPassed: payloadBuilt
				&& mediaRuntime.reason === null
				&& mediaSelfTest?.professionalCharacteristicsMatches === true,
			quarantined,
			degraded,
			buildFingerprint: payloadBuilt ? payload.descriptor.sha256 : null,
			detail: mediaDetail.slice(0, 512),
		}),
		policy,
		queueSourceAuthorityMounted,
		watchProjectMutationMounted,
		imageSequenceImportMounted,
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
			buildFingerprint: openFxPayloadBuilt ? openFxPayload.descriptor.runtimeHost.sha256 : null,
			detail: openFxDetail.slice(0, 512),
		}),
	});
}

/**
 * A pathless picker is not project mutation authority. Only an exact candidate
 * route that binds V25's professional-characteristics admission may attest the
 * import surface; a withdrawn or throwing route fails closed.
 */
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
	const nativeCodecsCleared = policyRowCleared(value, 'futureDistributionGates', 'native-codecs')
		&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-native-ffmpeg-current-set');
	const proxyCodecCleared = nativeCodecsCleared
		&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-mezzanine-and-longform')
		&& policyRowCleared(value, 'nativeFormatPolicies', 'container-mov-mxf-matroska');
	return Object.freeze({
		nativeCodecsCleared,
		proxyCodecCleared,
		imageSequencesCleared: nativeCodecsCleared
			&& policyRowCleared(value, 'nativeFormatPolicies', 'codec-image-sequence-still-formats'),
		openFxCleared: policyRowCleared(value, 'futureDistributionGates', 'native-plugins')
			&& policyRowCleared(value, 'nativeFormatPolicies', 'plugin-format-ofx')
			&& policyRowCleared(value, 'runtimeProvenance', 'framescaper-openfx-1-5-1-source-candidate'),
	});
}

function queueOperationCleared(policy, record) {
	if (record?.taskKind === 'encoded-export') return policy.nativeCodecsCleared === true;
	if (record?.taskKind === 'proxy-generation') return policy.proxyCodecCleared === true;
	if (record?.taskKind === 'image-sequence-export') return policy.imageSequencesCleared === true;
	return false;
}

function policyRowCleared(value, collection, id) {
	const rows = value?.[collection];
	if (!Array.isArray(rows)) throw new TypeError(`Licensing policy ${collection} is absent.`);
	const matches = rows.filter((row) => row?.id === id);
	if (matches.length !== 1 || typeof matches[0]?.status !== 'string') {
		throw new TypeError(`Licensing policy row ${id} is absent or duplicated.`);
	}
	return ['documented', 'implemented', 'recorded'].includes(matches[0].status);
}

function registrationOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper native-services registration options are required.');
	}
	const fields = [
		'productId', 'userDataPath', 'instanceId', 'processId',
		'settings', 'onFenced', 'onServiceError',
		'selectDirectory', 'selectImageSequenceFiles', 'imageSequenceImportAuthority',
		'externalDisplay', 'projectAuthority', 'watchImportAuthority', 'createMessageChannel',
	].sort();
	const actual = Object.keys(value).sort();
	if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])
		|| !['framescaper', 'soundscaper'].includes(value.productId)
		|| typeof value.userDataPath !== 'string' || !isAbsolute(value.userDataPath)
		|| typeof value.instanceId !== 'string' || value.instanceId.length < 8
		|| !Number.isSafeInteger(value.processId) || value.processId < 1
		|| typeof value.selectDirectory !== 'function'
		|| typeof value.selectImageSequenceFiles !== 'function'
		|| typeof value.createMessageChannel !== 'function'
		|| !projectAuthorityPort(value.projectAuthority)
		|| !watchImportAuthorityPort(value.watchImportAuthority)
		|| !imageSequenceImportAuthorityPort(value.imageSequenceImportAuthority)
		|| !externalDisplayOptions(value.externalDisplay)
		|| !value.settings || ['snapshot', 'setNativeMediaEnabled', 'setNativeHardwareDecodeEnabled',
			'setNativeHardwareEncodeEnabled', 'setOfxConsentEnabled']
			.some((method) => typeof value.settings[method] !== 'function')
		|| typeof value.onFenced !== 'function' || typeof value.onServiceError !== 'function') {
		throw new TypeError('Framescaper native-services registration options are invalid.');
	}
	return value;
}

function imageSequenceImportAuthorityPort(value) {
	if (value === null) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		return false;
	}
	const fields = [
		'candidateGeneration', 'projectMutationSurface',
		'professionalCharacteristicsContract', 'isRouted',
	].sort();
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string')
		|| keys.map(String).sort().some((key, index) => key !== fields[index])) return false;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return (value.candidateGeneration === 25 || value.candidateGeneration === 26)
		&& value.projectMutationSurface === 'image-sequence-import'
		&& value.professionalCharacteristicsContract === 'video-source-characteristics-v25'
		&& typeof value.isRouted === 'function';
}

function projectAuthorityPort(value) {
	return value === null || (value && typeof value === 'object' && !Array.isArray(value)
		&& ['projectState', 'projectRecord', 'readProjectBundle', 'readBody']
			.every((method) => typeof value[method] === 'function'));
}

function watchImportAuthorityPort(value) {
	if (value === null) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== 'currentOwner|isOwnerCurrent|locator') return false;
	const locator = value.locator;
	return typeof value.currentOwner === 'function' && typeof value.isOwnerCurrent === 'function'
		&& locator && typeof locator === 'object' && !Array.isArray(locator)
		&& Object.keys(locator).sort().join('|') === 'registerPath|release'
		&& typeof locator.registerPath === 'function' && typeof locator.release === 'function';
}

function mediaExecutable(mediaRuntime) {
	const payload = mediaRuntime.payloadAvailability;
	if (payload?.status !== 'available') return null;
	return Object.freeze({
		path: payload.descriptor.path,
		byteLength: payload.descriptor.byteLength,
		sha256: payload.descriptor.sha256,
		identity: payload.descriptor.identity,
	});
}

function externalDisplayOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const fields = [
		'platform', 'linuxSessionType', 'isEnabled', 'listDisplays',
		'createWindow', 'sinkSelfTestPassed', 'subscribe', 'onError',
	].sort();
	const actual = Object.keys(value).sort();
	return actual.length === fields.length && actual.every((field, index) => field === fields[index])
		&& typeof value.platform === 'string'
		&& (value.linuxSessionType === undefined || typeof value.linuxSessionType === 'string')
		&& ['isEnabled', 'listDisplays', 'createWindow', 'sinkSelfTestPassed', 'subscribe', 'onError']
			.every((method) => typeof value[method] === 'function');
}
