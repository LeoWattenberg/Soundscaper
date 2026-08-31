/* SPDX-License-Identifier: AGPL-3.0-only */

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const COMMON_CONFIG_FILES = Object.freeze([
	'config/assistance-native-runtime-manifest.json',
	'config/assistance-runtime-family-supply-candidates.json',
	'config/local-model-catalog.json',
	'config/milestone-5-native-source-acquisitions.json',
	'config/native-addon-payload-manifest.json',
	'config/production-licensing-matrix.json',
]);

const PRODUCT_CONFIG_FILES = Object.freeze({
	soundscaper: Object.freeze([
		...COMMON_CONFIG_FILES,
		'config/soundscaper-professional-native-notices.json',
		'config/soundscaper-professional-native-payload-manifest.json',
	]),
	framescaper: Object.freeze([
		...COMMON_CONFIG_FILES,
		'config/framescaper-media-host-payload-manifest.json',
		'config/framescaper-openfx-host-payload-manifest.json',
		'config/soundscaper-professional-native-payload-manifest.json',
	]),
});

const SOUNDSCAPER_FORBIDDEN_PATH = /(?:^|\/)(?:src\/framescaper\/|[^/]*framescaper[^/]*|[^/]*(?:openfx|ofx)[^/]*|display-capture|helper-probe[^/]*|native-services[^/]*|native-media-helper-process|external-display[^/]*|assistance-(?:external-ffmpeg-(?:shot-runtime|video-materializer)|selected-video-authority|workflow-owned-video-highlight[^/]*)|framescaper-capture-sandbox-preload\.cjs|framescaper-web-vcr-sandbox-preload\.cjs)(?:\/|$|\.)/iu;
const SOUNDSCAPER_DEFERRED_VISUAL_PATH = /(?:^|\/)(?:(?:desktop\/)?(?:desktop-video[^/]*|external-ffmpeg-(?:shot|video)[^/]*|linked-video[^/]*|native-media[^/]*|video-timing[^/]*)|desktop\/assistance-[^/]*(?:frame|shot|video|visual)[^/]*|src\/common\/editor\/(?:assistance\/(?:owned-video|reframe|shot|visual-frame)[^/]*|commands\/video-[^/]*|frame-[^/]*|native-(?:external-display|media|ofx)[^/]*|sequence-frame[^/]*|video-(?:export|ffmpeg|keyframe-(?:encoder|execution|export|webcodecs)|webcodecs)[^/]*|web-vcr-[^/]*))(?:\/|$|\.)/iu;
const SOUNDSCAPER_FORBIDDEN_CONFIG = /(?:^|\/)config\/framescaper-(?:media|openfx)-host-payload-manifest\.json$/u;
const SOUNDSCAPER_FORBIDDEN_CONTENT = /(?:framescaperDesktop|framescaper:v1:(?:native-services|capture)|FRAMESCAPER_WEB_VCR_|framescaper-(?:capture|web-vcr)-sandbox-preload)/u;
const SOUNDSCAPER_SHARED_RUNTIME_EXCEPTIONS = new Set([
	'src/common/editor/native-media-plan-canonical-form.js',
	'src/common/editor/video-timing-asset-reference.js',
]);
const SOUNDSCAPER_SHARED_VIDEO_RUNTIME = /^src\/common\/editor\/video-[^/]+\.js$/u;
const SOUNDSCAPER_REPLACED_SOURCE_FILES = new Set([
	'desktop-smoke-configuration.js',
	'direct-wav-renderer-smoke.js',
	'direct-wav-smoke.js',
	'project-library-lease-smoke.js',
	'scape-open-smoke.js',
	'scape-reopen-smoke.js',
	'helper-registration.mjs',
	'soundscaper-delivery-restart-smoke.mjs',
	'soundscaper-professional-native-utility-smoke.mjs',
]);
const SOUNDSCAPER_RUNTIME_PACKAGE_IMPORTS = new Set(['#desktop-runtime/helper-contract']);

export function desktopProductConfigFiles(productIdValue, metadata = null) {
	const productId = desktopPackageProduct(productIdValue);
	return desktopLegacyNativeAddonIncluded(productId, metadata)
		? PRODUCT_CONFIG_FILES[productId]
		: Object.freeze(PRODUCT_CONFIG_FILES[productId].filter((path) => (
			path !== 'config/native-addon-payload-manifest.json'
		)));
}

