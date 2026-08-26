import productConfig from './product.json' with { type: 'json' };

export const PRODUCT_ID = (process.env.SCAPE_PRODUCT || productConfig.id) === 'framescaper' ? 'framescaper' : 'soundscaper';
export const APP_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
export const APP_ID = PRODUCT_ID === 'framescaper' ? 'org.framescaper.desktop' : 'org.soundscaper.desktop';
export const APP_SCHEME = PRODUCT_ID === 'framescaper' ? 'framescaper-app' : 'soundscaper-app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const SESSION_PARTITION = PRODUCT_ID === 'framescaper' ? 'persist:framescaper-v1' : 'persist:soundscaper-v1';
export const UPDATE_TAG_PREFIX = PRODUCT_ID === 'framescaper' ? 'framescaper-v' : 'v';
export const SETTINGS_SCHEMA_VERSION = 1;

export const SUPPORTED_LOCALES = Object.freeze([
	'en',
	'de',
	'ar',
	'en-GB',
	'es',
	'fi',
	'fr',
	'gl',
	'hy',
	'ja',
	'ko',
	'pl',
	'ro',
	'ru',
	'tr',
	'uk',
	'zh-CN',
]);

export const READ_CAPABILITY_PREFIX = '/_desktop/read/';
export const READ_PROFILE_LINKED_AUDIO_RANGE_V1 = 'linked-audio-range-v1';
export const READ_PROFILE_LINKED_VIDEO_RANGE_V1 = 'linked-video-range-v1';
export const READ_PROFILE_MATERIALIZED_V1 = 'materialized-v1';
export const READ_PROFILE_SCAPE_RANGE_V1 = 'scape-range-v1';
export const SCAPE_PROJECT_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const RUNTIME_PREFIX = '/runtime/';
export const MAX_READ_CAPABILITIES_PER_OWNER = 128;
export const MAX_READ_CAPABILITY_BYTES_PER_OWNER = 512 * 1024 ** 2;
export const MAX_SCAPE_RANGE_READ_CAPABILITIES = 4;
export const MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES = 65 * 1024 ** 3;
export const MAX_LINKED_VIDEO_PLAYBACK_CAPABILITIES = 128;
export const MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_BYTES = 64 * 1024 ** 3;
export const MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES = 512 * 1024 ** 2;
export const MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES = 4 * 1024 ** 2;
export const MAX_LINKED_VIDEO_PLAYBACK_REQUESTS = 16;
export const MAX_SAVE_CHUNK_BYTES = 1024 * 1024;
export const MAX_AUDIO_PCM_SAVE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_SAVE_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_SAVE_TARGETS = 16;
export const MAX_SAVE_SESSIONS = 4;
export const MAX_DESKTOP_SAVE_BYTES = 65 * 1024 ** 3;
export const MAX_SAVE_ADMITTED_BYTES = MAX_DESKTOP_SAVE_BYTES;
export const MAX_SHARED_PROJECT_DOCUMENT_BYTES = 256 * 1024 ** 2;
export const MAX_SHARED_PROJECT_ID_BYTES = 4 * 1024;
export const MAX_SHARED_PROJECTS = 10_000;
export const MAX_SHARED_SOURCE_BYTES = 64 * 1024 ** 3;
export const MAX_SHARED_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_SHARED_SOURCE_READS = 4;
export const MAX_SHARED_SOURCES = 4_094;

