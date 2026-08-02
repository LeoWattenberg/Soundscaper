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
export const READ_PROFILE_MATERIALIZED_V1 = 'materialized-v1';
export const READ_PROFILE_SCAPE_RANGE_V1 = 'scape-range-v1';
export const SCAPE_PROJECT_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const RUNTIME_PREFIX = '/runtime/';
export const MAX_READ_CAPABILITIES_PER_OWNER = 128;
export const MAX_READ_CAPABILITY_BYTES_PER_OWNER = 512 * 1024 ** 2;
export const MAX_SCAPE_RANGE_READ_CAPABILITIES = 4;
export const MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES = 65 * 1024 ** 3;
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
	releaseLinkedVideoOriginal: 'soundscaper:v1:linked-video:release',
	chooseSaveTarget: 'soundscaper:v1:save:choose',
	beginWrite: 'soundscaper:v1:save:begin',
	writeChunk: 'soundscaper:v1:save:chunk',
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
	setLocale: 'soundscaper:v1:locale:set',
	setFullscreen: 'soundscaper:v1:fullscreen:set',
	checkForUpdates: 'soundscaper:v1:updates:check',
	openExternal: 'soundscaper:v1:external:open',
	editText: 'soundscaper:v1:text:edit',
	rendererReady: 'soundscaper:v1:renderer:ready',
	respondToClose: 'soundscaper:v1:close:respond',
	openProject: 'soundscaper:v1:event:project-open',
	menuCommand: 'soundscaper:v1:event:menu-command',
	closeRequested: 'soundscaper:v1:event:close-requested',
	fullscreenChanged: 'soundscaper:v1:event:fullscreen-changed',
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