export function desktopLegacyNativeAddonIncluded(productIdValue, metadata = null) {
	const productId = desktopPackageProduct(productIdValue);
	return productId !== 'soundscaper'
		|| metadata?.applicationVersionChannel !== 'stable'
		|| metadata?.releaseChannel !== 'stable';
}

export function desktopProductRuntimeFiles(productIdValue, filesValue) {
	const productId = desktopPackageProduct(productIdValue);
	const files = exactFileInventory(filesValue, 'compiled desktop runtime');
	if (productId === 'framescaper') return Object.freeze([...files]);
	return Object.freeze(files.filter((path) => !soundscaperForbiddenPackagePath(path)));
}

export function desktopProductRuntimePackageImports(productIdValue, importsValue) {
	const productId = desktopPackageProduct(productIdValue);
	if (!importsValue || typeof importsValue !== 'object' || Array.isArray(importsValue)) {
		throw new TypeError('Desktop runtime package imports are invalid.');
	}
	return Object.freeze(Object.fromEntries(Object.entries(importsValue).filter(([alias, target]) => (
		productId === 'framescaper'
			|| SOUNDSCAPER_RUNTIME_PACKAGE_IMPORTS.has(alias)
			&& typeof target === 'string' && !soundscaperForbiddenPackagePath(
				target.replace(/^\.\/desktop\/project-library-runtime\//u, ''),
			)
	))));
}

export function desktopProductSourceIncluded(productIdValue, relativePathValue) {
	const productId = desktopPackageProduct(productIdValue);
	const relativePath = packagePath(relativePathValue, 'desktop application source');
	return productId === 'framescaper' || !soundscaperForbiddenPackagePath(relativePath)
		&& !SOUNDSCAPER_REPLACED_SOURCE_FILES.has(relativePath);
}

export function assertDesktopProductPackageIsolation(productIdValue, filesValue, contentByPath = new Map()) {
	const productId = desktopPackageProduct(productIdValue);
	const files = exactFileInventory(filesValue, 'desktop package');
	if (productId === 'framescaper') return;
	const forbidden = files.filter((path) => soundscaperForbiddenPackagePath(path)
		|| SOUNDSCAPER_FORBIDDEN_CONFIG.test(path));
	if (forbidden.length > 0) {
		throw new Error(`Soundscaper package contains Framescaper-owned files: ${forbidden.join(', ')}`);
	}
	for (const [pathValue, source] of contentByPath) {
		const path = packagePath(pathValue, 'desktop package content');
		if (!files.includes(path) || typeof source !== 'string') {
			throw new TypeError('Desktop package content audit must bind an inventoried text file.');
		}
		const marker = SOUNDSCAPER_FORBIDDEN_CONTENT.exec(source)?.[0];
		if (marker !== undefined) {
			throw new Error(`Soundscaper package contains a callable Framescaper marker ${marker} in ${path}.`);
		}
	}
}

export function soundscaperMainSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop main');
	const framesImports = [
		/import \{ disposeDesktopCaptureSecurity, registerDesktopCaptureSecurity, revokeDesktopCaptureOwner \} from '\.\/framescaper-capture-registration\.mjs';\n/u,
		/import \{ createFramescaperNativeServicesElectronPorts \} from '\.\/framescaper-native-services-electron-ports\.mjs';\n/u,
		/import \{ startFramescaperNativeServicesRegistration \} from '\.\/framescaper-native-services-registration\.mjs';\n/u,
		/import \{ FRAMESCAPER_IMAGE_SEQUENCE_IMPORT_AUTHORITY \} from '\.\/framescaper-route-authorities\.mjs';\n/u,
		/import \{ framescaperWebVcrSmokeTrust \} from '\.\/framescaper-web-vcr-smoke-plan\.js';\n/u,
		/import \{ createDesktopLinkedVideoLocatorRuntime \} from '\.\/linked-video-locator-runtime\.js';\n/u,
	];
	for (const pattern of framesImports) source = replaceOnce(source, pattern, '', 'Framescaper main import');
	source = replaceOnce(source, '\tdesktopCapturer,\n', '', 'desktop capture import');
	source = replaceOnce(source, 'EXTERNAL_DESTINATIONS, FRAMESCAPER_WEB_VCR_ENABLED,',
		'EXTERNAL_DESTINATIONS,', 'Framescaper capture feature flag');
	const replacement = [
		"import {",
		"\tdeferredWebVcrSmokeTrust, disposeDesktopCaptureSecurity,",
		"\tregisterDesktopCaptureSecurity, revokeDesktopCaptureOwner,",
		"} from './soundscaper-product-isolation.mjs';",
		'',
	].join('\n');
	source = source.replace("import { registerHostAffordances } from './host-affordances.mjs';\n",
		`${replacement}import { registerHostAffordances } from './host-affordances.mjs';\n`);
	source = replaceRange(source,
		'\tnativeServices = await startFramescaperNativeServicesRegistration({',
		'\treleaseChecker =',
		'\treleaseChecker =',
		'deferred native services startup');
	source = replaceOnce(source,
		"\tlinkedVideoLocators = createDesktopLinkedVideoLocatorRuntime({ readCapabilities, registryPath: resolve(app.getPath('userData'), 'linked-video-locators-project-v1.json') });\n\tawait linkedVideoLocators.ready();\n",
		'', 'linked-video locator startup');
	source = replaceOnce(source,
		"\tlinkedVideoLocators.registerIpc({ dialog, handle, ownerFor: rendererSaveOwnerFor, windowFor: () => mainWindow });\n",
		'', 'linked-video locator IPC');
	return `${source.replace("const __dirname = dirname(fileURLToPath(import.meta.url));",
		"const DEFERRED_CAPTURE_ENABLED = false;\nconst __dirname = dirname(fileURLToPath(import.meta.url));")}`
		.replace('appOrigin: APP_ORIGIN, desktopCapturer, desktopRoot:', 'appOrigin: APP_ORIGIN, desktopRoot:')
		.replaceAll('framescaperWebVcrSmokeTrust', 'deferredWebVcrSmokeTrust')
		.replaceAll('FRAMESCAPER_WEB_VCR_ENABLED', 'DEFERRED_CAPTURE_ENABLED')
		.replaceAll("linkedVideoLocators: () => linkedVideoLocators", "linkedVideoLocators: () => null")
		.replace("\t\t{ name: 'linked-video locators', run: () => linkedVideoLocators?.dispose() },\n", '');
}

