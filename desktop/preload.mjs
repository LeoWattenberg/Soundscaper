/* Electron sandbox preload: restricted require exposes only Electron; Framescaper shares this contextBridge. */
const { contextBridge, ipcRenderer } = require('electron');
/* Keys main may hold but the renderer may never see, whatever the shape. */
const PLUGIN_PATH_KEYS = new Set(['binaryPath', 'rootPath', 'path', 'absolutePath', 'filePath']);
const CHANNELS = Object.freeze({
	environment: 'soundscaper:v1:environment',
	chooseFiles: 'soundscaper:v1:files:choose',
	releaseRead: 'soundscaper:v1:files:release',
	chooseLinkedVideoOriginal: 'soundscaper:v1:linked-video:choose',
	loadLinkedVideoOriginal: 'soundscaper:v1:linked-video:load',
	reconcileLinkedVideoOriginals: 'soundscaper:v1:linked-video:reconcile',
	releaseLinkedVideoOriginal: 'soundscaper:v1:linked-video:release',
	chooseLinkedAudioOriginal: 'soundscaper:v1:linked-audio:choose',
	loadLinkedAudioOriginal: 'soundscaper:v1:linked-audio:load',
	reconcileLinkedOriginals: 'soundscaper:v1:linked-original:reconcile',
	releaseLinkedOriginal: 'soundscaper:v1:linked-original:release',
	chooseSaveTarget: 'soundscaper:v1:save:choose',
	beginWrite: 'soundscaper:v1:save:begin',
	writeChunk: 'soundscaper:v1:save:chunk',
	patchFinalPrefix: 'soundscaper:v1:save:prefix',
	finishWrite: 'soundscaper:v1:save:finish',
	abortWrite: 'soundscaper:v1:save:abort',
	listSharedProjects: 'soundscaper:v1:projects:list',
	readSharedProject: 'soundscaper:v1:projects:read',
	readSharedProjectBundle: 'soundscaper:v1:projects:bundle',
	commitSharedProject: 'soundscaper:v1:projects:commit',
	deleteSharedProject: 'soundscaper:v1:projects:delete',
	beginSharedSourceWrite: 'soundscaper:v1:projects:sources:begin',
	writeSharedSourceChunk: 'soundscaper:v1:projects:sources:chunk',
	finishSharedSourceWrite: 'soundscaper:v1:projects:sources:finish',
	abortSharedSourceWrite: 'soundscaper:v1:projects:sources:abort',
	readSharedSourceChunk: 'soundscaper:v1:projects:sources:read',
	helperProbeAvailability: 'soundscaper:v1:helper:probe-availability',
	helperProbeBegin: 'soundscaper:v1:helper:probe-begin',
	helperProbeAwait: 'soundscaper:v1:helper:probe-await',
	helperProbeCancel: 'soundscaper:v1:helper:probe-cancel',
	nativeAudioAvailability: 'soundscaper:v1:helper:native-audio-availability',
	nativeAudioInventory: 'soundscaper:v1:helper:native-audio-inventory',
	nativeAudioSetEnabled: 'soundscaper:v1:helper:native-audio-set-enabled',
	nativeAudioSessionOpen: 'soundscaper:v1:native-audio:session:open', nativeAudioSessionBind: 'soundscaper:v1:native-audio:session:bind', nativeAudioSessionStatus: 'soundscaper:v1:native-audio:session:status', nativeAudioSessionCalibrate: 'soundscaper:v1:native-audio:session:calibrate', nativeAudioSessionReport: 'soundscaper:v1:native-audio:session:report', nativeAudioSessionLoss: 'soundscaper:v1:native-audio:session:loss', nativeAudioSessionClose: 'soundscaper:v1:native-audio:session:close', nativeAudioRealtimePort: 'soundscaper:native-realtime-port',
	nativePluginAvailability: 'soundscaper:v1:helper:native-plugin-availability',
	nativePluginConsent: 'soundscaper:v1:helper:native-plugin-consent',
	nativePluginScan: 'soundscaper:v1:helper:native-plugin-scan',
	nativePluginInventory: 'soundscaper:v1:helper:native-plugin-inventory',
	nativePluginClearQuarantine: 'soundscaper:v1:helper:native-plugin-clear-quarantine',
	nativePluginReviewInstallation: 'soundscaper:v1:native-plugin:installation:review', nativePluginInstantiate: 'soundscaper:v1:native-plugin:instantiate', nativePluginRunOffline: 'soundscaper:v1:native-plugin:run-offline', nativePluginSetBypassed: 'soundscaper:v1:native-plugin:set-bypassed', nativePluginPersistState: 'soundscaper:v1:native-plugin:state:persist', nativePluginRestoreState: 'soundscaper:v1:native-plugin:state:restore', nativePluginOpenVendorUi: 'soundscaper:v1:native-plugin:vendor-ui:open', nativePluginCloseVendorUi: 'soundscaper:v1:native-plugin:vendor-ui:close', nativePluginCloseInstance: 'soundscaper:v1:native-plugin:instance:close', nativePluginRpcPort: 'soundscaper:native-plugin-rpc-port',
	nativeTierControls: 'soundscaper:v1:native-tier:controls',
	nativeTierApply: 'soundscaper:v1:native-tier:apply',
	framescaperNativeCapabilities: 'framescaper:v1:native-services:capabilities', framescaperNativeSnapshot: 'framescaper:v1:native-services:snapshot', framescaperNativeControl: 'framescaper:v1:native-services:queue:control',
	framescaperNativeReorder: 'framescaper:v1:native-services:queue:reorder', framescaperNativeRemove: 'framescaper:v1:native-services:queue:remove', framescaperNativeEnqueue: 'framescaper:v1:native-services:queue:enqueue',
	framescaperNativeSelectRoot: 'framescaper:v1:native-services:root:select', framescaperNativeReauthorizeQueueRoot: 'framescaper:v1:native-services:queue:reauthorize-root', framescaperNativeRevalidateRoot: 'framescaper:v1:native-services:root:revalidate', framescaperNativeRevokeRoot: 'framescaper:v1:native-services:root:revoke', framescaperNativeCreateWatch: 'framescaper:v1:native-services:watch:create', framescaperNativeSetWatchEnabled: 'framescaper:v1:native-services:watch:enabled', framescaperNativeRemoveWatch: 'framescaper:v1:native-services:watch:remove', framescaperNativeReconcileWatch: 'framescaper:v1:native-services:watch:reconcile', framescaperNativeClaimWatchImport: 'framescaper:v1:native-services:watch:claim', framescaperNativeCompleteWatchImport: 'framescaper:v1:native-services:watch:complete',
	framescaperNativeCleanupScratch: 'framescaper:v1:native-services:scratch:cleanup', framescaperNativeSettleScratch: 'framescaper:v1:native-services:scratch:settle', framescaperNativePublish: 'framescaper:v1:native-services:publication:publish', framescaperNativeCheckpoint: 'framescaper:v1:native-services:publication:checkpoint', framescaperNativeExternalDisplays: 'framescaper:v1:native-services:display:list', framescaperNativeSetExternalDisplay: 'framescaper:v1:native-services:display:set', framescaperNativeFramePort: 'framescaper:v1:native-services:display:frame-port',
	framescaperNativePreferences: 'framescaper:v1:native-services:preferences', framescaperNativeSetPreference: 'framescaper:v1:native-services:preferences:set', framescaperNativeRenderInputBegin: 'framescaper:v1:native-services:render-inputs:begin', framescaperNativeRenderInputPort: 'framescaper:v1:native-services:render-inputs:port', framescaperNativeRenderInputFinalize: 'framescaper:v1:native-services:render-inputs:finalize', framescaperNativeRenderInputAbandon: 'framescaper:v1:native-services:render-inputs:abandon', framescaperNativeRenderInputBeginLive: 'framescaper:v1:native-services:render-inputs:live:begin', framescaperNativeRenderInputWriteLive: 'framescaper:v1:native-services:render-inputs:live:write', framescaperNativeRenderInputCompleteLive: 'framescaper:v1:native-services:render-inputs:live:complete',
	framescaperNativeSelectImageSequence: 'framescaper:v1:native-services:image-sequence:select', framescaperNativeReadImageSequenceFile: 'framescaper:v1:native-services:image-sequence:read', framescaperNativeReleaseImageSequence: 'framescaper:v1:native-services:image-sequence:release', framescaperNativeImageSequenceImport: 'framescaper:v1:native-services:image-sequence:import', framescaperNativeImageSequenceImportPort: 'framescaper:v1:native-services:image-sequence:import-port', framescaperNativeImageSequenceDecode: 'framescaper:v1:native-services:image-sequence:decode', framescaperNativeClaimProxyOutput: 'framescaper:v1:native-services:proxy-output:claim', framescaperNativeReadProxyOutput: 'framescaper:v1:native-services:proxy-output:read', framescaperNativeReleaseProxyOutput: 'framescaper:v1:native-services:proxy-output:release', framescaperNativeOpenFxScan: 'framescaper:v1:native-services:openfx:scan', framescaperNativeOpenFxInventory: 'framescaper:v1:native-services:openfx:inventory', framescaperNativeOpenFxControl: 'framescaper:v1:native-services:openfx:control', framescaperNativeOpenFxFrame: 'framescaper:v1:native-services:openfx:frame-port', framescaperNativeOpenFxFrameOffer: 'framescaper:v1:native-services:openfx:frame-offer',
	framescaperProjectHandshake: 'framescaper:v19:projects:handshake', framescaperProjectBundle: 'framescaper:v19:projects:bundle', framescaperProjectBodyRead: 'framescaper:v19:projects:bodies:read', framescaperProjectList: 'framescaper:v19:projects:list',
	framescaperNativeOpenFxInteract: 'framescaper:v1:native-services:openfx:interact',
	framescaperProjectDelete: 'framescaper:v19:projects:delete', framescaperProjectDuplicate: 'framescaper:v19:projects:duplicate', framescaperProjectBegin: 'framescaper:v19:projects:publication:begin',
	framescaperProjectChunk: 'framescaper:v19:projects:publication:chunk', framescaperProjectFinish: 'framescaper:v19:projects:publication:finish', framescaperProjectAbort: 'framescaper:v19:projects:publication:abort',
	listAssistanceModels: 'soundscaper:v1:assistance:list', installAssistanceModel: 'soundscaper:v1:assistance:install',
	removeAssistanceModel: 'soundscaper:v1:assistance:remove', assistanceInstallProgress: 'soundscaper:v1:event:assistance-progress',
	setLocale: 'soundscaper:v1:locale:set', windowAction: 'soundscaper:v1:window:action', externalFfmpegStatus: 'soundscaper:v1:ffmpeg:status', externalFfmpegChoose: 'soundscaper:v1:ffmpeg:choose', externalFfmpegClear: 'soundscaper:v1:ffmpeg:clear', externalFfmpegRescan: 'soundscaper:v1:ffmpeg:rescan', externalFfmpegInstall: 'soundscaper:v1:ffmpeg:install',
	checkForUpdates: 'soundscaper:v1:updates:check', openExternal: 'soundscaper:v1:external:open',
	editText: 'soundscaper:v1:text:edit', rendererReady: 'soundscaper:v1:renderer:ready',
	respondToClose: 'soundscaper:v1:close:respond', openProject: 'soundscaper:v1:event:project-open',
	menuCommand: 'soundscaper:v1:event:menu-command',
	closeRequested: 'soundscaper:v1:event:close-requested',
	windowStateChanged: 'soundscaper:v1:event:window-state-changed',
}); const MAX_CHUNK_BYTES = 4 * 1024 * 1024; const FINAL_PREFIX_BYTES = 32;
const READ_PROFILE_LINKED_AUDIO_RANGE_V1 = 'linked-audio-range-v1'; const READ_PROFILE_LINKED_VIDEO_RANGE_V1 = 'linked-video-range-v1';
const READ_PROFILE_MATERIALIZED_V1 = 'materialized-v1'; const READ_PROFILE_SCAPE_RANGE_V1 = 'scape-range-v1';
const SCAPE_PROJECT_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const MAX_MATERIALIZED_READ_DESCRIPTOR_BYTES = 512 * 1024 ** 2; const MAX_SCAPE_RANGE_READ_DESCRIPTOR_BYTES = 65 * 1024 ** 3; const MAX_DESKTOP_SAVE_BYTES = 65 * 1024 ** 3;
const MAX_SHARED_PROJECT_DOCUMENT_BYTES = 256 * 1024 ** 2; const MAX_SHARED_PROJECT_ID_BYTES = 4 * 1024; const MAX_SHARED_PROJECTS = 10_000;
const MAX_SHARED_SOURCE_BYTES = 64 * 1024 ** 3; const MAX_SHARED_SOURCES = 4_094;
const MANAGED_AUDIO_ENCODING = 'audio-f32le-chunks-v1'; const MANAGED_VIDEO_ENCODING = 'video-original-v1'; const MANAGED_VIDEO_TIMING_ENCODING = 'soundscaper-video-timing-v1';
const MANAGED_BINDING_ID = /^[mvt][a-f0-9]{64}$/u; const SOURCE_WRITE_ID = /^[a-f0-9]{32}$/u; const SHA256 = /^[a-f0-9]{64}$/u;
const SHARED_PROJECT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const api = Object.freeze({
	getEnvironment: () => ipcRenderer.invoke(CHANNELS.environment),
	chooseFiles: (options) => ipcRenderer.invoke(CHANNELS.chooseFiles, {
		purpose: text(options?.purpose, 24),
		multiple: options?.multiple === true,
	}).then(sanitizeReadDescriptors),
	releaseRead: (id) => ipcRenderer.invoke(CHANNELS.releaseRead, opaqueId(id, 64)),
	chooseLinkedVideoOriginal: () => ipcRenderer.invoke(CHANNELS.chooseLinkedVideoOriginal).then((value) => nullableLinkedLocator(value, 'video')),
	loadLinkedVideoOriginal: (value) => {
		const request = linkedVideoLoadRequest(value);
		return ipcRenderer.invoke(CHANNELS.loadLinkedVideoOriginal, request)
			.then((result) => nullableLoadedLinkedLocator(result, 'video', request.playback));
	},
	reconcileLinkedVideoOriginals: (value) => ipcRenderer.invoke(CHANNELS.reconcileLinkedVideoOriginals, linkedVideoReferences(value)).then(safeInteger),
	releaseLinkedVideoOriginal: (reference) => ipcRenderer.invoke(CHANNELS.releaseLinkedVideoOriginal, linkedVideoReferences([reference])[0]).then(strictBoolean),
	chooseLinkedAudioOriginal: () => ipcRenderer.invoke(CHANNELS.chooseLinkedAudioOriginal).then((value) => nullableLinkedLocator(value, 'audio')),
	loadLinkedAudioOriginal: (value) => {
		const request = linkedAudioLoadRequest(value);
		return ipcRenderer.invoke(CHANNELS.loadLinkedAudioOriginal, request)
			.then((result) => nullableLoadedLinkedLocator(result, 'audio', request.range));
	},
	reconcileLinkedOriginals: (value) => ipcRenderer.invoke(CHANNELS.reconcileLinkedOriginals, linkedOriginalReferences(value)).then(safeInteger),
	releaseLinkedOriginal: (reference) => ipcRenderer.invoke(CHANNELS.releaseLinkedOriginal, linkedOriginalReferences([reference])[0]).then(strictBoolean),
	chooseSaveTarget: (options) => ipcRenderer.invoke(CHANNELS.chooseSaveTarget, {
		purpose: text(options?.purpose, 24),
		suggestedName: text(options?.suggestedName, 220),
	}),
	beginWrite: (options) => ipcRenderer.invoke(CHANNELS.beginWrite, saveDeclaration(options)),
	writeChunk: (options) => {
		const bytes = binary(options?.bytes);
		if (bytes.byteLength > MAX_CHUNK_BYTES) throw new RangeError('Save chunk is too large');
		return ipcRenderer.invoke(CHANNELS.writeChunk, {
			writeId: opaqueId(options?.writeId, 32),
			offset: safeInteger(options?.offset),
			bytes,
		});
	},
	patchFinalPrefix: (options) => {
		const bytes = binary(options?.bytes);
		if (bytes.byteLength !== FINAL_PREFIX_BYTES) throw new RangeError('Final prefix must be exactly 32 bytes');
		return ipcRenderer.invoke(CHANNELS.patchFinalPrefix, {
			writeId: opaqueId(options?.writeId, 32), bytes,
		}).then(finalPrefixAcknowledgement);
	},
	finishWrite: (writeId) => ipcRenderer.invoke(CHANNELS.finishWrite, opaqueId(writeId, 32)),
	abortWrite: (writeId) => ipcRenderer.invoke(CHANNELS.abortWrite, opaqueId(writeId, 32)),
	listSharedProjects: () => ipcRenderer.invoke(CHANNELS.listSharedProjects).then(sharedProjectSummaries),
	readSharedProject: (projectId) => ipcRenderer.invoke(CHANNELS.readSharedProject, sharedProjectId(projectId)).then(nullableProjectDocument),
	readSharedProjectBundle: (projectId) => ipcRenderer.invoke(CHANNELS.readSharedProjectBundle, sharedProjectId(projectId)).then(nullableProjectBundle),
	commitSharedProject: (request) => ipcRenderer.invoke(CHANNELS.commitSharedProject, sharedProjectCommitRequest(request)).then(sharedProjectCommitResult),
	deleteSharedProject: (projectId) => ipcRenderer.invoke(CHANNELS.deleteSharedProject, sharedProjectId(projectId)).then(strictBoolean),
	beginSharedSourceWrite: (declaration) => ipcRenderer.invoke(CHANNELS.beginSharedSourceWrite, sharedSourceWriteDeclaration(declaration)).then(sharedSourceWriteAdmission),
	writeSharedSourceChunk: (value) => ipcRenderer.invoke(CHANNELS.writeSharedSourceChunk, sharedSourceChunkWrite(value)).then(sharedSourceChunkAcknowledgement),
	finishSharedSourceWrite: (value) => ipcRenderer.invoke(CHANNELS.finishSharedSourceWrite, sharedSourceWriteCompletion(value)).then(sharedManagedSourceDescriptor),
	abortSharedSourceWrite: (writeId) => ipcRenderer.invoke(CHANNELS.abortSharedSourceWrite, sharedSourceWriteId(writeId)).then(strictBoolean),
	readSharedSourceChunk: (value) => {
		const request = sharedSourceChunkRead(value);
		return ipcRenderer.invoke(CHANNELS.readSharedSourceChunk, request)
			.then((bytes) => sharedSourceChunkResult(bytes, request.length));
	},
	setLocale: (locale) => ipcRenderer.invoke(CHANNELS.setLocale, text(locale, 32)), getExternalFfmpegStatus: () => ipcRenderer.invoke(CHANNELS.externalFfmpegStatus).then(externalFfmpegStatus), chooseExternalFfmpeg: () => ipcRenderer.invoke(CHANNELS.externalFfmpegChoose).then(externalFfmpegStatus), clearExternalFfmpeg: () => ipcRenderer.invoke(CHANNELS.externalFfmpegClear).then(externalFfmpegStatus), rescanExternalFfmpeg: () => ipcRenderer.invoke(CHANNELS.externalFfmpegRescan).then(externalFfmpegStatus), installExternalFfmpeg: () => ipcRenderer.invoke(CHANNELS.externalFfmpegInstall).then(externalFfmpegStatus),
	runWindowAction: (action) => ipcRenderer.invoke(CHANNELS.windowAction, windowAction(action)),
	checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
	openExternal: (destination) => ipcRenderer.invoke(CHANNELS.openExternal, text(destination, 32)),
	editText: (command) => ipcRenderer.invoke(CHANNELS.editText, textEditCommand(command)),
	signalReady: () => ipcRenderer.send(CHANNELS.rendererReady),
	respondToClose: (response) => ipcRenderer.send(CHANNELS.respondToClose, {
		requestId: text(response?.requestId, 64),
		allow: response?.allow === true,
	}),
	probeHelperAvailability: () => ipcRenderer.invoke(CHANNELS.helperProbeAvailability).then((value) => Object.freeze({
		enabled: value?.enabled === true,
		quarantined: value?.quarantined === true,
	})),
	beginVideoSourceProbe: (request) => ipcRenderer.invoke(CHANNELS.helperProbeBegin, {
		capabilityId: opaqueId(request?.capabilityId, 64),
	}).then((value) => Object.freeze({ probeId: opaqueId(value?.probeId, 40) })),
	awaitVideoSourceProbe: (request) => ipcRenderer.invoke(CHANNELS.helperProbeAwait, {
		probeId: opaqueId(request?.probeId, 40),
	}).then(helperProbeCompletion),
	cancelVideoSourceProbe: (request) => ipcRenderer.invoke(CHANNELS.helperProbeCancel, {
		probeId: opaqueId(request?.probeId, 40),
	}).then((value) => Object.freeze({ cancelled: value?.cancelled === true })),
	nativeAudioHelperAvailability: () => ipcRenderer.invoke(CHANNELS.nativeAudioAvailability).then(nativeAudioAvailability),
	setNativeAudioHelperEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.nativeAudioSetEnabled, enabled === true).then(nativeAudioEnabled),
	describeNativeAudioBackend: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioInventory, { backend: text(request?.backend, 32) }).then(nativeAudioInventory),
	nativePluginAvailability: () => ipcRenderer.invoke(CHANNELS.nativePluginAvailability).then(nativePluginStatus),
	setNativePluginConsent: (request) => ipcRenderer.invoke(CHANNELS.nativePluginConsent, {
		format: text(request?.format, 32),
		action: text(request?.action ?? 'grant', 32),
		rootId: text(request?.rootId ?? '', 256),
	}).then(nativePluginStatus),
	scanNativePlugins: (request) => ipcRenderer.invoke(CHANNELS.nativePluginScan, {
		format: text(request?.format, 32),
		rootId: text(request?.rootId, 256),
	}).then(nativePluginStatus),
	listNativePlugins: () => ipcRenderer.invoke(CHANNELS.nativePluginInventory).then(nativePluginStatus),
	clearNativePluginQuarantine: (request) => ipcRenderer.invoke(CHANNELS.nativePluginClearQuarantine, { digest: opaqueId(request?.digest, 64), clearance: text(request?.clearance, 16) }).then(nativePluginStatus),
	openNativeAudioSession: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionOpen, nativeAudioSessionOpenRequest(request)).then(nativePluginStatus), bindNativeAudioSession: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionBind, nativeAudioSessionIdRequest(request, true)).then(nativePluginStatus), nativeAudioSessionStatus: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionStatus, nativeAudioSessionIdRequest(request, false)).then(nativePluginStatus), calibrateNativeAudioSession: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionCalibrate, nativeAudioSessionCalibrationRequest(request)).then(nativePluginStatus), reportNativeAudioSessionTransfer: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionReport, nativeAudioSessionTransferRequest(request)).then(nativePluginStatus), reportNativeAudioSessionLoss: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionLoss, nativeAudioSessionLossRequest(request)).then(nativePluginStatus), closeNativeAudioSession: (request) => ipcRenderer.invoke(CHANNELS.nativeAudioSessionClose, nativeAudioSessionIdRequest(request, false)).then(strictBoolean),
		reviewNativePluginInstallation: (request) => ipcRenderer.invoke(CHANNELS.nativePluginReviewInstallation, nativePluginReviewRequest(request)).then(nativePluginStatus), instantiateNativePlugin: (request) => ipcRenderer.invoke(CHANNELS.nativePluginInstantiate, nativePluginInstantiationRequest(request)).then(nativePluginStatus), runNativePluginOffline: (request) => ipcRenderer.invoke(CHANNELS.nativePluginRunOffline, nativePluginInstanceRequest(request)).then(nativePluginStatus), setNativePluginBypassed: (request) => ipcRenderer.invoke(CHANNELS.nativePluginSetBypassed, nativePluginBypassRequest(request)).then(nativePluginStatus), persistNativePluginState: (request) => ipcRenderer.invoke(CHANNELS.nativePluginPersistState, nativePluginStatePersistRequest(request)).then(nativePluginStatus), restoreNativePluginState: (request) => ipcRenderer.invoke(CHANNELS.nativePluginRestoreState, nativePluginStateRestoreRequest(request)).then(nativePluginStateRestoreProjection), openNativePluginVendorUi: (request) => ipcRenderer.invoke(CHANNELS.nativePluginOpenVendorUi, nativePluginInstanceRequest(request)).then(nativePluginStatus), closeNativePluginVendorUi: (request) => ipcRenderer.invoke(CHANNELS.nativePluginCloseVendorUi, nativePluginVendorCloseRequest(request)).then(strictBoolean), closeNativePluginInstance: (request) => ipcRenderer.invoke(CHANNELS.nativePluginCloseInstance, nativePluginInstanceRequest(request)).then(strictBoolean),
	readNativeTierControls: () => ipcRenderer.invoke(CHANNELS.nativeTierControls).then(nativeTierControls),
	applyNativeTierControl: (request) => ipcRenderer.invoke(CHANNELS.nativeTierApply, nativeTierControlRequest(request)).then(nativeTierControls),
	nativeServices: Object.freeze({
		capabilities: () => ipcRenderer.invoke(CHANNELS.framescaperNativeCapabilities).then(nativeCapabilitySnapshot), snapshot: () => ipcRenderer.invoke(CHANNELS.framescaperNativeSnapshot).then(nativeServicesSnapshot), control: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeControl, nativeQueueControlRequest(request)).then(nativeQueueProjection),
		reorder: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeReorder, nativeQueueReorderRequest(request)).then(nativeQueueProjections), remove: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeRemove, nativeQueueRemoveRequest(request)).then((value) => strictBoolean(value, 'Framescaper native queue removal result must be a boolean')), enqueue: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeEnqueue, nativeQueueEnqueueRequest(request)).then(nativeQueueProjection), stageRenderInputs: stageNativeRenderInputs, stageLiveRenderInputs: stageNativeLiveRenderInputs, writeLiveRenderInput: writeNativeLiveRenderInput, completeLiveRenderInput: completeNativeLiveRenderInput, abandonRenderInputs: abandonNativeRenderInputs,
		selectRoot: () => ipcRenderer.invoke(CHANNELS.framescaperNativeSelectRoot).then((value) => value === null ? null : nativeRootProjection(value)), reauthorizeQueueRoot: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeReauthorizeQueueRoot, nativeLifecycleIdRequest(request, 'jobId')).then((value) => value === null ? null : nativeQueueProjection(value)), revalidateRoot: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeRevalidateRoot, nativeLifecycleIdRequest(request, 'grantId')).then(strictBoolean), revokeRoot: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeRevokeRoot, nativeLifecycleIdRequest(request, 'grantId')).then(strictBoolean),
		createWatch: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeCreateWatch, nativeWatchCreateRequest(request)).then(nativeWatchProjection), setWatchEnabled: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeSetWatchEnabled, nativeWatchEnabledRequest(request)).then(nativeWatchProjection),
		removeWatch: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeRemoveWatch, nativeLifecycleIdRequest(request, 'ruleId')).then(strictBoolean), reconcileWatch: () => ipcRenderer.invoke(CHANNELS.framescaperNativeReconcileWatch).then(nativeServicesSnapshot), claimWatchImport: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeClaimWatchImport, nativeWatchImportClaimRequest(request)).then((value) => value === null ? null : nativeWatchImportClaim(value)), completeWatchImport: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeCompleteWatchImport, nativeWatchImportCompletionRequest(request)).then(strictBoolean),
		cleanupScratch: () => ipcRenderer.invoke(CHANNELS.framescaperNativeCleanupScratch).then(nativeJobIds), settleScratch: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeSettleScratch, nativeLifecycleIdRequest(request, 'jobId')).then(nativeScratchSettlement), publish: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativePublish, nativePublicationRequest(request)).then(nativePublicationResult), checkpoint: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeCheckpoint, nativeCheckpointRequest(request)).then(nativeCheckpointResult),
		externalDisplays: () => ipcRenderer.invoke(CHANNELS.framescaperNativeExternalDisplays).then(nativeExternalDisplays), setExternalDisplay: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeSetExternalDisplay, nativeExternalDisplayRequest(request)).then(nativeExternalDisplays), presentExternalDisplay: presentNativeExternalDisplayFrame, preferences: () => ipcRenderer.invoke(CHANNELS.framescaperNativePreferences).then(nativeServicePreferences), setPreference: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeSetPreference, nativePreferenceRequest(request)).then((value) => strictBoolean(value, 'Framescaper native-service preference update must be boolean')),
		selectImageSequence: () => ipcRenderer.invoke(CHANNELS.framescaperNativeSelectImageSequence, {}).then((value) => value === null ? null : nativeImageSequenceSelection(value)), readImageSequenceFile: (request) => { const value = nativeImageSequenceReadRequest(request); return ipcRenderer.invoke(CHANNELS.framescaperNativeReadImageSequenceFile, value).then((bytes) => { const result = binary(bytes); if (result.byteLength !== value.length) throw new Error('Framescaper image-sequence range read was short'); return result; }); }, releaseImageSequence: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeReleaseImageSequence, nativeImageSequenceReleaseRequest(request)).then((value) => strictBoolean(value, 'Framescaper image-sequence release must be boolean')), imageSequenceImport: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceImport, nativeImageSequenceImportRequest(request)), writeImageSequenceImportChunk: transferNativeImageSequenceImportChunk, readImageSequenceImportBody: (request) => { const value = nativeImageSequenceImportReadRequest(request); return ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceImport, { operation: 'read', ...value }).then((bytes) => { const result = binary(bytes); if (result.byteLength !== value.length) throw new Error('Framescaper image-sequence body range was short'); return result; }); }, decodeImageSequenceSource: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceDecode, { operation: 'decode', ...nativeImageSequenceDecodeRequest(request) }).then(nativeImageSequenceDecodeClaim), cancelImageSequenceDecode: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceDecode, { operation: 'cancel', ...nativeImageSequenceDecodeIdRequest(request, 'requestId') }).then((value) => strictBoolean(value, 'Framescaper image-sequence cancel result must be boolean')), readImageSequenceDecode: (request) => { const value = nativeImageSequenceDecodeReadRequest(request); return ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceDecode, { operation: 'read', ...value }).then((bytes) => { const result = binary(bytes); if (result.byteLength !== value.length) throw new Error('Framescaper decoded image-sequence range was short'); return result; }); }, releaseImageSequenceDecode: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceDecode, { operation: 'release', ...nativeImageSequenceDecodeIdRequest(request, 'claimId') }).then((value) => strictBoolean(value, 'Framescaper image-sequence claim release must be boolean')), claimProxyOutput: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeClaimProxyOutput, nativeProxyOutputJobRequest(request)).then(nativeProxyOutputClaim), readProxyOutput: (request) => { const value = nativeProxyOutputReadRequest(request); return ipcRenderer.invoke(CHANNELS.framescaperNativeReadProxyOutput, value).then((bytes) => { const result = binary(bytes); if (result.byteLength !== value.length) throw new Error('Framescaper proxy-output range read was short'); return result; }); }, releaseProxyOutput: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeReleaseProxyOutput, nativeProxyOutputClaimRequest(request)).then((value) => strictBoolean(value, 'Framescaper proxy-output release must be boolean')), scanOpenFxPlugin: () => ipcRenderer.invoke(CHANNELS.framescaperNativeOpenFxScan).then((value) => value === null ? null : nativeOpenFxProjection(value)), listOpenFxPlugins: () => ipcRenderer.invoke(CHANNELS.framescaperNativeOpenFxInventory).then(nativeOpenFxInventory), controlOpenFxPlugin: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeOpenFxControl, nativeOpenFxControlRequest(request)).then(nativeOpenFxProjection), openOpenFxFrameSession: (request) => ipcRenderer.invoke(CHANNELS.framescaperNativeOpenFxFrame, nativeOpenFxFrameSessionRequest(request)).then(nativeOpenFxFrameOfferV2),
		runOpenFxInteract: (request) => { const value = nativeOpenFxAuthoredInteractRequest(request); return ipcRenderer.invoke(CHANNELS.framescaperNativeOpenFxInteract, value).then((result) => nativeOpenFxAuthoredInteractResult(result, value)); },
	}),
	listAssistanceModels: () => ipcRenderer.invoke(CHANNELS.listAssistanceModels).then(assistanceStatus),
	installAssistanceModel: (modelId) => ipcRenderer.invoke(CHANNELS.installAssistanceModel, assistanceModelId(modelId)).then(assistanceModel),
	removeAssistanceModel: (modelId) => ipcRenderer.invoke(CHANNELS.removeAssistanceModel, assistanceModelId(modelId)).then(safeInteger),
	onAssistanceInstallProgress: (listener) => subscribe(CHANNELS.assistanceInstallProgress, listener, assistanceProgress),
	onOpenProject: (listener) => subscribe(CHANNELS.openProject, listener, sanitizeReadDescriptor),
	onMenuCommand: (listener) => subscribe(CHANNELS.menuCommand, listener, (value) => Object.freeze({ command: text(value?.command, 64) })),
	onCloseRequested: (listener) => subscribe(CHANNELS.closeRequested, listener, (value) => Object.freeze({
		requestId: text(value?.requestId, 64),
		reason: value?.reason === 'quit' ? 'quit' : 'window-close',
	})),
	onWindowStateChanged: (listener) => subscribe(CHANNELS.windowStateChanged, listener, windowState),
});
const FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE = Object.freeze({ kind: 'framescaper-project-library-handshake', version: 1, owner: 'framescaper', projectSchemaVersion: 28,
	scapeFormatVersions: Object.freeze([1, 2]), attachedScapeFormatVersion: 2, storageDatabaseName: 'kw-media-framescaper-editor-v28', desktopLibrarySchemaVersion: 19,
	desktopDatabaseUserVersion: 21, desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v19']) });
const framescaperProjectPublications = new Set(); let framescaperProjectState = 'pending'; let framescaperProjectConnection = null;
const framescaperProjectLibrary = Object.freeze({
	connect: connectFramescaperProjectLibrary, handshakeState: () => framescaperProjectState,
	listProjects: () => invokeFramescaperProject(CHANNELS.framescaperProjectList),
	readProjectBundle: (projectId) => invokeFramescaperProject(CHANNELS.framescaperProjectBundle, framescaperProjectId(projectId)),
	readBodyChunk: (value) => invokeFramescaperProject(CHANNELS.framescaperProjectBodyRead, structuredClone(value)).then(framescaperProjectChunkResult),
	beginPublication: beginFramescaperProjectPublication, writePublicationChunk: writeFramescaperProjectPublicationChunk,
	finishPublication: (value) => finishFramescaperProjectPublication(value, CHANNELS.framescaperProjectFinish, false),
	abortPublication: (value) => finishFramescaperProjectPublication(value, CHANNELS.framescaperProjectAbort, true),
	deleteProject: (value) => invokeFramescaperProject(CHANNELS.framescaperProjectDelete, structuredClone(value)),
	duplicateProject: (value) => invokeFramescaperProject(CHANNELS.framescaperProjectDuplicate, structuredClone(value)),
});
const bridge = Object.freeze({ v1: api }); const framescaperBridge = Object.freeze({ v1: Object.freeze({ ...api, projectLibrary: framescaperProjectLibrary }) }); for (const [channel, type] of [[CHANNELS.nativeAudioRealtimePort, 'soundscaper-native-realtime-port-v1'], [CHANNELS.nativePluginRpcPort, 'soundscaper-native-plugin-rpc-port-v1'], [CHANNELS.framescaperNativeOpenFxFrameOffer, 'framescaper-openfx-frame-port-v1']]) ipcRenderer.on(channel, (event, offer) => { const ports = Array.from(event.ports ?? []); if (ports.length !== 1) { for (const port of ports) port.close(); return; } window.postMessage(Object.freeze({ type, offer: type === 'framescaper-openfx-frame-port-v1' ? nativeOpenFxFrameOfferV2(offer) : nativePluginStatus(offer) }), '*', ports); });
for (const name of ['scapeDesktop', 'soundscaperDesktop']) contextBridge.exposeInMainWorld(name, bridge);
contextBridge.exposeInMainWorld('framescaperDesktop', framescaperBridge);
function nativeOpenFxFrameSessionRequest(value) { nativeRecord(value, ['schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal', 'requestedBackend', 'transitionProgress', 'inputs', 'inputBinding', 'requestNonce'], 'OpenFX frame session request'); if (value.schemaVersion !== 1 || typeof value.planPayload !== 'string' || !value.planPayload.length || utf8Bytes(value.planPayload, 16 * 1024 * 1024) > 16 * 1024 * 1024 || !Array.isArray(value.inputs) || value.inputs.length > 16) throw new RangeError('OpenFX frame session plan exceeds its bounded control domain'); return structuredClone(value); } function nativeOpenFxFrameOfferV2(value) {
	nativeRecord(value, ['protocolVersion', 'sessionId', 'requestNonce'], 'OpenFX frame offer');
	return Object.freeze({ ...nativeOpenFxFrameOffer({ protocolVersion: value.protocolVersion,
		sessionId: value.sessionId }), requestNonce: opaqueId(value.requestNonce, 40) });
}
const ASSISTANCE_AVAILABILITY = ['installed', 'installable', 'pending-artifacts', 'unsupported-platform', 'insufficient-memory'];
function assistanceModelId(value) {
	const modelId = text(value, 64); if (!/^[a-z\d][a-z\d.-]*[a-z\d]$/u.test(modelId)) throw new TypeError('Unsupported assistance model id'); return modelId;
}
function optionalBytes(value) { return value === null || value === undefined ? null : safeInteger(value); }
function assistanceModel(value) {
	const availability = String(value?.availability || '');
	if (!ASSISTANCE_AVAILABILITY.includes(availability)) throw new TypeError('Unsupported assistance availability');
	return Object.freeze({ modelId: assistanceModelId(value?.modelId), version: text(value?.version, 64), task: text(value?.task, 64),
		availability, downloadBytes: optionalBytes(value?.downloadBytes), installedBytes: optionalBytes(value?.installedBytes), attributionRequired: value?.attributionRequired === true });
}
function assistanceStatus(value) {
	if (!value || !Array.isArray(value.models)) throw new TypeError('Malformed assistance status');
	return Object.freeze({ modelsDirectory: text(value.modelsDirectory, 4096), runtimeAvailable: value.runtimeAvailable === true,
		runtimeReason: value.runtimeReason === null ? null : text(value.runtimeReason, 512),
		models: Object.freeze(value.models.map(assistanceModel)) });
}
function assistanceProgress(value) { return Object.freeze({ modelId: assistanceModelId(value?.modelId), fileName: text(value?.fileName, 160),
	completedBytes: safeInteger(value?.completedBytes), totalBytes: safeInteger(value?.totalBytes) }); }
function subscribe(channel, listener, sanitize) {
	if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
	const handler = (_event, value) => listener(sanitize(value));
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
}
function sanitizeReadDescriptor(value) {
	const id = opaqueId(value?.id, 64);
	const readProfile = readDescriptorProfile(value?.readProfile);
	const name = readDescriptorName(value?.name);
	const mimeType = readDescriptorMimeType(value?.mimeType);
	assertReadDescriptorProfile(readProfile, name, mimeType);
	return Object.freeze({
		id,
		readProfile,
		url: trustedCapabilityUrl(value?.url, { id, readProfile, name }),
		name,
		size: readDescriptorSize(value?.size, readProfile),
		mimeType,
		lastModified: safeInteger(value?.lastModified),
	});
}
function sanitizeReadDescriptors(values) {
	if (!Array.isArray(values)) throw new TypeError('Expected read descriptors');
	return Object.freeze(values.map(sanitizeReadDescriptor));
}
function nullableLinkedLocator(value, kind) {
	if (value === null) return null;
	const name = readDescriptorName(value?.name);
	const mimeType = linkedOriginalMimeType(kind, value?.mimeType, name);
	const size = readDescriptorSize(value?.size, READ_PROFILE_MATERIALIZED_V1);
	if (size === 0) throw new RangeError(`Linked-${kind} size must be positive`);
	return Object.freeze({
		locatorId: opaqueId(value?.locatorId, 64), locatorRevision: linkedLocatorRevision(value?.locatorRevision),
		name, size, mimeType,
		lastModified: safeInteger(value?.lastModified),
	});
}
function linkedVideoLoadRequest(value) {
	return linkedOriginalLoadRequest(value, 'video', 'playback');
}
function linkedAudioLoadRequest(value) {
	return linkedOriginalLoadRequest(value, 'audio', 'range');
}
function linkedOriginalLoadRequest(value, kind, mode) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`A linked-${kind} load request is required`);
	const fields = ['locatorId', 'expectedRevision', mode]; const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) || fields.some((field) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, field); return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
	})) throw new TypeError(`A linked-${kind} load request contains an unsupported field`);
	if (value[mode] !== true && value[mode] !== false) throw new TypeError(`Linked-${kind} load mode must be a boolean`);
	const expectedRevision = value.expectedRevision === null ? null : linkedLocatorRevision(value.expectedRevision);
	if (value[mode] && expectedRevision === null) throw new TypeError(`Linked-${kind} ${mode} requires an exact locator revision`);
	return Object.freeze({ locatorId: opaqueId(value.locatorId, 64), expectedRevision, [mode]: value[mode] });
}
function linkedVideoReferences(value) {
	if (!Array.isArray(value) || value.length > 128) throw new RangeError('Linked-video reconciliation reference count exceeds its limit');
	const identifiers = new Set();
	return Object.freeze(value.map((reference) => {
		const fields = ['locatorId', 'locatorRevision'];
		const keys = reference && typeof reference === 'object' && !Array.isArray(reference) ? Reflect.ownKeys(reference) : [];
		if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) || fields.some((field) => {
			const descriptor = Object.getOwnPropertyDescriptor(reference, field); return !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
		})) throw new TypeError('Linked-video reconciliation reference contains an unsupported field');
		const locatorId = opaqueId(reference.locatorId, 64);
		if (identifiers.has(locatorId)) throw new Error('Linked-video reconciliation contains a duplicate identifier');
		identifiers.add(locatorId);
		return Object.freeze({ locatorId, locatorRevision: linkedLocatorRevision(reference.locatorRevision) });
	}));
}
function linkedOriginalReferences(value) {
	if (!Array.isArray(value) || value.length > 128) throw new RangeError('Linked-original reconciliation reference count exceeds its limit');
	const identifiers = new Set();
	return Object.freeze(value.map((reference) => {
		const fields = ['kind', 'locatorId', 'locatorRevision'];
		const keys = reference && typeof reference === 'object' && !Array.isArray(reference) ? Reflect.ownKeys(reference) : [];
		if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)) || fields.some((field) => {
			const descriptor = Object.getOwnPropertyDescriptor(reference, field); return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
		})) throw new TypeError('Linked-original reconciliation reference contains an unsupported field');
		const locatorId = opaqueId(reference.locatorId, 64);
		if (identifiers.has(locatorId)) throw new Error('Linked-original reconciliation contains a duplicate identifier');
		identifiers.add(locatorId);
		return Object.freeze({ kind: linkedMediaKind(reference.kind), locatorId, locatorRevision: linkedLocatorRevision(reference.locatorRevision) });
	}));
}
async function nullableLoadedLinkedLocator(value, kind, playback) {
	if (value === null) return null;
	try {
		const expectedProfile = playback
			? kind === 'audio' ? READ_PROFILE_LINKED_AUDIO_RANGE_V1 : READ_PROFILE_LINKED_VIDEO_RANGE_V1
			: READ_PROFILE_MATERIALIZED_V1;
		const descriptor = sanitizeReadDescriptor(value?.descriptor);
		if (descriptor.readProfile !== expectedProfile || descriptor.size === 0) throw new TypeError(`Linked-${kind} reads require a positive ${expectedProfile} descriptor`);
		linkedOriginalMimeType(kind, descriptor.mimeType, descriptor.name);
		return Object.freeze({ locatorRevision: linkedLocatorRevision(value?.locatorRevision), descriptor });
	} catch (cause) {
		let id;
		try { id = opaqueId(value?.descriptor?.id, 64); } catch { throw cause; }
		try {
			if (await ipcRenderer.invoke(CHANNELS.releaseRead, id) !== true) throw new Error('Linked-video read cleanup was not acknowledged', { cause });
		} catch (cleanupError) {
			throw new AggregateError([cause, cleanupError], 'Linked-video read validation and cleanup both failed', { cause: cleanupError });
		}
		throw cause;
	}
}
function linkedLocatorRevision(value) { try { return opaqueId(value, 64); } catch { throw new TypeError('Invalid linked-original locator revision'); } }
function linkedOriginalMimeType(kind, value, name) {
	const mimeType = readDescriptorMimeType(value);
	if (kind === 'video' && /^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)) return mimeType;
	if (kind === 'audio' && ((/\.wav$/iu.test(name) && mimeType === 'audio/wav')
		|| (/\.rf64$/iu.test(name) && mimeType === 'audio/rf64') || (/\.aiff?$/iu.test(name) && mimeType === 'audio/aiff'))) return mimeType;
	throw new TypeError(`Invalid linked-${kind} classic AIFF, WAV, or video MIME type`);
}
function linkedMediaKind(value) {
	if (value !== 'audio' && value !== 'video') throw new TypeError('Invalid linked-original media kind');
	return value;
}
function trustedCapabilityUrl(value, { id, readProfile, name }) {
	let url;
	try { url = new URL(String(value || '')); } catch { throw new TypeError('Invalid read capability URL'); }
	const expectedPath = `/_desktop/read/${readProfile}/${id}/${encodeURIComponent(name)}`;
	if (!['soundscaper-app:', 'framescaper-app:'].includes(url.protocol)
		|| url.hostname !== 'bundle' || url.port || url.username || url.password
		|| url.search || url.hash || url.pathname !== expectedPath) {
		throw new TypeError('Invalid read capability URL');
	}
	return url.href;
}
function opaqueId(value, length) {
	const id = String(value || '');
	if (id.length !== length || !/^[a-f0-9]+$/u.test(id)) throw new TypeError('Invalid opaque identifier');
	return id;
}
function externalFfmpegStatus(value) { const controlled = (entry) => [...entry].some((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127; }); nativeRecord(value, ['state', 'location', 'version', 'detail', 'canInstall', 'canBrowse', 'canClear'], 'external FFmpeg status'); if (!['unconfigured', 'probing', 'ready', 'unsupported', 'quarantined', 'unavailable', 'installing', 'error'].includes(value.state) || !(value.location === null || typeof value.location === 'string' && value.location.length <= 4096 && !controlled(value.location)) || !(value.version === null || typeof value.version === 'string' && value.version.length <= 256 && !controlled(value.version)) || typeof value.detail !== 'string' || value.detail.length > 2048 || controlled(value.detail) || typeof value.canInstall !== 'boolean' || typeof value.canBrowse !== 'boolean' || typeof value.canClear !== 'boolean') throw new TypeError('Invalid external FFmpeg status'); return Object.freeze({ state: value.state, location: value.location, version: value.version, detail: value.detail, canInstall: value.canInstall, canBrowse: value.canBrowse, canClear: value.canClear }); } function text(value, maxLength) {
	return String(value || '').replace(/[\u0000-\u001f]/gu, '').slice(0, maxLength);
}
function textEditCommand(value) {
	const command = String(value || '');
	if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(command)) throw new TypeError('Unsupported text edit command');
	return command;
}
function safeInteger(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('Expected a non-negative safe integer');
	return number;
}
function readDescriptorProfile(value) {
	const profile = String(value || '');
	if (![READ_PROFILE_LINKED_AUDIO_RANGE_V1, READ_PROFILE_LINKED_VIDEO_RANGE_V1, READ_PROFILE_MATERIALIZED_V1, READ_PROFILE_SCAPE_RANGE_V1].includes(profile)) {
		throw new TypeError('Invalid read descriptor profile');
	}
	return profile;
}
function readDescriptorName(value) {
	const name = text(value, 255);
	if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
		throw new TypeError('Invalid read descriptor name');
	}
	return name;
}
function readDescriptorMimeType(value) {
	const mimeType = text(value, 128);
	if (!mimeType) throw new TypeError('Invalid read descriptor MIME type');
	return mimeType;
}
function assertReadDescriptorProfile(readProfile, name, mimeType) {
	const hasScapeName = /\.scape$/iu.test(name);
	const hasScapeMime = mimeType === SCAPE_PROJECT_MIME_TYPE;
	if (readProfile === READ_PROFILE_SCAPE_RANGE_V1) {
		if (!hasScapeName || !hasScapeMime) throw new TypeError('Invalid Scape range read descriptor');
	} else if (hasScapeName || hasScapeMime) {
		throw new TypeError('Invalid materialized read descriptor profile');
	}
}
function readDescriptorSize(value, readProfile) {
	const size = safeInteger(value);
	const maximum = readProfile === READ_PROFILE_SCAPE_RANGE_V1
		? MAX_SCAPE_RANGE_READ_DESCRIPTOR_BYTES
		: MAX_MATERIALIZED_READ_DESCRIPTOR_BYTES;
	if (size > maximum) throw new RangeError('Read descriptor is too large for its profile');
	return size;
}
function saveDeclaration(options) {
	const targetId = opaqueId(options?.targetId, 48);
	const exactSize = options?.size !== undefined;
	if (exactSize === (options?.maximumSize !== undefined)) {
		throw new RangeError('Expected exactly one exact size or admitted maximum');
	}
	const declaration = exactSize
		? { targetId, size: saveSize(options.size) }
		: { targetId, maximumSize: saveSize(options.maximumSize) };
	if (options?.finalPrefixByteLength === undefined) return declaration;
	if (options.finalPrefixByteLength !== FINAL_PREFIX_BYTES) throw new RangeError('Final prefix must be exactly 32 bytes');
	if (!exactSize) throw new RangeError('A final prefix requires an exact-size save');
	if (declaration.size < FINAL_PREFIX_BYTES) throw new RangeError('A final-prefix save must be at least 32 bytes');
	return { ...declaration, finalPrefixByteLength: FINAL_PREFIX_BYTES };
}
function saveSize(value) {
	const size = safeInteger(value);
	if (size > MAX_DESKTOP_SAVE_BYTES) throw new RangeError('Save size is too large');
	return size;
}
function sharedProjectSummaries(value) {
	if (!Array.isArray(value) || value.length > MAX_SHARED_PROJECTS) throw new RangeError('Desktop shared-project service returned an invalid project count');
	const summaries = Array.from(value, (summary) => Object.freeze({
		id: sharedProjectId(summary?.id),
		title: sharedProjectTitle(summary?.title),
		revision: safeInteger(summary?.revision),
		updatedAt: sharedProjectInstant(summary?.updatedAt),
	}));
	if (new Set(summaries.map(({ id }) => id)).size !== summaries.length) throw new TypeError('Desktop shared-project service returned duplicate project ids');
	return Object.freeze(summaries);
}
function sharedProjectId(value) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError('Desktop shared-project id must be a non-empty string');
	if (utf8Bytes(value, MAX_SHARED_PROJECT_ID_BYTES) > MAX_SHARED_PROJECT_ID_BYTES) throw new RangeError('Desktop shared-project id exceeds its byte limit');
	return value;
}
function sharedProjectTitle(value) {
	if (typeof value !== 'string' || !value || value.length > 255
		|| value.trim() !== value || hasControlCharacters(value)) {
		throw new TypeError('Desktop shared-project title is invalid');
	}
	return value;
}
function hasControlCharacters(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}
function sharedProjectInstant(value) {
	if (typeof value !== 'string' || !SHARED_PROJECT_INSTANT.test(value)) throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	const date = new Date(value);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new TypeError('Desktop shared-project updatedAt must be a canonical ISO instant');
	return value;
}
function projectDocument(value, maximumBytes = MAX_SHARED_PROJECT_DOCUMENT_BYTES) {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
		|| maximumBytes > MAX_SHARED_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Desktop shared-project document byte limit cannot exceed its hard limit');
	}
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError('Desktop shared-project document must be a non-empty string');
	}
	if (utf8Bytes(value, maximumBytes) > maximumBytes) {
		throw new RangeError('Desktop shared-project document exceeds its byte limit');
	}
	return value;
}
function nullableProjectDocument(value) { return value === null ? null : projectDocument(value); }
function sharedProjectCommitRequest(value) { const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : []; if (keys.length !== 2 || !keys.includes('document') || !keys.includes('expectedRevision')) throw new TypeError('Desktop shared-project commit request has unsupported fields'); const request = value;
	if (request.expectedRevision !== null && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new RangeError('Desktop shared-project expected revision is invalid');
	return Object.freeze({ document: projectDocument(request.document), expectedRevision: request.expectedRevision }); }
function sharedProjectCommitResult(value) { const fields = value?.status === 'committed' ? ['status', 'document'] : ['status', 'currentRevision']; const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : []; if (keys.length !== 2 || keys.some((key) => !fields.includes(key))) throw new TypeError('Desktop shared-project commit result is invalid'); const result = value;
	if (result.status === 'committed') return Object.freeze({ status: 'committed', document: projectDocument(result.document) });
	if (result.status !== 'conflict' || !Number.isSafeInteger(result.currentRevision) || result.currentRevision < 0) throw new TypeError('Desktop shared-project commit result is invalid');
	return Object.freeze({ status: 'conflict', currentRevision: result.currentRevision }); }
function nullableProjectBundle(value) { if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Array.isArray(value.sources) || value.sources.length > MAX_SHARED_SOURCES) {
		throw new TypeError('Desktop shared-project bundle is invalid');
	}
	const sources = Object.freeze(value.sources.map(sharedManagedSourceDescriptor));
	if (new Set(sources.map(({ kind, sourceId }) => `${kind}:${sourceId}`)).size !== sources.length) {
		throw new TypeError('Desktop shared-project bundle contains duplicate source identities');
	}
	return Object.freeze({ document: projectDocument(value.document), sources });
}
function sharedManagedSourceDescriptor(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor is invalid');
	}
	const encoding = sharedManagedSourceEncoding(value.kind, value.encoding);
	const bindingId = sharedManagedBindingId(value.bindingId);
	const byteLength = sharedSourceBytes(value.byteLength);
	const expectedPrefix = value.kind === 'audio' ? 'm' : value.kind === 'video' ? 'v' : 't';
	if (bindingId[0] !== expectedPrefix) throw new TypeError('Desktop shared-source descriptor is invalid');
	if (value.kind !== 'audio' && byteLength === 0) {
		throw new RangeError('Desktop shared-source retained-media byte length must be positive');
	}
	return Object.freeze({
		bindingId,
		byteLength,
		encoding,
		kind: value.kind,
		sha256: sharedSourceSha256(value.sha256),
		sourceId: sharedSourceIdentity(value.sourceId),
		storageKey: sharedSourceIdentity(value.storageKey),
	});
}
function sharedSourceWriteDeclaration(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write declaration is invalid');
	}
	const encoding = sharedManagedEncoding(value.encoding);
	const byteLength = sharedSourceBytes(value.byteLength);
	if (encoding !== MANAGED_AUDIO_ENCODING && byteLength === 0) {
		throw new RangeError('Desktop shared-source retained-media byte length must be positive');
	}
	return Object.freeze({
		byteLength,
		encoding,
		projectId: sharedProjectId(value.projectId),
		projectRevision: safeInteger(value.projectRevision),
		sha256: sharedSourceSha256(value.sha256),
		sourceId: sharedSourceIdentity(value.sourceId),
	});
}
function sharedSourceWriteAdmission(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write admission is invalid');
	}
	if (value.status === 'present') {
		return Object.freeze({ status: 'present', source: sharedManagedSourceDescriptor(value.source) });
	}
	if (value.status !== 'ready') throw new TypeError('Desktop shared-source write admission is invalid');
	const chunkSize = positiveSafeInteger(value.chunkSize);
	if (chunkSize > MAX_CHUNK_BYTES) throw new RangeError('Desktop shared-source chunk size is too large');
	return Object.freeze({ status: 'ready', chunkSize, writeId: sharedSourceWriteId(value.writeId) });
}
function sharedSourceChunkWrite(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk write is invalid');
	}
	const bytes = binary(value.bytes);
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk is too large');
	}
	return Object.freeze({
		bytes,
		offset: safeInteger(value.offset),
		writeId: sharedSourceWriteId(value.writeId),
	});
}
function sharedSourceChunkAcknowledgement(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk acknowledgement is invalid');
	}
	return Object.freeze({ nextOffset: safeInteger(value.nextOffset) });
}
function sharedSourceWriteCompletion(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source write completion is invalid');
	}
	return Object.freeze({
		sha256: sharedSourceSha256(value.sha256),
		writeId: sharedSourceWriteId(value.writeId),
	});
}
function sharedSourceChunkRead(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source chunk read is invalid');
	}
	const length = positiveSafeInteger(value.length);
	if (length > MAX_CHUNK_BYTES) throw new RangeError('Desktop shared-source read is too large');
	return Object.freeze({
		bindingId: sharedManagedBindingId(value.bindingId),
		length,
		offset: safeInteger(value.offset),
	});
}
function sharedSourceChunkResult(value, expectedLength) {
	const bytes = binary(value);
	if (bytes.byteLength !== expectedLength) {
		throw new Error('Desktop shared-source read returned an unexpected byte length');
	}
	return bytes;
}
function sharedSourceIdentity(value) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Desktop shared-source identity is invalid');
	}
	if (utf8Bytes(value, MAX_SHARED_PROJECT_ID_BYTES) > MAX_SHARED_PROJECT_ID_BYTES) {
		throw new RangeError('Desktop shared-source identity exceeds its byte limit');
	}
	return value;
}
function sharedSourceBytes(value) {
	const bytes = safeInteger(value);
	if (bytes > MAX_SHARED_SOURCE_BYTES) throw new RangeError('Desktop shared-source byte length is too large');
	return bytes;
}
function sharedSourceWriteId(value) {
	if (typeof value !== 'string' || !SOURCE_WRITE_ID.test(value)) throw new TypeError('Desktop shared-source write id is invalid');
	return value;
}
function sharedManagedBindingId(value) {
	if (typeof value !== 'string' || !MANAGED_BINDING_ID.test(value)) throw new TypeError('Desktop shared-source binding id is invalid');
	return value;
}
function sharedManagedEncoding(value) {
	if (value !== MANAGED_AUDIO_ENCODING && value !== MANAGED_VIDEO_ENCODING
		&& value !== MANAGED_VIDEO_TIMING_ENCODING) throw new TypeError('Desktop shared-source media encoding is unsupported');
	return value;
}
function sharedManagedSourceEncoding(kind, encoding) {
	const admitted = sharedManagedEncoding(encoding);
	if ((kind === 'audio' && admitted === MANAGED_AUDIO_ENCODING)
		|| (kind === 'video' && admitted === MANAGED_VIDEO_ENCODING)
		|| (kind === 'video-timing' && admitted === MANAGED_VIDEO_TIMING_ENCODING)) return admitted;
	throw new TypeError('Desktop shared-source kind and encoding do not match');
}
function sharedSourceSha256(value) {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('Desktop shared-source SHA-256 digest is invalid');
	return value;
}
function positiveSafeInteger(value) { const number = safeInteger(value); if (number === 0) throw new RangeError('Expected a positive safe integer'); return number; } function nativeAudioAvailability(value) { const payload = value?.payload; return Object.freeze({ enabled: value?.enabled === true, quarantined: value?.quarantined === true, payload: Object.freeze({ status: payload?.status === 'available' ? 'available' : 'unavailable', reason: payload?.reason == null ? null : text(payload.reason, 64), detail: text(payload?.detail ?? '', 512) }), backends: Object.freeze(bounded(value?.backends, 16).map((backend) => text(backend, 32))), routePreference: value?.routePreference == null ? null : nativeAudioSessionOpenRequest(value.routePreference) }); }
function nativeAudioInventory(value) { const inventory = value?.inventory; if (value?.status !== 'described') return Object.freeze({ status: 'failed', code: text(value?.code ?? 'helper-failed', 32), message: text(value?.message ?? '', 512) }); return Object.freeze({ status: 'described', inventory: Object.freeze({ backend: text(inventory?.backend, 32), status: text(inventory?.status, 32), detail: text(inventory?.detail ?? '', 512), devices: Object.freeze(bounded(inventory?.devices, 128).map((device) => Object.freeze({ handle: text(device?.handle, 256), label: text(device?.label, 256), direction: text(device?.direction, 16), channelCount: device?.channelCount == null ? undefined : nativeBoundedInteger(device.channelCount, 1, 32, 'device channel count'), isDefault: device?.isDefault === true }))) }) }); } function bounded(value, maximum) { return Array.isArray(value) ? value.slice(0, maximum) : []; }
function nativePluginStatus(value, depth = 0) { if (typeof value === 'string') return text(value, 1024); if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value; if (depth >= 8) return null; if (Array.isArray(value)) return Object.freeze(bounded(value, 512).map((entry) => nativePluginStatus(entry, depth + 1))); if (!value || typeof value !== 'object') return null; const output = {}; for (const key of Object.keys(value).slice(0, 64)) { if (PLUGIN_PATH_KEYS.has(key)) continue; output[text(key, 64)] = nativePluginStatus(value[key], depth + 1); } return Object.freeze(output); }
function helperProbeCompletion(value) { if (value?.status === 'probed') { const timingAsset = binary(value.timingAsset);
		if (timingAsset.byteLength < 32 || timingAsset.byteLength > 16_000_032) throw new RangeError('Helper probe timing asset is out of range'); const characteristics = JSON.stringify(value.characteristics ?? null);
		if (utf8Bytes(characteristics, 65_536) > 65_536) throw new RangeError('Helper probe characteristics exceed their bound');
		return Object.freeze({ status: 'probed', timingAsset, nominalRate: Object.freeze({ num: positiveSafeInteger(value.nominalRate?.num), den: positiveSafeInteger(value.nominalRate?.den) }), characteristics: JSON.parse(characteristics) }); }
	if (value?.status === 'failed') return Object.freeze({ status: 'failed', code: text(value.code, 64), message: text(value.message, 2048) }); throw new TypeError('Desktop returned an unsupported helper probe completion'); }
