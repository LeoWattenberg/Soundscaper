export const APP_NAME = 'Soundscaper';
export const APP_ID = 'org.soundscaper.desktop';
export const APP_SCHEME = 'soundscaper-app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const SESSION_PARTITION = 'persist:soundscaper-v1';
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
export const RUNTIME_PREFIX = '/runtime/';
export const MAX_SAVE_CHUNK_BYTES = 1024 * 1024;
export const MAX_SAVE_BYTES = 32 * 1024 * 1024 * 1024;

export const IPC = Object.freeze({
	environment: 'soundscaper:v1:environment',
	chooseFiles: 'soundscaper:v1:files:choose',
	releaseRead: 'soundscaper:v1:files:release',
	chooseSaveTarget: 'soundscaper:v1:save:choose',
	beginWrite: 'soundscaper:v1:save:begin',
	writeChunk: 'soundscaper:v1:save:chunk',
	finishWrite: 'soundscaper:v1:save:finish',
	abortWrite: 'soundscaper:v1:save:abort',
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
	homepage: 'https://soundscaper.org/',
	help: 'https://github.com/LeoWattenberg/Soundscaper#readme',
	manual: 'https://support.audacityteam.org/au4',
	tutorials: 'https://support.audacityteam.org/au4',
	support: 'mailto:team@kw.media?subject=Soundscaper%20support',
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