export function soundscaperPreloadSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop preload');
	source = replaceRange(source,
		'const PRELOAD_PRODUCT_ID =',
		'/* Keys main may hold',
		"const PRELOAD_PRODUCT_ID = 'soundscaper';\nconst SOAK_DEBUG_ENABLED = PRELOAD_PRODUCT_ID === 'soundscaper'\n\t&& (process.argv ?? []).includes('--soundscaper-soak-debug');\n/* Keys main may hold",
		'preload product selection');
	source = replaceRange(source,
		'\n\tframescaperNativeCapabilities:',
		'\n\tlistAssistanceModels:',
		'\n\tlistAssistanceModels:',
		'Framescaper preload channels');
	source = replaceRange(source,
		'\n\tnativeServices: Object.freeze({',
		'\n\tlistAssistanceModels:',
		'\n\tlistAssistanceModels:',
		'Framescaper preload API');
	source = replaceRange(source,
		'\n\tchooseLinkedVideoOriginal:',
		'\n\tchooseLinkedAudioOriginal:',
		'\n\tchooseLinkedAudioOriginal:',
		'linked-video preload API');
	source = replaceRange(source,
		'\n\tprobeHelperAvailability:',
		'\n\tnativeAudioHelperAvailability:',
		'\n\tnativeAudioHelperAvailability:',
		'video probe preload API');
	source = replaceRange(source,
		'getDesktopVideoExportCapabilities:',
		'\n\trunWindowAction:',
		'\n\trunWindowAction:',
		'desktop video preload API');
	source = replaceRange(source,
		'function desktopVideoCapabilities',
		'function nativeTierControlRequest',
		'function nativeTierControlRequest',
		'desktop video preload validation');
	for (const pattern of [
		/ chooseLinkedVideoOriginal: '[^']+',/u,
		/ loadLinkedVideoOriginal: '[^']+',/u,
		/ reconcileLinkedVideoOriginals: '[^']+',/u,
		/ releaseLinkedVideoOriginal: '[^']+',/u,
	]) source = replaceOnce(source, pattern, '', 'linked-video preload channel');
	source = replaceRange(source,
		"helperProbeAvailability: 'soundscaper:v1:helper:probe-availability'",
		'\n\tnativeAudioAvailability:',
		'\n\tnativeAudioAvailability:',
		'video probe preload channels');
	source = replaceRange(source,
		"desktopVideoCodecCapabilities: 'soundscaper:v1:codecs:video:capabilities'",
		'\n\tcheckForUpdates:',
		'\n\tcheckForUpdates:',
		'desktop video preload channels');
	source = replaceRange(source,
		'\nconst FRAMESCAPER_PROJECT_LIBRARY_HANDSHAKE',
		'\nif (PRELOAD_PRODUCT_ID',
		'\nif (PRELOAD_PRODUCT_ID',
		'Framescaper preload project library');
	source = replaceOnce(source, /const apiWithoutPersistentDelivery[^\n]+\n/u, [
		"const bridge = Object.freeze({ v1: api }); for (const [channel, type] of [[CHANNELS.nativeAudioRealtimePort, 'soundscaper-native-realtime-port-v1'], [CHANNELS.nativePluginRpcPort, 'soundscaper-native-plugin-rpc-port-v1']]) ipcRenderer.on(channel, (event, offer) => { const ports = Array.from(event.ports ?? []); if (ports.length !== 1) { for (const port of ports) port.close(); return; } window.postMessage(Object.freeze({ type, offer: nativePluginStatus(offer) }), '*', ports); });",
		'',
	].join('\n'), 'preload product bridge');
	source = replaceOnce(source,
		"contextBridge.exposeInMainWorld('framescaperDesktop', framescaperBridge);\n",
		'', 'Framescaper preload exposure');
	return source;
}