export const IPC = Object.freeze({
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
	nativeAudioSessionOpen: 'soundscaper:v1:native-audio:session:open',
	nativeAudioSessionBind: 'soundscaper:v1:native-audio:session:bind',
	nativeAudioSessionStatus: 'soundscaper:v1:native-audio:session:status',
	nativeAudioSessionCalibrate: 'soundscaper:v1:native-audio:session:calibrate',
	nativeAudioSessionReport: 'soundscaper:v1:native-audio:session:report',
	nativeAudioSessionLoss: 'soundscaper:v1:native-audio:session:loss',
	nativeAudioSessionClose: 'soundscaper:v1:native-audio:session:close',
	nativeAudioRealtimePort: 'soundscaper:native-realtime-port',
	nativePluginAvailability: 'soundscaper:v1:helper:native-plugin-availability',
	nativePluginConsent: 'soundscaper:v1:helper:native-plugin-consent',
	nativePluginScan: 'soundscaper:v1:helper:native-plugin-scan',
	nativePluginInventory: 'soundscaper:v1:helper:native-plugin-inventory',
	nativePluginClearQuarantine: 'soundscaper:v1:helper:native-plugin-clear-quarantine',
	nativePluginReviewInstallation: 'soundscaper:v1:native-plugin:installation:review',
	nativePluginInstantiate: 'soundscaper:v1:native-plugin:instantiate',
	nativePluginRunOffline: 'soundscaper:v1:native-plugin:run-offline',
	nativePluginSetBypassed: 'soundscaper:v1:native-plugin:set-bypassed',
	nativePluginPersistState: 'soundscaper:v1:native-plugin:state:persist',
	nativePluginRestoreState: 'soundscaper:v1:native-plugin:state:restore',
	nativePluginOpenVendorUi: 'soundscaper:v1:native-plugin:vendor-ui:open',
	nativePluginCloseVendorUi: 'soundscaper:v1:native-plugin:vendor-ui:close',
	nativePluginCloseInstance: 'soundscaper:v1:native-plugin:instance:close',
	nativePluginRpcPort: 'soundscaper:native-plugin-rpc-port',
	nativeTierControls: 'soundscaper:v1:native-tier:controls',
	nativeTierApply: 'soundscaper:v1:native-tier:apply',
	framescaperNativeCapabilities: 'framescaper:v1:native-services:capabilities',
	framescaperNativeSnapshot: 'framescaper:v1:native-services:snapshot',
	framescaperNativeControl: 'framescaper:v1:native-services:queue:control',
	framescaperNativeReorder: 'framescaper:v1:native-services:queue:reorder',
	framescaperNativeRemove: 'framescaper:v1:native-services:queue:remove',
	framescaperNativeEnqueue: 'framescaper:v1:native-services:queue:enqueue',
	framescaperNativeSelectRoot: 'framescaper:v1:native-services:root:select',
	framescaperNativeReauthorizeQueueRoot: 'framescaper:v1:native-services:queue:reauthorize-root',
	framescaperNativeRevalidateRoot: 'framescaper:v1:native-services:root:revalidate',
	framescaperNativeRevokeRoot: 'framescaper:v1:native-services:root:revoke',
	framescaperNativeCreateWatch: 'framescaper:v1:native-services:watch:create',
	framescaperNativeSetWatchEnabled: 'framescaper:v1:native-services:watch:enabled',
	framescaperNativeRemoveWatch: 'framescaper:v1:native-services:watch:remove',
	framescaperNativeReconcileWatch: 'framescaper:v1:native-services:watch:reconcile',
	framescaperNativeClaimWatchImport: 'framescaper:v1:native-services:watch:claim',
	framescaperNativeCompleteWatchImport: 'framescaper:v1:native-services:watch:complete',
	framescaperNativeCleanupScratch: 'framescaper:v1:native-services:scratch:cleanup',
	framescaperNativeSettleScratch: 'framescaper:v1:native-services:scratch:settle',
	framescaperNativePublish: 'framescaper:v1:native-services:publication:publish',
	framescaperNativeCheckpoint: 'framescaper:v1:native-services:publication:checkpoint',
	framescaperNativeExternalDisplays: 'framescaper:v1:native-services:display:list',
	framescaperNativeSetExternalDisplay: 'framescaper:v1:native-services:display:set',
	framescaperNativeFramePort: 'framescaper:v1:native-services:display:frame-port',
	framescaperNativePreferences: 'framescaper:v1:native-services:preferences',
	framescaperNativeSetPreference: 'framescaper:v1:native-services:preferences:set',
	framescaperNativeRenderInputBegin: 'framescaper:v1:native-services:render-inputs:begin',
	framescaperNativeRenderInputPort: 'framescaper:v1:native-services:render-inputs:port',
	framescaperNativeRenderInputFinalize: 'framescaper:v1:native-services:render-inputs:finalize',
	framescaperNativeRenderInputAbandon: 'framescaper:v1:native-services:render-inputs:abandon',
	framescaperNativeRenderInputBeginLive: 'framescaper:v1:native-services:render-inputs:live:begin',
	framescaperNativeRenderInputWriteLive: 'framescaper:v1:native-services:render-inputs:live:write',
	framescaperNativeRenderInputCompleteLive: 'framescaper:v1:native-services:render-inputs:live:complete',
	framescaperNativeSelectImageSequence: 'framescaper:v1:native-services:image-sequence:select',
	framescaperNativeReadImageSequenceFile: 'framescaper:v1:native-services:image-sequence:read',
	framescaperNativeReleaseImageSequence: 'framescaper:v1:native-services:image-sequence:release',
	framescaperNativeImageSequenceImport: 'framescaper:v1:native-services:image-sequence:import',
	framescaperNativeImageSequenceImportPort: 'framescaper:v1:native-services:image-sequence:import-port',
	framescaperNativeImageSequenceDecode: 'framescaper:v1:native-services:image-sequence:decode',
	framescaperNativeClaimProxyOutput: 'framescaper:v1:native-services:proxy-output:claim',
	framescaperNativeReadProxyOutput: 'framescaper:v1:native-services:proxy-output:read',
	framescaperNativeReleaseProxyOutput: 'framescaper:v1:native-services:proxy-output:release',
	framescaperNativeOpenFxScan: 'framescaper:v1:native-services:openfx:scan',
	framescaperNativeOpenFxInventory: 'framescaper:v1:native-services:openfx:inventory',
	framescaperNativeOpenFxControl: 'framescaper:v1:native-services:openfx:control',
	framescaperNativeOpenFxFrame: 'framescaper:v1:native-services:openfx:frame-port',
	framescaperNativeOpenFxFrameOffer: 'framescaper:v1:native-services:openfx:frame-offer',
	framescaperNativeOpenFxInteract: 'framescaper:v1:native-services:openfx:interact',
	framescaperProjectHandshake: 'framescaper:v20:projects:handshake',
	framescaperProjectBundle: 'framescaper:v20:projects:bundle',
	framescaperProjectBodyRead: 'framescaper:v20:projects:bodies:read',
	framescaperProjectList: 'framescaper:v20:projects:list',
	framescaperProjectDelete: 'framescaper:v20:projects:delete',
	framescaperProjectDuplicate: 'framescaper:v20:projects:duplicate',
	framescaperProjectBegin: 'framescaper:v20:projects:publication:begin',
	framescaperProjectChunk: 'framescaper:v20:projects:publication:chunk',
	framescaperProjectFinish: 'framescaper:v20:projects:publication:finish',
	framescaperProjectAbort: 'framescaper:v20:projects:publication:abort',
	listAssistanceModels: 'soundscaper:v1:assistance:list',
	installAssistanceModel: 'soundscaper:v1:assistance:install',
	cancelAssistanceModelInstall: 'soundscaper:v1:assistance:install:cancel',
	installPreseededAssistanceModel: 'soundscaper:v1:assistance:install-preseeded',
	reconcileAssistanceModels: 'soundscaper:v1:assistance:reconcile',
	collectAssistanceModelGarbage: 'soundscaper:v1:assistance:garbage-collect',
	listAssistanceModelNotices: 'soundscaper:v1:assistance:notices',
	relocateAssistanceModels: 'soundscaper:v1:assistance:relocate',
	removeAssistanceModel: 'soundscaper:v1:assistance:remove',
	assistanceInstallProgress: 'soundscaper:v1:event:assistance-progress',
	assistanceOperationModels: 'soundscaper:v1:assistance:operation:models',
	assistanceOperationCreate: 'soundscaper:v1:assistance:operation:create',
	assistanceOperationStage: 'soundscaper:v1:assistance:operation:stage',
	assistanceOperationInputPort: 'soundscaper:v1:assistance:operation:input-port',
	assistanceOperationReserve: 'soundscaper:v1:assistance:operation:reserve',
	assistanceOperationRun: 'soundscaper:v1:assistance:operation:run',
	assistanceOperationCancel: 'soundscaper:v1:assistance:operation:cancel',
	assistanceOperationReadOutput: 'soundscaper:v1:assistance:operation:read-output',
	assistanceOperationOutputPort: 'soundscaper:v1:assistance:operation:output-port',
	assistanceOperationRelease: 'soundscaper:v1:assistance:operation:release',
	assistanceOperationProgress: 'soundscaper:v1:event:assistance-operation-progress',
	assistanceWorkflowCreate: 'soundscaper:v1:assistance:workflow:create',
	assistanceWorkflowRun: 'soundscaper:v1:assistance:workflow:run',
	assistanceWorkflowCancel: 'soundscaper:v1:assistance:workflow:cancel',
	assistanceWorkflowProgress: 'soundscaper:v1:event:assistance-workflow-progress',
	externalFfmpegStatus: 'soundscaper:v1:ffmpeg:status',
	externalFfmpegChoose: 'soundscaper:v1:ffmpeg:choose',
	externalFfmpegClear: 'soundscaper:v1:ffmpeg:clear',
	externalFfmpegRescan: 'soundscaper:v1:ffmpeg:rescan',
	externalFfmpegInstall: 'soundscaper:v1:ffmpeg:install',
	desktopAudioCodecExecute: 'soundscaper:v1:codecs:audio:execute',
	desktopAudioCodecCancel: 'soundscaper:v1:codecs:audio:cancel',
	desktopAudioCodecCapabilities: 'soundscaper:v1:codecs:audio:capabilities',
	desktopVideoCodecCapabilities: 'soundscaper:v1:codecs:video:capabilities',
	desktopVideoCodecBegin: 'soundscaper:v1:codecs:video:begin',
	desktopVideoCodecWrite: 'soundscaper:v1:codecs:video:write',
	desktopVideoCodecClose: 'soundscaper:v1:codecs:video:close',
	desktopVideoCodecExecute: 'soundscaper:v1:codecs:video:execute',
	desktopVideoCodecStat: 'soundscaper:v1:codecs:video:stat',
	desktopVideoCodecRead: 'soundscaper:v1:codecs:video:read',
	desktopVideoCodecDelete: 'soundscaper:v1:codecs:video:delete',
	desktopVideoCodecCancel: 'soundscaper:v1:codecs:video:cancel',
	setLocale: 'soundscaper:v1:locale:set',
	windowAction: 'soundscaper:v1:window:action',
	checkForUpdates: 'soundscaper:v1:updates:check',
	openExternal: 'soundscaper:v1:external:open',
	editText: 'soundscaper:v1:text:edit',
	rendererReady: 'soundscaper:v1:renderer:ready',
	respondToClose: 'soundscaper:v1:close:respond',
	openProject: 'soundscaper:v1:event:project-open',
	menuCommand: 'soundscaper:v1:event:menu-command',
	closeRequested: 'soundscaper:v1:event:close-requested',
	windowStateChanged: 'soundscaper:v1:event:window-state-changed',
});

export const EXTERNAL_DESTINATIONS = Object.freeze({
	homepage: PRODUCT_ID === 'framescaper' ? 'https://framescaper.org/' : 'https://soundscaper.org/',
	help: 'https://github.com/LeoWattenberg/Soundscaper#readme',
	manual: 'https://support.audacityteam.org/au4',
	tutorials: 'https://support.audacityteam.org/au4',
	support: `mailto:team@kw.media?subject=${APP_NAME}%20support`,
	source: 'https://github.com/LeoWattenberg/Soundscaper',
	releases: 'https://github.com/LeoWattenberg/Soundscaper/releases',
	issues: 'https://github.com/LeoWattenberg/Soundscaper/issues',
});

export const MENU_COMMANDS = Object.freeze([
	'project:open',
	'project:save',
	'project:save-as',
	'audio:export',
	'edit:undo',
	'edit:redo',
	'edit:cut',
	'edit:copy',
	'edit:paste',
	'edit:select-all',
	'preferences',
	'view:toggle-fullscreen',
]);