function nativeAudioEnabled(value) { return strictBoolean(value, 'Desktop native-audio setting result must be a boolean'); }
function nativeAudioSessionOpenRequest(value) { nativeRecord(value, ['candidates', 'direction', 'mode', 'sampleRate', 'periodFrames', 'channelCount'], 'native audio open request'); const candidates = nativeArray(value.candidates, 4, 'audio candidates').map((candidate) => { nativeRecord(candidate, ['backend', 'deviceHandle'], 'audio candidate'); if (!['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa', 'jack'].includes(candidate.backend) || typeof candidate.deviceHandle !== 'string' || !candidate.deviceHandle.length || candidate.deviceHandle.length > 1024 || /[\0/\\]/u.test(candidate.deviceHandle)) throw new TypeError('Invalid native audio candidate'); return Object.freeze({ backend: candidate.backend, deviceHandle: candidate.deviceHandle }); }); if (!candidates.length || !['input', 'output', 'duplex'].includes(value.direction) || !['shared', 'exclusive'].includes(value.mode)) throw new TypeError('Invalid native audio open mode'); return Object.freeze({ candidates: Object.freeze(candidates), direction: value.direction, mode: value.mode, sampleRate: nativeBoundedInteger(value.sampleRate, 8000, 768000, 'sample rate'), periodFrames: nativeBoundedInteger(value.periodFrames, 1, 16384, 'period frames'), channelCount: nativeBoundedInteger(value.channelCount, 1, 32, 'channel count') }); } function nativeAudioSessionIdRequest(value, binding) { nativeRecord(value, binding ? ['sessionId', 'queueCapacity'] : ['sessionId'], 'native audio session request'); const request = { sessionId: nativeRuntimeId(value.sessionId, 'audio session') }; if (binding) request.queueCapacity = nativeBoundedInteger(value.queueCapacity, 8, 8, 'queue capacity'); return Object.freeze(request); } function nativeAudioSessionCalibrationRequest(value) { nativeRecord(value, ['sessionId', 'calibrationFrames'], 'native audio calibration request'); return Object.freeze({ sessionId: nativeRuntimeId(value.sessionId, 'audio session'), calibrationFrames: nativeBoundedInteger(value.calibrationFrames, 0, 1048576, 'calibration offset') }); } function nativeAudioSessionTransferRequest(value) { nativeRecord(value, ['sessionId', 'framesTransferred', 'lostFrames'], 'native audio transfer report'); return Object.freeze({ sessionId: nativeRuntimeId(value.sessionId, 'audio session'), framesTransferred: nativeBoundedInteger(value.framesTransferred, 0, Number.MAX_SAFE_INTEGER, 'transferred frames'), lostFrames: nativeBoundedInteger(value.lostFrames, 0, Number.MAX_SAFE_INTEGER, 'lost frames') }); } function nativeAudioSessionLossRequest(value) { nativeRecord(value, ['sessionId', 'reason'], 'native audio loss report'); if (!['device-loss', 'device-fault', 'short-transfer', 'output-overrun', 'pool-violation', 'peer-loss', 'malformed-message'].includes(value.reason)) throw new TypeError('Invalid native audio loss reason'); return Object.freeze({ sessionId: nativeRuntimeId(value.sessionId, 'audio session'), reason: value.reason }); }
function nativePluginReviewRequest(value) { nativeRecord(value, ['installationId', 'action'], 'native plug-in installation review'); if (!['allow', 'select', 'revoke'].includes(value.action)) throw new TypeError('Invalid native plug-in installation action'); return Object.freeze({ installationId: nativeInstallationId(value.installationId), action: value.action }); } function nativeInstallationId(value) { if (typeof value !== 'string' || !/^i[a-f0-9]{15}$/u.test(value)) throw new TypeError('Invalid native plug-in installation id'); return value; } function nativePluginInstantiationRequest(value) { nativeRecord(value, ['installationId', 'instanceId', 'sampleRate'], 'native plug-in instantiate request'); return Object.freeze({ installationId: nativeInstallationId(value.installationId), instanceId: value.instanceId === null ? null : nativeRuntimeId(value.instanceId, 'plug-in instance'), sampleRate: nativeBoundedInteger(value.sampleRate, 8000, 768000, 'plug-in sample rate') }); } function nativePluginInstanceRequest(value) { nativeRecord(value, ['instanceId'], 'native plug-in instance request'); return Object.freeze({ instanceId: nativeRuntimeId(value.instanceId, 'plug-in instance') }); } function nativePluginBypassRequest(value) { nativeRecord(value, ['instanceId', 'bypassed'], 'native plug-in bypass request'); if (typeof value.bypassed !== 'boolean') throw new TypeError('Invalid native plug-in bypass flag'); return Object.freeze({ instanceId: nativeRuntimeId(value.instanceId, 'plug-in instance'), bypassed: value.bypassed }); }
function nativePluginStatePersistRequest(value) { nativeRecord(value, ['instanceId', 'generation', 'bytes', 'authentication'], 'native plug-in state persist request'); const bytes = binary(value.bytes); if (bytes.byteLength > 16 * 1024 * 1024) throw new RangeError('Native plug-in state exceeds 16 MiB'); const authentication = value.authentication; nativeRecord(authentication, ['requestId', 'byteLength', 'sha256', 'mac'], 'native plug-in state authentication'); return Object.freeze({ instanceId: nativeRuntimeId(value.instanceId, 'plug-in instance'), generation: nativeBoundedInteger(value.generation, 0, 0xffffffff, 'state generation'), bytes, authentication: Object.freeze({ requestId: nativeRuntimeId(authentication.requestId, 'state request'), byteLength: nativeBoundedInteger(authentication.byteLength, 0, 16 * 1024 * 1024, 'state proof byte length'), sha256: nativeDigest(authentication.sha256, 'state proof'), mac: nativeDigest(authentication.mac, 'state proof authentication') }) }); } function nativePluginStateRestoreRequest(value) { nativeRecord(value, ['instanceId', 'generation', 'stateBody'], 'native plug-in state restore request'); const body = value.stateBody; nativeRecord(body, ['kind', 'bodyId', 'byteLength', 'sha256'], 'native plug-in state body'); if (body.kind !== 'native-plugin-state' || typeof body.sha256 !== 'string' || !SHA256.test(body.sha256) || body.bodyId !== `native-plugin-state:${body.sha256}`) throw new TypeError('Invalid native plug-in state body identity'); return Object.freeze({ instanceId: nativeRuntimeId(value.instanceId, 'plug-in instance'), generation: nativeBoundedInteger(value.generation, 0, 0xffffffff, 'state generation'), stateBody: Object.freeze({ kind: body.kind, bodyId: body.bodyId, byteLength: nativeBoundedInteger(body.byteLength, 0, 16 * 1024 * 1024, 'state byte length'), sha256: body.sha256 }) }); } function nativePluginStateRestoreProjection(value) { nativeRecord(value, ['projectState', 'bytes'], 'native plug-in state restoration'); const bytes = binary(value.bytes); if (bytes.byteLength > 16 * 1024 * 1024) throw new RangeError('Restored native plug-in state exceeds 16 MiB'); return Object.freeze({ projectState: nativePluginStatus(value.projectState), bytes }); } function nativePluginVendorCloseRequest(value) { nativeRecord(value, ['instanceId', 'windowHandleId'], 'native plug-in vendor window close request'); return Object.freeze({ instanceId: nativeRuntimeId(value.instanceId, 'plug-in instance'), windowHandleId: nativeRuntimeId(value.windowHandleId, 'vendor window') }); } function nativeRuntimeId(value, label) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new TypeError(`Invalid native ${label} id`); return value; } function nativeBoundedInteger(value, minimum, maximum, label) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid native ${label}`); return value; }
function nativeImageSequenceDecodeRequest(value) { nativeRecord(value, ['requestId', 'projectId', 'projectRevision', 'sourceId'], 'image-sequence decode request'); const projectId = nativeImageSequenceProjectId(value.projectId), sourceId = nativeImageSequenceProjectId(value.sourceId); if (!Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0) throw new RangeError('Invalid image-sequence project revision'); return Object.freeze({ requestId: nativeImageSequenceId(value.requestId), projectId, projectRevision: value.projectRevision, sourceId }); } function nativeImageSequenceDecodeIdRequest(value, field) { nativeRecord(value, [field], 'image-sequence decode identity'); return Object.freeze({ [field]: nativeImageSequenceId(value[field]) }); } function nativeImageSequenceDecodeReadRequest(value) { nativeRecord(value, ['claimId', 'offset', 'length'], 'image-sequence decode read'); if (!Number.isSafeInteger(value.offset) || value.offset < 0 || !Number.isSafeInteger(value.length) || value.length < 1 || value.length > 16 * 1024 * 1024) throw new RangeError('Invalid decoded image-sequence range'); return Object.freeze({ claimId: nativeImageSequenceId(value.claimId), offset: value.offset, length: value.length }); } function nativeImageSequenceDecodeClaim(value) { nativeRecord(value, ['claimId', 'sourceId', 'byteLength', 'sha256', 'frameCount', 'width', 'height', 'frameRate'], 'image-sequence decode claim'); nativeRecord(value.frameRate, ['num', 'den'], 'image-sequence decode rate'); return Object.freeze({ claimId: nativeImageSequenceId(value.claimId), sourceId: nativeImageSequenceProjectId(value.sourceId), byteLength: positiveSafeInteger(value.byteLength), sha256: nativeDigest(value.sha256, 'decoded image sequence'), frameCount: positiveSafeInteger(value.frameCount), width: positiveSafeInteger(value.width), height: positiveSafeInteger(value.height), frameRate: Object.freeze({ num: positiveSafeInteger(value.frameRate.num), den: positiveSafeInteger(value.frameRate.den) }) }); } function nativeImageSequenceProjectId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Invalid image-sequence project identity'); return value; }
function windowAction(value) { const action = text(value, 32); if (!['minimize', 'toggle-maximize', 'toggle-fullscreen', 'quit', 'reload', 'toggle-dev-tools'].includes(action)) throw new TypeError('Unsupported window action'); return action; }
function windowState(value) { return Object.freeze({ maximized: value?.maximized === true, fullscreen: value?.fullscreen === true }); }
const NATIVE_CAPABILITY_ROWS = Object.freeze({ 'queue/persistent-render-queue': true, 'watch/watch-folders': true, 'codec/encode-mov-prores-proxy': true, 'operation/image-sequence-import': true, 'display/external-display': true, 'ofx/isolated-host': true });
function nativeCapabilitySnapshot(value) { nativeRecord(value, ['snapshotVersion', 'masterEnabled', 'buildFingerprint', 'entries'], 'native capability snapshot'); if (value.snapshotVersion !== 1 || typeof value.masterEnabled !== 'boolean' || (value.buildFingerprint !== null && !SHA256.test(value.buildFingerprint)) || !Array.isArray(value.entries) || value.entries.length !== 6) throw new TypeError('Invalid Framescaper native capability snapshot'); const seen = new Set(); const entries = value.entries.map((entry) => { nativeRecord(entry, ['domain', 'id', 'state', 'reason', 'userEnabled', 'buildFingerprint', 'detail'], 'native capability entry'); const key = `${entry.domain}/${entry.id}`; if (!NATIVE_CAPABILITY_ROWS[key] || seen.has(key) || !['disabled', 'blocked-policy', 'unavailable', 'available', 'degraded', 'quarantined'].includes(entry.state) || !['policy-row-blocked', 'quarantined-after-repeated-failure', 'master-switch-off', 'build-does-not-support', 'driver-probe-failed', 'self-test-failed', 'degraded-after-failure', 'ready'].includes(entry.reason) || typeof entry.userEnabled !== 'boolean' || (entry.buildFingerprint !== null && !SHA256.test(entry.buildFingerprint)) || (entry.detail !== null && (typeof entry.detail !== 'string' || !entry.detail.length || entry.detail.length > 512))) throw new TypeError('Invalid Framescaper native capability entry'); seen.add(key); return Object.freeze({ ...entry }); }); return Object.freeze({ snapshotVersion: 1, masterEnabled: value.masterEnabled, buildFingerprint: value.buildFingerprint, entries: Object.freeze(entries) }); }
function nativeServicesSnapshot(value) { if (value?.snapshotVersion !== 1 || typeof value?.runtimeAvailable !== 'boolean' || typeof value?.nativeMediaEnabled !== 'boolean') throw new TypeError('Invalid Framescaper native-services snapshot');
	return Object.freeze({ snapshotVersion: 1, runtimeAvailable: value.runtimeAvailable, nativeMediaEnabled: value.nativeMediaEnabled, queue: nativeQueueProjections(value.queue), roots: Object.freeze(nativeArray(value.roots, 1024, 'roots').map(nativeRootProjection)), watchRules: Object.freeze(nativeArray(value.watchRules, 1024, 'watch rules').map(nativeWatchProjection)) }); }
function nativeQueueProjections(value) { return Object.freeze(nativeArray(value, 100000, 'queue').map(nativeQueueProjection)); }
function nativeQueueProjection(value) { const destination = nativeRelativeDestination(value?.relativeDestination); const taskKind = text(value?.taskKind, 32); const state = text(value?.state, 32);
	if (!['encoded-export', 'image-sequence-export', 'proxy-generation'].includes(taskKind) || !['queued', 'running', 'paused', 'blocked', 'needs-authorization', 'completed', 'failed', 'cancelled'].includes(state)) throw new TypeError('Invalid Framescaper native queue projection');
	const progress = value?.progress === null ? null : Number(value?.progress); if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 1)) throw new TypeError('Invalid Framescaper native queue progress');
	return Object.freeze({ jobId: opaqueId(value?.jobId, 40), taskKind, projectId: text(value?.projectId, 4096), relativeDestination: destination, state, position: safeInteger(value?.position), progress, attempt: safeInteger(value?.attempt), lastFailureCode: value?.lastFailureCode === null ? null : text(value?.lastFailureCode, 4096) }); }
function nativeRootProjection(value) { return Object.freeze({ grantId: nativeIdentifier(value?.grantId, 'grant id'), displayName: text(value?.displayName, 4096), revoked: value?.revoked === true }); }
function nativeWatchProjection(value) { nativeRecord(value, ['ruleId', 'grantId', 'projectId', 'binId', 'extensions', 'importMode', 'generateProxies', 'enabled'], 'watch projection'); const mode = value.importMode; if (mode !== 'link' && mode !== 'copy' || typeof value.generateProxies !== 'boolean' || typeof value.enabled !== 'boolean') throw new TypeError('Invalid Framescaper watch projection');
	return Object.freeze({ ruleId: nativeIdentifier(value.ruleId, 'watch rule id'), grantId: nativeIdentifier(value.grantId, 'grant id'), projectId: text(value.projectId, 4096), binId: value.binId === null ? null : text(value.binId, 128), extensions: Object.freeze(nativeArray(value.extensions, 32, 'watch extensions').map((item) => text(item, 32))), importMode: mode, generateProxies: value.generateProxies, enabled: value.enabled }); }
function nativeIdentifier(value, label, length = null) { if (typeof value !== 'string' || (length === null ? value.length < 16 || value.length > 64 : value.length !== length) || !/^[a-f0-9]+$/u.test(value)) throw new TypeError(`Invalid Framescaper native ${label}`); return value; }
function nativeDigest(value, label) { if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`Invalid Framescaper native ${label} digest`); return value; }
function nativeLifecycleIdRequest(value, field) { nativeRecord(value, [field], `${field} request`); return Object.freeze({ [field]: nativeIdentifier(value[field], field, field === 'jobId' || field === 'stageId' ? 40 : null) }); }
function nativeWatchCreateRequest(value) { nativeRecord(value, ['grantId', 'projectId', 'binId', 'extensions', 'importMode', 'generateProxies'], 'watch create request'); const extensions = Object.freeze(nativeArray(value.extensions, 32, 'watch extensions').map((item) => text(item, 32))); if (!extensions.length || !text(value.projectId, 4096) || (value.binId !== null && !text(value.binId, 128)) || !['link', 'copy'].includes(value.importMode) || typeof value.generateProxies !== 'boolean') throw new TypeError('Invalid Framescaper watch create request'); return Object.freeze({ grantId: nativeIdentifier(value.grantId, 'grant id'), projectId: text(value.projectId, 4096), binId: value.binId === null ? null : text(value.binId, 128), extensions, importMode: value.importMode, generateProxies: value.generateProxies }); }
function nativeWatchEnabledRequest(value) { nativeRecord(value, ['ruleId', 'enabled'], 'watch enabled request'); if (typeof value.enabled !== 'boolean') throw new TypeError('Invalid Framescaper watch enabled request'); return Object.freeze({ ruleId: nativeIdentifier(value.ruleId, 'watch rule id'), enabled: value.enabled }); } function nativeWatchImportClaimRequest(value) { nativeRecord(value, ['projectId', 'projectRevision'], 'watch import claim request'); return Object.freeze({ projectId: nativeBoundedText(value.projectId, 128, 'watch project id'), projectRevision: safeInteger(value.projectRevision) }); } function nativeWatchImportCompletionRequest(value) { if (value && Object.prototype.hasOwnProperty.call(value, 'projectSchemaVersion')) { nativeRecord(value, ['claimId', 'projectId', 'projectSchemaVersion', 'binId', 'sourceId', 'contentSha256', 'expectedProjectRevision', 'committedProjectRevision', 'success'], 'selected watch import completion request'); if (value.projectSchemaVersion !== 28 || value.binId !== 'project-bin' || typeof value.success !== 'boolean' || (value.success && value.sourceId === null)) throw new TypeError('Invalid selected watch import completion result'); return Object.freeze({ claimId: nativeIdentifier(value.claimId, 'watch claim id'), projectId: nativeBoundedText(value.projectId, 128, 'watch project id'), projectSchemaVersion: 28, binId: 'project-bin', sourceId: value.sourceId === null ? null : nativeRuntimeId(value.sourceId, 'watch source'), contentSha256: nativeDigest(value.contentSha256, 'watch content'), expectedProjectRevision: safeInteger(value.expectedProjectRevision), committedProjectRevision: safeInteger(value.committedProjectRevision), success: value.success }); } nativeRecord(value, ['claimId', 'projectId', 'expectedProjectRevision', 'committedProjectRevision', 'success'], 'watch import completion request'); if (typeof value.success !== 'boolean') throw new TypeError('Invalid watch import completion result'); return Object.freeze({ claimId: nativeIdentifier(value.claimId, 'watch claim id'), projectId: nativeBoundedText(value.projectId, 128, 'watch project id'), expectedProjectRevision: safeInteger(value.expectedProjectRevision), committedProjectRevision: safeInteger(value.committedProjectRevision), success: value.success }); } function nativeWatchImportClaim(value) { const selected = value && Object.prototype.hasOwnProperty.call(value, 'projectSchemaVersion'); nativeRecord(value, selected ? ['claimId', 'projectId', 'projectRevision', 'projectSchemaVersion', 'binId', 'generateProxies', 'existingSourceId', 'importMode', 'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified', 'contentSha256'] : ['claimId', 'projectId', 'projectRevision', 'importMode', 'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified', 'contentSha256'], 'watch import claim'); if (!['link', 'copy'].includes(value.importMode) || !String(value.mimeType).startsWith('video/')) throw new TypeError('Invalid Framescaper watch import claim'); const size = safeInteger(value.size); if (!size) throw new RangeError('Invalid Framescaper watch import size'); const base = { claimId: nativeIdentifier(value.claimId, 'watch claim id'), projectId: nativeBoundedText(value.projectId, 128, 'watch project id'), projectRevision: safeInteger(value.projectRevision), importMode: value.importMode, locatorId: nativeIdentifier(value.locatorId, 'watch locator id'), locatorRevision: nativeIdentifier(value.locatorRevision, 'watch locator revision'), name: nativeBoundedText(value.name, 255, 'watch file name', /[\0/\\]/u), size, mimeType: nativeBoundedText(value.mimeType, 128, 'watch MIME type'), lastModified: safeInteger(value.lastModified), contentSha256: nativeDigest(value.contentSha256, 'watch content') }; if (!selected) return Object.freeze(base); if (value.projectSchemaVersion !== 28 || value.binId !== 'project-bin' || typeof value.generateProxies !== 'boolean') throw new TypeError('Invalid selected Framescaper watch import claim'); return Object.freeze({ ...base, projectSchemaVersion: 28, binId: 'project-bin', generateProxies: value.generateProxies, existingSourceId: value.existingSourceId === null ? null : nativeRuntimeId(value.existingSourceId, 'watch source') }); }
function nativeJobIds(value) { return Object.freeze(nativeArray(value, 100000, 'scratch cleanup jobs').map((jobId) => nativeIdentifier(jobId, 'job id', 40))); }
function nativeScratchSettlement(value) { if (value !== 'released' && value !== 'retained') throw new TypeError('Invalid Framescaper native scratch settlement'); return value; }
function nativePublicationRequest(value) { nativeRecord(value, ['jobId', 'currentPlanFingerprint', 'finalized', 'declaredByteLength', 'declaredSha256'], 'publication request'); if (typeof value.finalized !== 'boolean') throw new TypeError('Invalid Framescaper publication finalization'); return Object.freeze({ jobId: nativeIdentifier(value.jobId, 'job id', 40), currentPlanFingerprint: nativeDigest(value.currentPlanFingerprint, 'plan'), finalized: value.finalized, declaredByteLength: safeInteger(value.declaredByteLength), declaredSha256: nativeDigest(value.declaredSha256, 'output') }); }
function nativePublicationResult(value) { nativeRecord(value, ['outcome', 'relativeDestination', 'byteLength', 'sha256'], 'publication result'); if (!['published', 'already-published'].includes(value.outcome)) throw new TypeError('Invalid Framescaper publication outcome'); return Object.freeze({ outcome: value.outcome, relativeDestination: nativeRelativeDestination(value.relativeDestination), byteLength: safeInteger(value.byteLength), sha256: nativeDigest(value.sha256, 'output') }); }
function nativeCheckpointRequest(value) { nativeRecord(value, ['jobId', 'sourceInventoryDigest', 'plannedFrameCount', 'manifest'], 'checkpoint request'); if (!Array.isArray(value.manifest) || value.manifest.length > 16384 || utf8Bytes(JSON.stringify(value), 65536) > 65536) throw new RangeError('Framescaper checkpoint control envelope exceeds 64 KiB'); const plannedFrameCount = safeInteger(value.plannedFrameCount); const manifest = nativeArray(value.manifest, 2000000, 'checkpoint manifest').map(nativeCheckpointFrame); if (manifest.length > plannedFrameCount) throw new RangeError('Invalid Framescaper checkpoint manifest length'); return Object.freeze({ jobId: nativeIdentifier(value.jobId, 'job id', 40), sourceInventoryDigest: nativeDigest(value.sourceInventoryDigest, 'source inventory'), plannedFrameCount, manifest: Object.freeze(manifest) }); }
function nativeCheckpointFrame(value, index) { nativeRecord(value, ['frameIndex', 'relativePath', 'byteLength', 'sha256', 'planFingerprint', 'sourceInventoryDigest'], 'checkpoint frame'); if (value.frameIndex !== index) throw new TypeError('Invalid Framescaper checkpoint frame index'); return Object.freeze({ frameIndex: index, relativePath: nativeRelativeDestination(value.relativePath), byteLength: safeInteger(value.byteLength), sha256: nativeDigest(value.sha256, 'frame'), planFingerprint: nativeDigest(value.planFingerprint, 'frame plan'), sourceInventoryDigest: nativeDigest(value.sourceInventoryDigest, 'frame source inventory') }); }
function nativeCheckpointResult(value) { nativeRecord(value, ['verifiedFrameCount', 'plannedFrameCount', 'complete'], 'checkpoint result'); const verifiedFrameCount = safeInteger(value.verifiedFrameCount); const plannedFrameCount = safeInteger(value.plannedFrameCount); if (verifiedFrameCount > plannedFrameCount || typeof value.complete !== 'boolean') throw new TypeError('Invalid Framescaper checkpoint result'); return Object.freeze({ verifiedFrameCount, plannedFrameCount, complete: value.complete }); }
function nativeExternalDisplayRequest(value) { nativeRecord(value, ['displayId'], 'external display request'); return Object.freeze({ displayId: value.displayId === null ? null : nativeBoundedText(value.displayId, 128, 'display id') }); }
function nativeExternalDisplays(value) { nativeRecord(value, ['displays', 'activeDisplayId'], 'external display projection'); const displays = Object.freeze(nativeArray(value.displays, 64, 'external displays').map(nativeExternalDisplay)); if (value.activeDisplayId !== null && !displays.some((display) => display.displayId === value.activeDisplayId)) throw new TypeError('Invalid active Framescaper external display'); return Object.freeze({ displays, activeDisplayId: value.activeDisplayId }); }
function nativeExternalDisplay(value) { nativeRecord(value, ['displayId', 'label', 'primary', 'width', 'height', 'hdrCapable', 'colorManaged'], 'external display'); if (typeof value.primary !== 'boolean' || typeof value.hdrCapable !== 'boolean' || typeof value.colorManaged !== 'boolean') throw new TypeError('Invalid Framescaper external display flags'); return Object.freeze({ displayId: nativeBoundedText(value.displayId, 128, 'display id'), label: nativeBoundedText(value.label, 256, 'display label'), primary: value.primary, width: nativeDimension(value.width), height: nativeDimension(value.height), hdrCapable: value.hdrCapable, colorManaged: value.colorManaged }); }
function nativeExternalDisplayFrame(value) { nativeRecord(value, ['sequence', 'evaluationFingerprint', 'width', 'height', 'dynamicRange', 'rgbaSha256', 'rgba'], 'external display frame'); if (!['sdr', 'hdr'].includes(value.dynamicRange)) throw new TypeError('Invalid Framescaper external display dynamic range'); const width = nativeDimension(value.width); const height = nativeDimension(value.height); const rgba = binary(value.rgba); if (width * height * 4 > 64 * 1024 * 1024 || rgba.byteLength !== width * height * 4) throw new RangeError('Invalid Framescaper external display RGBA geometry'); return Object.freeze({ sequence: safeInteger(value.sequence), evaluationFingerprint: nativeDigest(value.evaluationFingerprint, 'evaluated frame'), width, height, dynamicRange: value.dynamicRange, rgbaSha256: nativeDigest(value.rgbaSha256, 'RGBA frame'), rgba }); }
/* Clean-display pixels use a one-frame MessagePort data plane.
 * Control IPC carries only exact geometry and digests; one acknowledgement
 * supplies backpressure before the completion-bound projection is accepted.
 */
function presentNativeExternalDisplayFrame(value) { const frame = nativeExternalDisplayFrame(value); const streamId = frame.rgbaSha256.slice(0, 40); const channel = new MessageChannel(); const port = channel.port2; const descriptor = Object.freeze({ sequence: frame.sequence, evaluationFingerprint: frame.evaluationFingerprint, width: frame.width, height: frame.height, dynamicRange: frame.dynamicRange, rgbaSha256: frame.rgbaSha256 }); const binding = Object.freeze({ dataPlaneVersion: 1, transport: 'message-port', streamId, direction: 'host-to-helper', byteLength: frame.rgba.byteLength, sha256: frame.rgbaSha256, maximumChunkBytes: 16 * 1024 * 1024, maximumInFlightChunks: 1 });
	return new Promise((resolve, reject) => { let awaiting = 'ack'; let settled = false; let offset = 0; let sequence = 0; const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timeout); port.onmessage = null; port.onmessageerror = null; port.close(); if (error) reject(error); else resolve(result); }; const sendChunk = () => { const end = Math.min(binding.byteLength, offset + binding.maximumChunkBytes); const bytes = frame.rgba.slice(offset, end); port.postMessage(Object.freeze({ dataPlaneVersion: 1, type: 'chunk', streamId, sequence, offset, bytes }), [bytes.buffer]); }; const timeout = setTimeout(() => { try { port.postMessage({ dataPlaneVersion: 1, type: 'cancel', streamId, reason: 'host-abort' }); } catch { /* lost */ } finish(new Error('External-display frame transfer timed out')); }, 15000);
		port.onmessage = (event) => { try { const message = event.data; if (awaiting === 'ack') { nativeRecord(message, ['dataPlaneVersion', 'type', 'streamId', 'sequence', 'receivedBytes'], 'external display frame acknowledgement'); const expectedBytes = Math.min(binding.byteLength, offset + binding.maximumChunkBytes); if (message.dataPlaneVersion !== 1 || message.type !== 'ack' || message.streamId !== streamId || message.sequence !== sequence || message.receivedBytes !== expectedBytes) throw new TypeError('Invalid external-display frame acknowledgement'); offset = expectedBytes; sequence += 1; if (offset < binding.byteLength) { sendChunk(); return; } awaiting = 'result'; port.postMessage(Object.freeze({ dataPlaneVersion: 1, type: 'complete', streamId, byteLength: binding.byteLength, sha256: frame.rgbaSha256 })); return; } nativeRecord(message, message?.type === 'result' ? ['dataPlaneVersion', 'type', 'streamId', 'projection'] : ['dataPlaneVersion', 'type', 'streamId', 'message'], 'external display frame result'); if (message.dataPlaneVersion !== 1 || message.streamId !== streamId) throw new TypeError('Invalid external-display frame result'); if (message.type === 'failure') return finish(new Error(nativeBoundedText(message.message, 512, 'frame failure'))); if (message.type !== 'result') throw new TypeError('Invalid external-display frame result'); finish(null, nativeExternalDisplays(message.projection)); } catch (error) { finish(error); } }; port.onmessageerror = () => finish(new Error('External-display frame MessagePort failed')); port.start();
		try { ipcRenderer.postMessage(CHANNELS.framescaperNativeFramePort, Object.freeze({ frame: descriptor, binding }), [channel.port1]); sendChunk(); } catch (error) { finish(error); }
	}); }
function nativeBoundedText(value, maximum, label, forbidden = /\0/u) { if (typeof value !== 'string' || !value.length || value.length > maximum || forbidden.test(value)) throw new TypeError(`Invalid Framescaper native ${label}`); return value; }
function nativeDimension(value) { const result = safeInteger(value); if (!result || result > 32768) throw new RangeError('Invalid Framescaper native display dimension'); return result; }
function nativeRelativeDestination(value) { if (typeof value !== 'string' || !value.length || value.length > 4096 || value.startsWith('/') || value.includes('\\') || value.includes(':') || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('Invalid Framescaper native relative destination'); return value; }
function nativeQueueControlRequest(value) { nativeRecord(value, ['jobId', 'action'], 'native queue control request'); const action = value.action;
	if (!['pause', 'resume', 'cancel', 'retry'].includes(action)) throw new TypeError('Invalid native queue action');
	return Object.freeze({ jobId: opaqueId(value.jobId, 40), action }); }
function nativeQueueReorderRequest(value) { nativeRecord(value, ['jobId', 'index'], 'native queue reorder request'); return Object.freeze({ jobId: opaqueId(value.jobId, 40), index: safeInteger(value.index) }); }
function nativeQueueRemoveRequest(value) { nativeRecord(value, ['jobId'], 'native queue remove request'); return Object.freeze({ jobId: opaqueId(value.jobId, 40) }); } async function abandonNativeRenderInputs(value) { const request = nativeLifecycleIdRequest(value, 'stageId'); return ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputAbandon, request).then((result) => { if (strictBoolean(result, 'Framescaper render-input abandonment must be acknowledged') !== true) throw new Error('Framescaper render-input abandonment was not acknowledged'); return true; }); } async function stageNativeRenderInputs(value) { const request = nativeRenderInputStageRequest(value); const admission = nativeRenderInputAdmission(await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputBegin, request.control), request.inputs); try { for (const [index, input] of request.inputs.entries()) await transferNativeRenderInput(admission.stageId, index, admission.inputs[index].binding, input.bytes); const result = await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputFinalize, Object.freeze({ stageId: admission.stageId })); nativeRecord(result, ['stageId'], 'render-input finalization'); if (result.stageId !== admission.stageId) throw new Error('Framescaper render-input finalization changed stage identity'); return Object.freeze({ stageId: admission.stageId }); } catch (error) { const cleanupError = await renderInputAbandonFailure(admission.stageId); if (cleanupError !== null) throw new AggregateError([error, cleanupError], 'Framescaper render-input staging failed and could not be abandoned', { cause: error }); throw error; } } async function stageNativeLiveRenderInputs(value) { const request = nativeLiveRenderInputStageRequest(value); const admission = nativeLiveRenderInputAdmission(await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputBeginLive, request.control), request); try { const result = await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputFinalize, Object.freeze({ stageId: admission.stageId })); nativeRecord(result, ['stageId'], 'live render-input finalization'); if (result.stageId !== admission.stageId) throw new Error('Framescaper live render-input finalization changed stage identity'); return Object.freeze({ stageId: admission.stageId, carrierByteLength: admission.carrierByteLength, scratchByteLength: admission.scratchByteLength }); } catch (error) { const cleanupError = await renderInputAbandonFailure(admission.stageId); if (cleanupError !== null) throw new AggregateError([error, cleanupError], 'Framescaper live render-input staging failed and could not be abandoned', { cause: error }); throw error; } } function nativeLiveRenderInputStageRequest(value) { nativeRecord(value, ['liveRenderVersion', 'planVersion', 'planFingerprint', 'planPayload', 'projectId', 'projectRevision', 'inputFingerprints', 'restartJobId', 'carrierByteLength', 'audio'], 'live render-input stage request'); if (value.liveRenderVersion !== 1 || value.planVersion !== 14 || typeof value.planPayload !== 'string' || !value.planPayload.length || utf8Bytes(value.planPayload, 65536) > 65536 || !Number.isSafeInteger(value.carrierByteLength) || value.carrierByteLength < 1 || value.carrierByteLength > 16 * 1024 ** 4) throw new TypeError('Invalid Framescaper live V14 render-input plan'); const includesAudio = nativeSelectedRenderPlanIncludesAudio(value.planPayload, 14); const audio = value.audio === null ? null : nativeLiveAudioReservation(value.audio); if ((audio !== null) !== includesAudio) throw new TypeError('Invalid Framescaper live V14 audio authority'); const inputFingerprints = Object.freeze(nativeArray(value.inputFingerprints, 4096, 'live render-input originals').map((entry) => { nativeRecord(entry, ['sourceId', 'sha256'], 'live render-input original'); return Object.freeze({ sourceId: nativeBoundedText(entry.sourceId, 128, 'source id'), sha256: nativeDigest(entry.sha256, 'original') }); })); return Object.freeze({ control: Object.freeze({ liveRenderVersion: 1, planVersion: 14, planFingerprint: nativeDigest(value.planFingerprint, 'plan'), planPayload: value.planPayload, projectId: nativeBoundedText(value.projectId, 128, 'project id'), projectRevision: safeInteger(value.projectRevision), inputFingerprints, restartJobId: value.restartJobId === null ? null : opaqueId(value.restartJobId, 40), carrierByteLength: value.carrierByteLength, audio }), audio }); } function nativeLiveAudioReservation(value) { nativeRecord(value, ['role', 'byteLength'], 'live render-input audio reservation'); if (value.role !== 'staged-audio-mix' || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > 16 * 1024 ** 4) throw new TypeError('Invalid Framescaper live audio reservation'); return Object.freeze({ role: value.role, byteLength: value.byteLength }); } function nativeLiveRole(value) { if (!['evaluated-rgba-frame-pack', 'staged-audio-mix'].includes(value)) throw new TypeError('Invalid Framescaper live input role'); return value; } function nativeLiveRenderInputAdmission(value, request) { nativeRecord(value, ['liveRenderVersion', 'stageId', 'carrierByteLength', 'scratchByteLength', 'streams'], 'live render-input admission'); const expected = request.audio === null ? [{ role: 'evaluated-rgba-frame-pack', byteLength: request.control.carrierByteLength }] : [{ role: 'evaluated-rgba-frame-pack', byteLength: request.control.carrierByteLength }, request.audio]; const expectedScratch = expected.reduce((sum, row) => safeInteger(sum + row.byteLength), 64 * 1024); if (value.liveRenderVersion !== 1 || value.carrierByteLength !== request.control.carrierByteLength || value.scratchByteLength !== expectedScratch || !Array.isArray(value.streams) || JSON.stringify(value.streams) !== JSON.stringify(expected)) throw new TypeError('Invalid Framescaper live render-input admission'); return Object.freeze({ stageId: opaqueId(value.stageId, 40), carrierByteLength: value.carrierByteLength, scratchByteLength: value.scratchByteLength, streams: Object.freeze(expected) }); } async function writeNativeLiveRenderInput(value) { nativeRecord(value, ['stageId', 'role', 'sequence', 'offset', 'bytes'], 'live render-input chunk'); const bytes = binary(value.bytes); if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw new RangeError('Invalid Framescaper live render-input chunk length'); const request = Object.freeze({ stageId: opaqueId(value.stageId, 40), role: nativeLiveRole(value.role), sequence: safeInteger(value.sequence), offset: safeInteger(value.offset), bytes }); const result = await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputWriteLive, request); nativeRecord(result, ['sequence', 'receivedBytes'], 'live render-input acknowledgement'); if (result.sequence !== request.sequence || result.receivedBytes !== request.offset + bytes.byteLength) throw new Error('Invalid Framescaper live render-input acknowledgement'); return Object.freeze({ sequence: result.sequence, receivedBytes: result.receivedBytes }); } async function completeNativeLiveRenderInput(value) { nativeRecord(value, ['stageId', 'role', 'byteLength', 'sha256'], 'live render-input completion'); const request = Object.freeze({ stageId: opaqueId(value.stageId, 40), role: nativeLiveRole(value.role), byteLength: safeInteger(value.byteLength), sha256: nativeDigest(value.sha256, 'live carrier') }); const result = await ipcRenderer.invoke(CHANNELS.framescaperNativeRenderInputCompleteLive, request); nativeRecord(result, ['byteLength', 'sha256'], 'live render-input completion result'); if (result.byteLength !== request.byteLength || result.sha256 !== request.sha256) throw new Error('Framescaper live render-input completion changed identity'); return Object.freeze({ byteLength: request.byteLength, sha256: request.sha256 }); } async function renderInputAbandonFailure(stageId) { try { await abandonNativeRenderInputs({ stageId }); return null; } catch (error) { return error; } } function nativeRenderInputStageRequest(value) { nativeRecord(value, ['stageVersion', 'planVersion', 'planFingerprint', 'planPayload', 'projectId', 'projectRevision', 'inputFingerprints', 'derivedInputs'], 'render-input stage request'); if (value.stageVersion !== 1 || ![7, 8, 14].includes(value.planVersion) || typeof value.planPayload !== 'string' || !value.planPayload.length || utf8Bytes(value.planPayload, 65536) > 65536) throw new TypeError('Invalid Framescaper V7/V8/V14 render-input plan'); const includesAudio = nativeSelectedRenderPlanIncludesAudio(value.planPayload, value.planVersion); const roles = value.planVersion === 7 || value.planVersion === 14 ? ['evaluated-rgba-frame-pack', ...(includesAudio ? ['staged-audio-mix'] : [])] : includesAudio ? ['staged-audio-mix'] : []; if (!roles.length) throw new TypeError('A silent Framescaper V8 plan has no derived-input stage'); const inputFingerprints = Object.freeze(nativeArray(value.inputFingerprints, 4096, 'render-input originals').map((entry) => { nativeRecord(entry, ['sourceId', 'sha256'], 'render-input original'); return Object.freeze({ sourceId: nativeBoundedText(entry.sourceId, 128, 'source id'), sha256: nativeDigest(entry.sha256, 'original') }); })); const inputs = Object.freeze(nativeArray(value.derivedInputs, 2, 'derived render inputs').map((entry, index) => nativeRenderInput(entry, index, roles[index]))); if (inputs.length !== roles.length) throw new TypeError('Invalid Framescaper derived-input role order'); return Object.freeze({ control: Object.freeze({ stageVersion: 1, planVersion: value.planVersion, planFingerprint: nativeDigest(value.planFingerprint, 'plan'), planPayload: value.planPayload, projectId: nativeBoundedText(value.projectId, 128, 'project id'), projectRevision: safeInteger(value.projectRevision), inputFingerprints, derivedInputs: Object.freeze(inputs.map(({ role, byteLength, sha256 }) => Object.freeze({ role, byteLength, sha256 }))) }), inputs }); }
function nativeRenderInput(value, index, role) { nativeRecord(value, ['role', 'byteLength', 'sha256', 'bytes'], `derived render input ${String(index)}`); if (value.role !== role || !['evaluated-rgba-frame-pack', 'staged-audio-mix'].includes(role) || typeof Blob !== 'function' || !(value.bytes instanceof Blob)) throw new TypeError('Invalid Framescaper derived render input'); const size = Reflect.apply(Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get, value.bytes, []); if (!Number.isSafeInteger(size) || size < 1 || size !== value.byteLength || size > 16 * 1024 ** 3) throw new RangeError('Invalid Framescaper derived render input length'); return Object.freeze({ role, byteLength: size, sha256: nativeDigest(value.sha256, 'derived input'), bytes: Blob.prototype.slice.call(value.bytes, 0, size) }); } function nativeSelectedRenderPlanIncludesAudio(payload, version) { let plan; try { plan = JSON.parse(payload); } catch { throw new TypeError('Invalid Framescaper render-input plan JSON'); } if (!plan || typeof plan !== 'object' || plan.version !== version) throw new TypeError('Invalid Framescaper render-input plan identity'); if (version === 14) { if (!plan.output || typeof plan.output !== 'object' || typeof plan.output.includeAudio !== 'boolean') throw new TypeError('Invalid Framescaper V14 audio authority'); return plan.output.includeAudio; } if (version === 8 && !Array.isArray(plan.inputs)) throw new TypeError('Invalid Framescaper V8 render-input plan identity'); const inputs = Array.isArray(plan.inputs) ? plan.inputs : []; const count = inputs.filter((input) => input && typeof input === 'object' && input.kind === 'staged-audio-mix').length; if (count > 1) throw new TypeError('Invalid Framescaper staged-audio plan inventory'); return count === 1; } function nativeRenderInputAdmission(value, inputs) { nativeRecord(value, ['stageVersion', 'stageId', 'inputs'], 'render-input admission'); const stageId = opaqueId(value.stageId, 40); if (value.stageVersion !== 1 || !Array.isArray(value.inputs) || value.inputs.length !== inputs.length) throw new TypeError('Invalid Framescaper render-input admission'); return Object.freeze({ stageId, inputs: Object.freeze(value.inputs.map((entry, index) => { nativeRecord(entry, ['inputIndex', 'role', 'binding'], 'render-input stream admission'); if (entry.inputIndex !== index || entry.role !== inputs[index].role) throw new TypeError('Invalid Framescaper render-input stream order'); return Object.freeze({ inputIndex: index, role: entry.role, binding: nativeRenderInputBinding(entry.binding) }); })) }); } function nativeRenderInputBinding(value) { nativeRecord(value, ['dataPlaneVersion', 'transport', 'streamId', 'direction', 'byteLength', 'sha256', 'maximumChunkBytes', 'maximumInFlightChunks'], 'render-input data-plane binding'); if (value.dataPlaneVersion !== 1 || value.transport !== 'message-port' || value.direction !== 'host-to-helper' || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || !Number.isSafeInteger(value.maximumChunkBytes) || value.maximumChunkBytes < 1 || value.maximumChunkBytes > 16 * 1024 * 1024 || value.maximumInFlightChunks !== 1) throw new TypeError('Invalid Framescaper render-input data-plane binding'); return Object.freeze({ ...value, streamId: opaqueId(value.streamId, 40), sha256: nativeDigest(value.sha256, 'stream') }); } async function transferNativeRenderInput(stageId, inputIndex, binding, blob) { if (binding.byteLength !== blob.size) throw new Error('Framescaper render-input bytes changed after admission'); const channel = new MessageChannel(); const port = channel.port2; port.start(); try { ipcRenderer.postMessage(CHANNELS.framescaperNativeRenderInputPort, Object.freeze({ stageId, inputIndex, binding }), [channel.port1]); let offset = 0; let sequence = 0; while (offset < binding.byteLength) { const end = Math.min(binding.byteLength, offset + binding.maximumChunkBytes); const bytes = new Uint8Array(await Blob.prototype.slice.call(blob, offset, end).arrayBuffer()); const ack = await nativeRenderInputPortReply(port, Object.freeze({ dataPlaneVersion: 1, type: 'chunk', streamId: binding.streamId, sequence, offset, bytes }), [bytes.buffer]); nativeRecord(ack, ['dataPlaneVersion', 'type', 'streamId', 'sequence', 'receivedBytes'], 'render-input acknowledgement'); if (ack.dataPlaneVersion !== 1 || ack.type !== 'ack' || ack.streamId !== binding.streamId || ack.sequence !== sequence || ack.receivedBytes !== end) throw new Error('Invalid Framescaper render-input acknowledgement'); offset = end; sequence += 1; } port.postMessage(Object.freeze({ dataPlaneVersion: 1, type: 'complete', streamId: binding.streamId, byteLength: binding.byteLength, sha256: binding.sha256 })); } finally { port.close(); } }
function nativeRenderInputPortReply(port, message, transfer) { return new Promise((resolve, reject) => { let settled = false; const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); port.onmessage = null; port.onmessageerror = null; if (error) reject(error); else resolve(value); }; const timeout = setTimeout(() => finish(new Error('Framescaper render-input transfer timed out')), 30000); port.onmessage = (event) => finish(null, event.data); port.onmessageerror = () => finish(new Error('Framescaper render-input MessagePort failed')); try { port.postMessage(message, transfer); } catch (error) { finish(error); } }); } function nativeQueueEnqueueRequest(value) { nativeRecord(value, ['taskKind', 'planVersion', 'derivedInputStageId', 'planFingerprint', 'planPayload', 'projectId', 'projectRevision', 'inputFingerprints', 'rootGrantId', 'relativeDestination', 'reservations', 'recoveryClass'], 'native queue enqueue request');
	if (!['encoded-export', 'image-sequence-export', 'proxy-generation'].includes(value.taskKind) || ![7, 8, 9, 10, 11, 12, 14].includes(value.planVersion) || typeof value.planPayload !== 'string' || !value.planPayload.length || utf8Bytes(value.planPayload, 65536) > 65536 || !['atomic-restart', 'verified-frame-checkpoint'].includes(value.recoveryClass)) throw new TypeError('Invalid Framescaper native queue enqueue plan');
	const inputFingerprints = Object.freeze(nativeArray(value.inputFingerprints, 4096, 'queue input fingerprints').map((entry) => { nativeRecord(entry, ['sourceId', 'sha256'], 'queue input fingerprint'); return Object.freeze({ sourceId: nativeBoundedText(entry.sourceId, 128, 'source id'), sha256: nativeDigest(entry.sha256, 'input') }); })); const reservations = value.reservations; nativeRecord(reservations, ['cpuCores', 'processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes', 'hardwareBackend'], 'queue reservations');
	const derivedInputStageId = value.derivedInputStageId === null ? null : opaqueId(value.derivedInputStageId, 40); if (value.taskKind === 'proxy-generation') { if (value.planVersion !== 14 || derivedInputStageId !== null) throw new TypeError('Selected V14 proxy generation cannot name a derived-input stage'); } else if (value.planVersion >= 9 && value.planVersion !== 14) { if (derivedInputStageId !== null) throw new TypeError(`Unified V${String(value.planVersion)} cannot name a derived-input stage`); } else if (value.planVersion !== 14) { if (![7, 8].includes(value.planVersion)) throw new TypeError('Invalid Framescaper native derived-input stage'); const stageRequired = value.planVersion === 7 || nativeSelectedRenderPlanIncludesAudio(value.planPayload, value.planVersion); if ((derivedInputStageId !== null) !== stageRequired) throw new TypeError(stageRequired ? `Invalid Framescaper native derived-input stage for selected V${String(value.planVersion)}` : 'Silent Framescaper V8 cannot name a derived-input stage'); } return Object.freeze({ taskKind: value.taskKind, planVersion: value.planVersion, derivedInputStageId, planFingerprint: nativeDigest(value.planFingerprint, 'plan'), planPayload: value.planPayload, projectId: nativeBoundedText(value.projectId, 128, 'project id'), projectRevision: safeInteger(value.projectRevision), inputFingerprints, rootGrantId: nativeIdentifier(value.rootGrantId, 'grant id'), relativeDestination: nativeRelativeDestination(value.relativeDestination), reservations: Object.freeze({ cpuCores: safeInteger(reservations.cpuCores), processTreeRssBytes: safeInteger(reservations.processTreeRssBytes), scratchBytes: safeInteger(reservations.scratchBytes), minimumFreeBytes: safeInteger(reservations.minimumFreeBytes), hardwareBackend: reservations.hardwareBackend === null ? null : nativeBoundedText(reservations.hardwareBackend, 128, 'hardware backend') }), recoveryClass: value.recoveryClass }); }
const NATIVE_SERVICE_PREFERENCES = ['native-media', 'hardware-decode', 'hardware-encode', 'ofx-consent']; function nativeServicePreferences(value) { const fields = ['nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled'];
	nativeRecord(value, fields, 'native-service preferences'); for (const key of fields) if (typeof value[key] !== 'boolean') throw new TypeError('Framescaper native-service preference must be boolean'); return Object.freeze({ ...value }); }
function nativePreferenceRequest(value) { nativeRecord(value, ['preference', 'enabled'], 'native-service preference request');
	if (!NATIVE_SERVICE_PREFERENCES.includes(value.preference) || typeof value.enabled !== 'boolean') throw new TypeError('Unsupported Framescaper native-service preference'); return Object.freeze({ preference: value.preference, enabled: value.enabled }); }
function nativeImageSequenceSelection(value) { nativeRecord(value, ['selectionId', 'files'], 'image-sequence selection'); const selectionId = nativeImageSequenceId(value.selectionId); const files = nativeArray(value.files, 1000000, 'image-sequence files'); if (!files.length || Reflect.ownKeys(files).length !== files.length + 1) throw new TypeError('Invalid Framescaper image-sequence file inventory'); const ids = new Set(); return Object.freeze({ selectionId, files: Object.freeze(files.map((file) => { nativeRecord(file, ['fileId', 'name', 'byteLength'], 'image-sequence file'); const fileId = nativeImageSequenceId(file.fileId); if (ids.has(fileId) || typeof file.name !== 'string' || !file.name.length || file.name.length > 512 || /[\\/\0]/u.test(file.name) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 512 * 1024 * 1024) throw new TypeError('Invalid pathless Framescaper image-sequence file'); ids.add(fileId); return Object.freeze({ fileId, name: file.name, byteLength: file.byteLength }); })) }); }
function nativeImageSequenceReadRequest(value) { nativeRecord(value, ['selectionId', 'fileId', 'offset', 'length'], 'image-sequence read request'); if (!Number.isSafeInteger(value.offset) || value.offset < 0 || !Number.isSafeInteger(value.length) || value.length < 1 || value.length > 16 * 1024 * 1024) throw new RangeError('Invalid Framescaper image-sequence range'); return Object.freeze({ selectionId: nativeImageSequenceId(value.selectionId), fileId: nativeImageSequenceId(value.fileId), offset: value.offset, length: value.length }); }
	function nativeImageSequenceReleaseRequest(value) { nativeRecord(value, ['selectionId'], 'image-sequence release request'); return Object.freeze({ selectionId: nativeImageSequenceId(value.selectionId) }); } function nativeImageSequenceId(value) { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) throw new TypeError('Invalid Framescaper image-sequence opaque id'); return value; } function nativeImageSequenceImportRequest(value) { const fields = { begin: ['operation', 'candidateGeneration', 'projectId', 'projectRevision'], 'prepare-write': ['operation', 'transactionId', 'asset', 'offset', 'binding'], 'await-write': ['operation', 'transactionId', 'asset', 'offset', 'streamId'], commit: ['operation', 'transactionId', 'asset', 'reference'], read: ['operation', 'transactionId', 'asset', 'offset', 'length'], admit: ['operation', 'transactionId', 'admission'], complete: ['operation', 'transactionId', 'sourceId', 'inventorySha256', 'sourcePackSha256'], discard: ['operation', 'transactionId'] }; if (!value || typeof value !== 'object' || typeof value.operation !== 'string' || !Object.hasOwn(fields, value.operation)) throw new TypeError('Invalid Framescaper image-sequence import operation'); nativeRecord(value, fields[value.operation], 'image-sequence import request'); const result = structuredClone(value); if (utf8Bytes(JSON.stringify(result), 65536) > 65536) throw new RangeError('Framescaper image-sequence import control exceeds 64 KiB'); return result; } function nativeImageSequenceImportReadRequest(value) { nativeRecord(value, ['transactionId', 'asset', 'offset', 'length'], 'image-sequence body read'); if (!['pack', 'inventory'].includes(value.asset) || !Number.isSafeInteger(value.offset) || value.offset < 0 || !Number.isSafeInteger(value.length) || value.length < 1 || value.length > 16 * 1024 * 1024) throw new RangeError('Invalid Framescaper image-sequence body range'); return Object.freeze({ transactionId: nativeImageSequenceId(value.transactionId), asset: value.asset, offset: value.offset, length: value.length }); } function nativeImageSequenceImportChunkRequest(value) { nativeRecord(value, ['transactionId', 'asset', 'offset', 'bytes'], 'image-sequence import chunk'); const bytes = binary(value.bytes); if (!['pack', 'inventory'].includes(value.asset) || !Number.isSafeInteger(value.offset) || value.offset < 0 || bytes.byteLength < 1 || bytes.byteLength > 16 * 1024 * 1024) throw new RangeError('Invalid Framescaper image-sequence import chunk'); return Object.freeze({ transactionId: nativeImageSequenceId(value.transactionId), asset: value.asset, offset: value.offset, bytes }); } async function transferNativeImageSequenceImportChunk(value) { const request = nativeImageSequenceImportChunkRequest(value); const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', request.bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join(''); const binding = Object.freeze({ dataPlaneVersion: 1, transport: 'message-port', streamId: digest.slice(0, 40), direction: 'host-to-helper', byteLength: request.bytes.byteLength, sha256: digest, maximumChunkBytes: 16 * 1024 * 1024, maximumInFlightChunks: 1 }); const control = Object.freeze({ transactionId: request.transactionId, asset: request.asset, offset: request.offset, binding }); await ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceImport, { operation: 'prepare-write', ...control }); const channel = new MessageChannel(); const port = channel.port2; port.start(); try { ipcRenderer.postMessage(CHANNELS.framescaperNativeImageSequenceImportPort, control, [channel.port1]); const bytes = request.bytes.slice(); const acknowledgement = await nativeRenderInputPortReply(port, Object.freeze({ dataPlaneVersion: 1, type: 'chunk', streamId: binding.streamId, sequence: 0, offset: 0, bytes }), [bytes.buffer]); nativeRecord(acknowledgement, ['dataPlaneVersion', 'type', 'streamId', 'sequence', 'receivedBytes'], 'image-sequence import acknowledgement'); if (acknowledgement.dataPlaneVersion !== 1 || acknowledgement.type !== 'ack' || acknowledgement.streamId !== binding.streamId || acknowledgement.sequence !== 0 || acknowledgement.receivedBytes !== binding.byteLength) throw new Error('Invalid Framescaper image-sequence import acknowledgement'); port.postMessage(Object.freeze({ dataPlaneVersion: 1, type: 'complete', streamId: binding.streamId, byteLength: binding.byteLength, sha256: digest })); return await ipcRenderer.invoke(CHANNELS.framescaperNativeImageSequenceImport, { operation: 'await-write', transactionId: request.transactionId, asset: request.asset, offset: request.offset, streamId: binding.streamId }); } finally { port.close(); } } function nativeProxyOutputJobRequest(value) { nativeRecord(value, ['jobId'], 'proxy-output job request'); return Object.freeze({ jobId: opaqueId(value.jobId, 40) }); } function nativeProxyOutputClaimRequest(value) { nativeRecord(value, ['claimId'], 'proxy-output claim request'); return Object.freeze({ claimId: opaqueId(value.claimId, 40) }); } function nativeProxyOutputReadRequest(value) { nativeRecord(value, ['claimId', 'offset', 'length'], 'proxy-output read request'); if (!Number.isSafeInteger(value.offset) || value.offset < 0 || !Number.isSafeInteger(value.length) || value.length < 1 || value.length > 1024 * 1024) throw new RangeError('Invalid Framescaper proxy-output range'); return Object.freeze({ claimId: opaqueId(value.claimId, 40), offset: value.offset, length: value.length }); } function nativeProxyOutputClaim(value) { nativeRecord(value, ['claimId', 'byteLength', 'sha256', 'mimeType'], 'proxy-output claim'); if (value.mimeType !== 'video/quicktime') throw new TypeError('Invalid Framescaper proxy-output MIME type'); return Object.freeze({ claimId: opaqueId(value.claimId, 40), byteLength: safeInteger(value.byteLength), sha256: nativeDigest(value.sha256, 'proxy output'), mimeType: value.mimeType }); } const NATIVE_OPENFX_CONTEXTS = ['generator', 'filter', 'transition', 'paint', 'retimer', 'general']; const NATIVE_OPENFX_PARAMETER_TYPES = ['integer', 'integer2d', 'integer3d', 'double', 'double2d', 'double3d', 'rgb', 'rgba', 'boolean', 'choice', 'string', 'group', 'page', 'pushbutton', 'parametric', 'custom'];
function nativeOpenFxProjection(value) { nativeRecord(value, ['pluginHandle', 'pluginId', 'vendor', 'version', 'binarySha256', 'supportedContexts', 'parameters', 'components', 'pixelDepths', 'threading', 'state', 'quarantined'], 'OpenFX plug-in projection'); nativeRecord(value.version, ['major', 'minor'], 'OpenFX plug-in version'); const contexts = nativeArray(value.supportedContexts, 6, 'OpenFX contexts').map((entry) => { const context = nativeBoundedText(entry, 16, 'OpenFX context'); if (!NATIVE_OPENFX_CONTEXTS.includes(context)) throw new TypeError('Invalid OpenFX context'); return context; }); const parameters = nativeArray(value.parameters, 4096, 'OpenFX parameters').map((parameter) => { nativeRecord(parameter, ['name', 'type', 'animates'], 'OpenFX parameter'); if (!NATIVE_OPENFX_PARAMETER_TYPES.includes(parameter.type) || typeof parameter.animates !== 'boolean') throw new TypeError('Invalid OpenFX parameter'); return Object.freeze({ name: nativeBoundedText(parameter.name, 64, 'OpenFX parameter name'), type: parameter.type, animates: parameter.animates }); }); if (!Number.isSafeInteger(value.version.major) || value.version.major < 0 || !Number.isSafeInteger(value.version.minor) || value.version.minor < 0 || !['unsafe', 'instance-safe', 'fully-safe'].includes(value.threading) || !['discovered', 'consented', 'enabled', 'revoked', 'quarantined'].includes(value.state) || typeof value.quarantined !== 'boolean') throw new TypeError('Invalid OpenFX plug-in projection'); const components = nativeArray(value.components, 3, 'OpenFX components').map((entry) => { if (!['RGBA', 'RGB', 'Alpha'].includes(entry)) throw new TypeError('Invalid OpenFX component'); return entry; }); const pixelDepths = nativeArray(value.pixelDepths, 3, 'OpenFX pixel depths').map((entry) => { if (!['byte', 'short', 'float'].includes(entry)) throw new TypeError('Invalid OpenFX pixel depth'); return entry; }); return Object.freeze({ pluginHandle: opaqueId(value.pluginHandle, 40), pluginId: nativeBoundedText(value.pluginId, 128, 'OpenFX plug-in id'), vendor: value.vendor === null ? null : nativeBoundedText(value.vendor, 128, 'OpenFX vendor'), version: Object.freeze({ major: value.version.major, minor: value.version.minor }), binarySha256: nativeDigest(value.binarySha256, 'OpenFX binary'), supportedContexts: Object.freeze(contexts), parameters: Object.freeze(parameters), components: Object.freeze(components), pixelDepths: Object.freeze(pixelDepths), threading: value.threading, state: value.state, quarantined: value.quarantined }); } function nativeOpenFxInventory(value) { return Object.freeze(nativeArray(value, 1024, 'OpenFX inventory').map(nativeOpenFxProjection)); } function nativeOpenFxControlRequest(value) { nativeRecord(value, ['pluginHandle', 'action'], 'OpenFX control request'); if (!['enable', 'revoke', 'clear-quarantine'].includes(value.action)) throw new TypeError('Invalid OpenFX control action'); return Object.freeze({ pluginHandle: opaqueId(value.pluginHandle, 40), action: value.action }); } function nativeOpenFxFrameOffer(value) { nativeRecord(value, ['protocolVersion', 'sessionId'], 'OpenFX frame offer'); if (value.protocolVersion !== 1) throw new TypeError('Invalid OpenFX frame protocol'); return Object.freeze({ protocolVersion: 1, sessionId: opaqueId(value.sessionId, 40) }); }
function nativeOpenFxInteractRequest(value) { nativeRecord(value, ['protocolVersion', 'pluginHandle', 'context', 'target', 'parameterName', 'events'], 'OpenFX Interact request'); if (value.protocolVersion !== 1 || !NATIVE_OPENFX_CONTEXTS.includes(value.context) || !['overlay', 'custom-parameter'].includes(value.target) || (value.target === 'overlay' ? value.parameterName !== null : typeof value.parameterName !== 'string' || !/^[A-Za-z_][A-Za-z\d_]{0,63}$/u.test(value.parameterName))) throw new TypeError('Invalid OpenFX Interact request'); const events = nativeArray(value.events, 256, 'OpenFX Interact events'); if (Reflect.ownKeys(events).length !== events.length + 1) throw new TypeError('Invalid OpenFX Interact event array'); let previous = -1; const admitted = events.map((event) => { nativeRecord(event, event?.kind === 'pointer' ? ['kind', 'phase', 'sequence', 'x', 'y', 'button', 'modifiers'] : event?.kind === 'keyboard' ? ['kind', 'phase', 'sequence', 'key', 'code', 'modifiers'] : ['kind', 'sequence', 'focused'], 'OpenFX Interact event'); if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || event.sequence <= previous) throw new TypeError('Invalid OpenFX Interact sequence'); previous = event.sequence; if (event.kind === 'focus') { if (typeof event.focused !== 'boolean') throw new TypeError('Invalid OpenFX focus event'); return Object.freeze({ kind: 'focus', sequence: event.sequence, focused: event.focused }); } const modifiers = nativeArray(event.modifiers, 4, 'OpenFX Interact modifiers').map((entry) => nativeBoundedText(entry, 7, 'OpenFX modifier')); if (Reflect.ownKeys(event.modifiers).length !== event.modifiers.length + 1 || modifiers.some((entry, index) => !['alt', 'control', 'meta', 'shift'].includes(entry) || (index > 0 && entry <= modifiers[index - 1]))) throw new TypeError('Invalid OpenFX modifiers'); if (event.kind === 'pointer') { if (!['motion', 'down', 'up'].includes(event.phase) || !Number.isFinite(event.x) || event.x < 0 || event.x > 1 || !Number.isFinite(event.y) || event.y < 0 || event.y > 1 || !Number.isSafeInteger(event.button) || event.button < 0 || event.button > 7) throw new TypeError('Invalid OpenFX pointer event'); return Object.freeze({ kind: 'pointer', phase: event.phase, sequence: event.sequence, x: event.x, y: event.y, button: event.button, modifiers: Object.freeze(modifiers) }); } if (event.kind !== 'keyboard' || !['down', 'up'].includes(event.phase)) throw new TypeError('Invalid OpenFX keyboard event'); return Object.freeze({ kind: 'keyboard', phase: event.phase, sequence: event.sequence, key: nativeBoundedText(event.key, 64, 'OpenFX key'), code: nativeBoundedText(event.code, 64, 'OpenFX code'), modifiers: Object.freeze(modifiers) }); }); return Object.freeze({ protocolVersion: 1, pluginHandle: opaqueId(value.pluginHandle, 40), context: value.context, target: value.target, parameterName: value.parameterName, events: Object.freeze(admitted) }); }
function nativeOpenFxInteractResult(value, request) { nativeRecord(value, ['protocolVersion', 'width', 'height', 'rowBytes', 'target', 'parameterName', 'acceptedSequences', 'redrawRequested', 'rgba'], 'OpenFX Interact result'); const sequences = nativeArray(value.acceptedSequences, 256, 'OpenFX accepted sequences'); const requested = new Set(request.events.map((event) => event.sequence)); if (value.protocolVersion !== 1 || value.width !== 64 || value.height !== 64 || value.rowBytes !== 256 || value.target !== request.target || value.parameterName !== request.parameterName || typeof value.redrawRequested !== 'boolean' || Reflect.ownKeys(sequences).length !== sequences.length + 1 || sequences.some((sequence, index) => !Number.isSafeInteger(sequence) || sequence < 0 || (index > 0 && sequence <= sequences[index - 1]) || !requested.has(sequence))) throw new TypeError('Invalid OpenFX Interact result'); const rgba = binary(value.rgba); if (rgba.byteLength !== 64 * 64 * 4) throw new TypeError('Invalid OpenFX Interact RGBA surface'); return Object.freeze({ protocolVersion: 1, width: 64, height: 64, rowBytes: 256, target: value.target, parameterName: value.parameterName, acceptedSequences: Object.freeze([...sequences]), redrawRequested: value.redrawRequested, rgba }); }
function nativeOpenFxParameter(value, label = 'OpenFX parameter state') { nativeRecord(value, ['name', 'type', 'value', 'keyframes'], label); const name = nativeBoundedText(value.name, 64, 'OpenFX parameter name'); if (!/^[A-Za-z_][A-Za-z\d_]{0,63}$/u.test(name) || !NATIVE_OPENFX_PARAMETER_TYPES.includes(value.type)) throw new TypeError(`Invalid ${label}`); const valueless = ['group', 'page', 'pushbutton'].includes(value.type), counts = { double: 1, integer2d: 2, double2d: 2, integer3d: 3, double3d: 3, rgb: 3, rgba: 4 }; if (valueless ? value.value !== null : value.type === 'boolean' ? typeof value.value !== 'boolean' : ['integer', 'choice'].includes(value.type) ? !Number.isSafeInteger(value.value) : ['string', 'custom'].includes(value.type) ? typeof value.value !== 'string' || utf8Bytes(value.value, value.type === 'custom' ? 65536 : 4096) > (value.type === 'custom' ? 65536 : 4096) : value.type === 'parametric' ? !Array.isArray(value.value) || value.value.length > 8192 || Reflect.ownKeys(value.value).length !== value.value.length + 1 || value.value.some((point) => !Array.isArray(point) || point.length !== 2 || Reflect.ownKeys(point).length !== 3 || point.some((item) => typeof item !== 'number' || !Number.isFinite(item))) : !Array.isArray(value.value) || value.value.length !== counts[value.type] || Reflect.ownKeys(value.value).length !== value.value.length + 1 || value.value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new TypeError(`Invalid ${label} value`); const keyframes = nativeArray(value.keyframes, 8192, 'OpenFX keyframes'); if (Reflect.ownKeys(keyframes).length !== keyframes.length + 1 || valueless && keyframes.length) throw new TypeError(`Invalid ${label} keyframes`); let previous = -1; for (const keyframe of keyframes) { nativeRecord(keyframe, ['frame', 'value'], 'OpenFX keyframe'); if (!Number.isSafeInteger(keyframe.frame) || keyframe.frame < 0 || keyframe.frame <= previous || typeof keyframe.value !== 'number' || !Number.isFinite(keyframe.value)) throw new TypeError('Invalid OpenFX keyframe'); previous = keyframe.frame; } return nativeDeepFreeze(structuredClone(value)); }
function nativeOpenFxEffect(value) { nativeRecord(value, ['schemaVersion', 'instanceId', 'pluginId', 'binarySha256', 'context', 'attachment', 'inputs', 'parameters', 'customEncodings', 'enabled', 'freshness', 'frozenFallback'], 'authored OpenFX effect'); const id = (entry, label) => { if (typeof entry !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u.test(entry)) throw new TypeError(`Invalid authored OpenFX ${label}`); return entry; }, freshness = (entry, label) => { nativeRecord(entry, ['authoredStateSha256', 'inputIdentitiesSha256', 'renderPlanFingerprintSha256', 'nativeEffectFingerprintSha256'], label); for (const digest of Object.values(entry)) nativeDigest(digest, label); }; if (value.schemaVersion !== 1 || !NATIVE_OPENFX_CONTEXTS.includes(value.context) || typeof value.enabled !== 'boolean') throw new TypeError('Invalid authored OpenFX effect'); id(value.instanceId, 'instance'); id(value.pluginId, 'plug-in'); nativeDigest(value.binarySha256, 'OpenFX binary'); nativeRecord(value.attachment, ['kind', 'targetId'], 'authored OpenFX attachment'); if (value.attachment.kind !== value.context) throw new TypeError('Invalid authored OpenFX attachment'); id(value.attachment.targetId, 'attachment target'); const inputs = nativeArray(value.inputs, 16, 'OpenFX inputs'), inputNames = new Set(); if (Reflect.ownKeys(inputs).length !== inputs.length + 1) throw new TypeError('Invalid authored OpenFX inputs'); for (const input of inputs) { nativeRecord(input, ['name', 'sourceRef'], 'authored OpenFX input'); const name = nativeBoundedText(input.name, 64, 'OpenFX input name'); if (!/^[A-Za-z_][A-Za-z\d_]{0,63}$/u.test(name) || inputNames.has(name)) throw new TypeError('Invalid authored OpenFX input'); inputNames.add(name); id(input.sourceRef, 'input reference'); } const parameters = nativeArray(value.parameters, 4096, 'OpenFX parameters'), parameterTypes = new Map(); if (Reflect.ownKeys(parameters).length !== parameters.length + 1) throw new TypeError('Invalid authored OpenFX parameters'); for (const parameter of parameters) { const admitted = nativeOpenFxParameter(parameter); if (parameterTypes.has(admitted.name)) throw new TypeError('Duplicate authored OpenFX parameter'); parameterTypes.set(admitted.name, admitted.type); } nativeRecord(value.customEncodings, Object.keys(value.customEncodings ?? {}), 'OpenFX custom encodings'); let encodingBytes = 0; for (const [name, encoding] of Object.entries(value.customEncodings)) { if (parameterTypes.get(name) !== 'custom' || typeof encoding !== 'string' || (encodingBytes += utf8Bytes(encoding, 65536)) > 65536) throw new TypeError('Invalid OpenFX custom encoding'); } freshness(value.freshness, 'OpenFX freshness'); if (value.frozenFallback !== null) { nativeRecord(value.frozenFallback, ['externalMediaSourceId', 'renderedAssetSha256', 'frameCount', 'freshness'], 'OpenFX frozen fallback'); id(value.frozenFallback.externalMediaSourceId, 'frozen source'); nativeDigest(value.frozenFallback.renderedAssetSha256, 'frozen render'); if (!Number.isSafeInteger(value.frozenFallback.frameCount) || value.frozenFallback.frameCount < 1) throw new TypeError('Invalid OpenFX frozen fallback'); freshness(value.frozenFallback.freshness, 'OpenFX frozen freshness'); } return nativeDeepFreeze(structuredClone(value)); }
function nativeOpenFxAuthoredInteractRequest(value) { nativeRecord(value, ['protocolVersion', 'project', 'pluginHandle', 'effect', 'effectStateSha256', 'context', 'target', 'parameterName', 'events'], 'authored OpenFX Interact request'); nativeRecord(value.project, ['id', 'revision'], 'OpenFX Interact project'); if (typeof value.project.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u.test(value.project.id) || !Number.isSafeInteger(value.project.revision) || value.project.revision < 0) throw new TypeError('Invalid OpenFX Interact project'); const effect = nativeOpenFxEffect(value.effect), action = nativeOpenFxInteractRequest({ protocolVersion: value.protocolVersion, pluginHandle: value.pluginHandle, context: value.context, target: value.target, parameterName: value.parameterName, events: value.events }); if (nativeDigest(value.effectStateSha256, 'OpenFX effect state') !== value.effectStateSha256 || action.context !== effect.context || action.target === 'custom-parameter' && !effect.parameters.some((parameter) => parameter.name === action.parameterName && parameter.type === 'custom')) throw new TypeError('Invalid authored OpenFX Interact authority'); return nativeDeepFreeze({ protocolVersion: 1, project: structuredClone(value.project), pluginHandle: action.pluginHandle, effect, effectStateSha256: value.effectStateSha256, context: action.context, target: action.target, parameterName: action.parameterName, events: action.events }); }
function nativeOpenFxAuthoredInteractResult(value, request) { nativeRecord(value, ['protocolVersion', 'project', 'instanceId', 'effectStateSha256', 'width', 'height', 'rowBytes', 'target', 'parameterName', 'acceptedSequences', 'redrawRequested', 'surfaceDisposition', 'parameterMutations', 'rgba'], 'authored OpenFX Interact result'); const base = nativeOpenFxInteractResult({ protocolVersion: value.protocolVersion, width: value.width, height: value.height, rowBytes: value.rowBytes, target: value.target, parameterName: value.parameterName, acceptedSequences: value.acceptedSequences, redrawRequested: value.redrawRequested, rgba: value.rgba }, request); nativeRecord(value.project, ['id', 'revision'], 'OpenFX Interact result project'); if (value.project.id !== request.project.id || value.project.revision !== request.project.revision || value.instanceId !== request.effect.instanceId || value.effectStateSha256 !== request.effectStateSha256 || !['drawn', 'retained'].includes(value.surfaceDisposition)) throw new TypeError('Invalid OpenFX Interact result authority'); const mutations = nativeArray(value.parameterMutations, 4096, 'OpenFX parameter mutations'), names = new Set(); if (Reflect.ownKeys(mutations).length !== mutations.length + 1) throw new TypeError('Invalid OpenFX Interact mutations'); const admitted = mutations.map((mutation) => { nativeRecord(mutation, ['parameter'], 'OpenFX parameter mutation'); const parameter = nativeOpenFxParameter(mutation.parameter, 'OpenFX parameter mutation'); const authored = request.effect.parameters.find((candidate) => candidate.name === parameter.name); if (!authored || authored.type !== parameter.type || names.has(parameter.name) || request.context === 'retimer' && parameter.name === 'SourceTime' || request.context === 'transition' && parameter.name === 'Transition') throw new TypeError('Invalid OpenFX Interact parameter mutation authority'); names.add(parameter.name); return nativeDeepFreeze({ parameter }); }); if (value.surfaceDisposition === 'retained' && base.rgba.some((byte) => byte !== 0)) throw new TypeError('Invalid retained OpenFX Interact surface'); return nativeDeepFreeze({ protocolVersion: 1, project: structuredClone(value.project), instanceId: value.instanceId, effectStateSha256: value.effectStateSha256, width: 64, height: 64, rowBytes: 256, target: base.target, parameterName: base.parameterName, acceptedSequences: base.acceptedSequences, redrawRequested: base.redrawRequested, surfaceDisposition: value.surfaceDisposition, parameterMutations: admitted, rgba: base.rgba }); }
function nativeDeepFreeze(value) { if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) { for (const child of Object.values(value)) nativeDeepFreeze(child); Object.freeze(value); } return value; }
function nativeRecord(value, fields, label) { const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : []; if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) throw new TypeError(`Invalid ${label} fields`); return value; }
function nativeArray(value, maximum, label) { if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`Invalid Framescaper native ${label}`); return value; }
function nativeTierControls(value) { return Object.freeze({ probeHelperEnabled: value?.probeHelperEnabled === true, probeHelperQuarantined: value?.probeHelperQuarantined === true, audioHelperEnabled: value?.audioHelperEnabled === true, audioHelperQuarantined: value?.audioHelperQuarantined === true, nativeEffectDiscoveryEnabled: value?.nativeEffectDiscoveryEnabled === true }); }
function nativeTierControlRequest(value) { const action = text(value?.action, 48); const setters = ['set-probe-helper-enabled', 'set-audio-helper-enabled', 'set-native-effect-discovery-enabled']; const clears = ['clear-probe-helper-quarantine', 'clear-audio-helper-quarantine']; if (!setters.includes(action) && !clears.includes(action)) throw new TypeError('Unsupported native-tier control action'); if (setters.includes(action) && typeof value?.enabled !== 'boolean') throw new TypeError('Native-tier enabled value must be a boolean'); return Object.freeze(setters.includes(action) ? { action, enabled: value.enabled } : { action }); }
function connectFramescaperProjectLibrary() { if (framescaperProjectState === 'admitted') return Promise.resolve(FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE); if (framescaperProjectState === 'refused') return Promise.reject(new Error('Framescaper project-library handshake was refused')); framescaperProjectConnection ??= ipcRenderer.invoke(CHANNELS.framescaperProjectHandshake, FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE).then((value) => { try { const admitted = framescaperProjectHandshake(value); framescaperProjectState = 'admitted'; return admitted; } catch (cause) { framescaperProjectState = 'refused'; throw new TypeError('Framescaper project-library handshake was refused', { cause }); } }, (cause) => { framescaperProjectState = 'refused'; throw new TypeError('Framescaper project-library handshake was refused', { cause }); }); return framescaperProjectConnection; }
function invokeFramescaperProject(channel, value) { if (framescaperProjectState !== 'admitted') return Promise.reject(new Error(`Framescaper project-library handshake ${framescaperProjectState === 'refused' ? 'was refused' : 'is required'}`)); return ipcRenderer.invoke(channel, value); }
function framescaperProjectHandshake(value) { const fields = Object.keys(FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE); const candidate = framescaperProjectRecord(value, fields, 'handshake'); const normalized = Object.fromEntries(fields.map((field) => [field, candidate[field]])); if (JSON.stringify(normalized) !== JSON.stringify(FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE)) throw new TypeError('Framescaper project-library generation identity is unsupported'); return FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE; }
function beginFramescaperProjectPublication(value) { const request = framescaperProjectRecord(value, ['publicationId', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies'], 'publication begin'); const publicationId = framescaperProjectPublicationId(request.publicationId); if (framescaperProjectPublications.has(publicationId)) throw new Error('Framescaper project-library publication is already active'); const bodies = framescaperProjectArray(request.bodies, 4094, 'publication bodies').map((body) => structuredClone(body)); const normalized = Object.freeze({ publicationId, expectedMetadataRevision: framescaperProjectNonNegative(request.expectedMetadataRevision, 'metadata revision'), expectedProject: structuredClone(request.expectedProject), project: structuredClone(request.project), bodies: Object.freeze(bodies) }); return invokeFramescaperProject(CHANNELS.framescaperProjectBegin, normalized).then((result) => framescaperProjectAdmission(result, publicationId, bodies.length)); }
function framescaperProjectAdmission(value, publicationId, bodyCount) { const result = framescaperProjectRecord(value, ['publicationId', 'maximumChunkBytes', 'bodyCount'], 'publication admission'); if (result.publicationId !== publicationId || result.maximumChunkBytes !== MAX_CHUNK_BYTES || result.bodyCount !== bodyCount) throw new Error('Framescaper project-library publication admission changed'); framescaperProjectPublications.add(publicationId); return Object.freeze({ publicationId, maximumChunkBytes: MAX_CHUNK_BYTES, bodyCount }); }
function writeFramescaperProjectPublicationChunk(value) { const request = framescaperProjectRecord(value, ['publicationId', 'bodyIndex', 'offset', 'bytes'], 'publication chunk'); const bytes = framescaperProjectChunkResult(request.bytes); if (!bytes.byteLength) throw new RangeError('Framescaper project-library publication chunk is empty'); return invokeFramescaperProject(CHANNELS.framescaperProjectChunk, { publicationId: framescaperProjectActive(request.publicationId), bodyIndex: framescaperProjectNonNegative(request.bodyIndex, 'body index'), offset: framescaperProjectNonNegative(request.offset, 'body offset'), bytes }); }
function finishFramescaperProjectPublication(value, channel, booleanResult) { const request = framescaperProjectRecord(value, ['publicationId'], 'publication completion'); const publicationId = framescaperProjectActive(request.publicationId); return invokeFramescaperProject(channel, { publicationId }).then((result) => { if (booleanResult && typeof result !== 'boolean') throw new TypeError('Framescaper project-library abort acknowledgement is invalid'); framescaperProjectPublications.delete(publicationId); return result; }); }
function framescaperProjectChunkResult(value) { const bytes = binary(value); if (bytes.byteLength > MAX_CHUNK_BYTES) throw new RangeError('Framescaper project-library chunk exceeds its limit'); return bytes; }
function framescaperProjectActive(value) { const publicationId = framescaperProjectPublicationId(value); if (!framescaperProjectPublications.has(publicationId)) throw new Error('Framescaper project-library publication is not active'); return publicationId; }
function framescaperProjectPublicationId(value) { if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) throw new TypeError('Framescaper project-library publication id is invalid'); return value; }
function framescaperProjectId(value) { if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) throw new TypeError('Framescaper project id is invalid'); return value; }
function framescaperProjectNonNegative(value, label) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`Framescaper project-library ${label} is invalid`); return value; }
function framescaperProjectRecord(value, fields, label) { const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : []; if (keys.length !== fields.length || keys.some((key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return typeof key !== 'string' || !fields.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'); })) throw new TypeError(`Framescaper project-library ${label} has unsupported fields`); return value; }
function framescaperProjectArray(value, maximum, label) { if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`Framescaper project-library ${label} must be a bounded dense array`); return value; }
function strictBoolean(value, message = 'Desktop shared-project delete result must be a boolean') { if (typeof value !== 'boolean') throw new TypeError(message); return value; }
function finalPrefixAcknowledgement(value) { if (typeof value?.byteLength !== 'number') throw new TypeError('Desktop returned an invalid final-prefix acknowledgement');
	const byteLength = saveSize(value.byteLength); if (byteLength < FINAL_PREFIX_BYTES) throw new TypeError('Desktop returned an invalid final-prefix acknowledgement'); return Object.freeze({ byteLength }); }
function utf8Bytes(value, maximumBytes) { let bytes = 0; for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); if (code <= 0x7f) bytes += 1; else if (code <= 0x7ff) bytes += 2; else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; } else bytes += 3; if (bytes > maximumBytes) return bytes; } return bytes; }
function binary(value) { if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0)); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)); throw new TypeError('Expected binary data'); }