export function soundscaperConstantsSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop constants');
	source = replaceRange(source, 'export const PRODUCT_ID',
		'export const SETTINGS_SCHEMA_VERSION = 1;', [
			"export const PRODUCT_ID = 'soundscaper';",
			'const PRODUCT_METADATA_MATCHES = productConfig.schemaVersion === 1 && productConfig.id === PRODUCT_ID;',
			'export const DECLARED_APPLICATION_VERSION = PRODUCT_METADATA_MATCHES ? productConfig.applicationVersion : null;',
			"export const APPLICATION_VERSION_CHANNEL = PRODUCT_METADATA_MATCHES ? productConfig.applicationVersionChannel : 'candidate';",
			"export const RELEASE_CHANNEL = PRODUCT_METADATA_MATCHES ? productConfig.releaseChannel : 'candidate';",
			"export const APP_NAME = 'Soundscaper';",
			"export const APP_ID = 'org.soundscaper.desktop';",
			"export const APP_SCHEME = 'soundscaper-app';",
			"export const APP_HOST = 'bundle';",
			'export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;',
			"export const SESSION_PARTITION = 'persist:soundscaper-production';",
			"export const UPDATE_TAG_PREFIX = PRODUCT_METADATA_MATCHES ? productConfig.updateTagPrefix : 'soundscaper-v';",
			'export const SETTINGS_SCHEMA_VERSION = 1;',
		].join('\n'), 'desktop product constants');
	source = replaceOnce(source,
		"export const PROJECT_FILE_EXTENSION = PRODUCT_ID === 'framescaper' ? '.fscape' : '.sscape';",
		"export const PROJECT_FILE_EXTENSION = '.sscape';", 'desktop project extension');
	source = replaceRange(source, '\n\tchooseLinkedVideoOriginal:', '\n\tchooseLinkedAudioOriginal:',
		'\n\tchooseLinkedAudioOriginal:', 'linked-video IPC constants');
	source = replaceRange(source, '\n\thelperProbeAvailability:', '\n\tnativeAudioAvailability:',
		'\n\tnativeAudioAvailability:', 'video probe IPC constants');
	source = replaceRange(source, '\n\tframescaperNativeCapabilities:', '\n\tlistAssistanceModels:',
		'\n\tlistAssistanceModels:', 'Framescaper IPC constants');
	source = replaceRange(source, '\n\tdesktopVideoCodecCapabilities:', '\n\tsetLocale:',
		'\n\tsetLocale:', 'desktop video IPC constants');
	return source;
}

export function soundscaperDesktopCodecSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop codec integration');
	source = replaceOnce(source,
		"import { registerDesktopVideoCodecs } from './desktop-video-codec-registration.mjs';\n",
		'', 'desktop video codec import');
	source = replaceOnce(source,
		'\tconst registerVideo = dependencies.registerVideoCodecs ?? registerDesktopVideoCodecs;\n',
		'', 'desktop video codec dependency');
	source = replaceOnce(source,
		"\tif (typeof registerAudio !== 'function' || typeof registerVideo !== 'function') {",
		"\tif (typeof registerAudio !== 'function') {", 'desktop codec dependency validation');
	source = replaceOnce(source,
		"\t\tproviders.push(validateProvider(await registerVideo(options), 'video'));\n",
		'', 'desktop video codec registration');
	return source;
}

export function soundscaperProtocolSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop protocol');
	source = replaceOnce(source,
		"const FRAMESCAPER_CAPTURE_POLICY =\n\t'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';\n",
		'', 'Framescaper protocol capture policy');
	source = replaceOnce(source,
		"\tif (productId !== 'soundscaper' && productId !== 'framescaper') {",
		"\tif (productId !== 'soundscaper') {", 'desktop protocol product validation');
	source = replaceOnce(source,
		"\tif (productId === 'framescaper') return FRAMESCAPER_CAPTURE_POLICY;\n",
		'', 'Framescaper protocol policy selection');
	source = replaceOnce(source,
		"const SOUNDSCAPER_CAPTURE_POLICY =\n\t'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()';",
		"const SOUNDSCAPER_CAPTURE_POLICY =\n\t'microphone=(self), speaker-selection=(self), display-capture=(), camera=(), geolocation=()';",
		'Soundscaper display-capture policy');
	return source;
}

export function soundscaperNativeTierSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop native tier');
	source = replaceOnce(source,
		"import { registerDesktopHelperProbe } from './helper-registration.mjs';\n",
		'', 'video probe registration import');
	source = replaceOnce(source,
		'\t\tprobe: registerDesktopHelperProbe(seams),\n',
		'\t\tprobe: null,\n', 'video probe registration');
	return source;
}

export function soundscaperProjectRuntimeSource(sourceValue) {
	let source = textSource(sourceValue, 'project-library product runtime');
	source = replaceRange(source,
		"\tif (productId === 'framescaper') {",
		"\n\tif (productId === 'soundscaper') {",
		"\n\tif (productId === 'soundscaper') {",
		'Framescaper project runtime branch');
	source = replaceRange(source,
		'\nfunction framescaperTestControl(',
		'\nasync function createExactSmokeEvidence',
		'\nasync function createExactSmokeEvidence',
		'Framescaper project test control');
	return source
		.replace("\t\tif (this.#productId !== 'framescaper'", "\t\tif (true")
		.replace("if (value !== 'soundscaper' && value !== 'framescaper')", "if (value !== 'soundscaper')");
}

export function soundscaperProductIsolationModuleSource() {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
export const FOREIGN_IMAGE_SEQUENCE_IMPORT_AUTHORITY = null;
export function createDeferredNativeServicesElectronPorts() { return Object.freeze({}); }
export async function startDeferredNativeServicesRegistration() { return null; }
export function deferredWebVcrSmokeTrust() { return null; }
export function revokeDesktopCaptureOwner(registration, owner) { return registration?.revokeOwner(owner); }
export function disposeDesktopCaptureSecurity(registration) { return registration?.dispose(); }
export function registerDesktopCaptureSecurity(options) {
\tconst permissionCheck = (webContents, permission, requestingOrigin, details) => {
\t\tif (!String(requestingOrigin || webContents?.getURL()).startsWith(options.appOrigin)) return false;
\t\tif (permission === 'fullscreen') return true;
\t\tif (permission === 'display-capture') return false;
\t\tif (permission !== 'media') return false;
\t\tconst mediaTypes = details?.mediaTypes || [];
\t\treturn mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
\t};
\tconst permissionRequest = (webContents, permission, callback, details) => callback(permissionCheck(webContents, permission, details?.requestingUrl || webContents?.getURL(), details));
\toptions.desktopSession.setPermissionCheckHandler(permissionCheck);
\toptions.desktopSession.setPermissionRequestHandler(permissionRequest);
\tconst cancelDownload = (_event, item) => item.cancel();
\toptions.desktopSession.on('will-download', cancelDownload);
\tlet disposed = false;
\treturn Object.freeze({ revokeOwner: () => false, dispose() {
\t\tif (disposed) return; disposed = true;
\t\toptions.desktopSession.setPermissionCheckHandler(null);
\t\toptions.desktopSession.setPermissionRequestHandler(null);
\t\toptions.desktopSession.removeListener('will-download', cancelDownload);
\t} });
}
`;
}

export function soundscaperDesktopSmokeSource(sourceValue) {
	return textSource(sourceValue, 'desktop smoke')
		.replaceAll("productId === 'framescaper'", 'false')
		.replaceAll("productId !== 'framescaper'", 'true')
		.replace("value !== 'soundscaper' && value !== 'framescaper'", "value !== 'soundscaper'");
}

export function soundscaperAssistanceRegistrationSource(sourceValue) {
	let source = textSource(sourceValue, 'assistance registration');
	for (const pattern of [
		/import \{ createExternalFfmpegAssistanceShotRuntimeAdapter \} from '[^']+';\n/u,
		/import \{ createExternalFfmpegAssistanceVideoMaterializer \} from '[^']+';\n/u,
		/import \{ createAssistanceWorkflowOwnedVideoHighlightStageRuntime \} from '[^']+';\n/u,
	]) source = replaceOnce(source, pattern, '', 'deferred visual assistance import');
	source = replaceOnce(source,
		/\tconst shotDetectionRuntime = createExternalFfmpegAssistanceShotRuntimeAdapter\(\{\n\t\tpreferences: externalFfmpegPreferences,\n\t\}\);\n/u,
		'', 'deferred shot-detection runtime');
	source = replaceOnce(source, '\t\t\tshotDetectionRuntime,\n', '',
		'deferred shot-detection operation');
	source = replaceRange(source,
		'\tconst videoMaterializer =',
		'\tconst workflowExecute =',
		'\tconst deterministicHandlers = Object.freeze({ ...audioCutHandlers });\n\tconst workflowExecute =',
		'deferred visual assistance workflow');
	return source;
}

export function soundscaperDesktopSmokeDeferredModuleSource() {
	return `
export const FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY = null;
export const FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE = 'deferred-product-dormant-v1';
export const FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX = 'DEFERRED_PRODUCT_DORMANT ';
export const FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE = 'deferred-product-packaged-v1';
export const FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX = 'DEFERRED_PRODUCT_PACKAGED ';
export const FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY = '__deferredProductSmokeStageV1';
export function createFramescaperWebVcrSmokeSession() { return null; }
export function decodeFramescaperWebVcrSmokePlan() { throw new Error('Deferred product smoke is unavailable.'); }
export function joinFramescaperBaselineArtifactEvidence() { throw new Error('Deferred product smoke is unavailable.'); }
export function runFramescaperBaselineArtifactRendererSmoke() { throw new Error('Deferred product smoke is unavailable.'); }
export function runFramescaperCaptureArtifactRendererSmoke() { throw new Error('Deferred product smoke is unavailable.'); }
export function validateFramescaperCaptureArtifactEvidence() { throw new Error('Deferred product smoke is unavailable.'); }
`;
}

function soundscaperForbiddenPackagePath(path) {
	const runtimePath = path.replace(/^(?:desktop\/)?project-library-runtime\//u, '');
	if (SOUNDSCAPER_SHARED_RUNTIME_EXCEPTIONS.has(runtimePath)
		|| SOUNDSCAPER_SHARED_VIDEO_RUNTIME.test(runtimePath)) return false;
	return SOUNDSCAPER_FORBIDDEN_PATH.test(path) || SOUNDSCAPER_DEFERRED_VISUAL_PATH.test(path)
		|| SOUNDSCAPER_FORBIDDEN_CONFIG.test(path);
}

function desktopPackageProduct(value) {
	if (!PRODUCT_IDS.includes(value)) throw new TypeError('Desktop package product is unsupported.');
	return value;
}

function exactFileInventory(value, label) {
	if (!Array.isArray(value) || value.some((path) => typeof path !== 'string')
		|| new Set(value).size !== value.length) throw new TypeError(`${label} file inventory is invalid.`);
	return value.map((path) => packagePath(path, label));
}

function packagePath(value, label) {
	if (typeof value !== 'string' || value.length === 0 || value.startsWith('/')
		|| value.includes('\\') || value.split('/').includes('..')) {
		throw new TypeError(`${label} path is invalid.`);
	}
	return value;
}

function textSource(value, label) {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} source is invalid.`);
	return value.replaceAll('\r\n', '\n');
}

function replaceRange(source, start, end, replacement, label) {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot isolate ${label}.`);
	return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

function replaceOnce(source, pattern, replacement, label) {
	if (typeof pattern === 'string') {
		if (source.indexOf(pattern) < 0 || source.indexOf(pattern) !== source.lastIndexOf(pattern)) {
			throw new Error(`Cannot isolate ${label}.`);
		}
		return source.replace(pattern, replacement);
	}
	const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
	if (matches?.length !== 1) throw new Error(`Cannot isolate ${label}.`);
	return source.replace(pattern, replacement);
}
