/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy owned by the shared product sidebar.
 *
 * Keep the English and German values beside each other so new navigation
 * entries cannot be added to only one bundled locale.
 */
const SITE_SIDEBAR_COPY_ENTRIES = Object.freeze([
	['sidebarNavigation', 'Soundscaper navigation', 'Soundscaper-Navigation'],
	['sidebarSettings', 'Settings', 'Einstellungen'],
	['audioEditorLink', 'Audio editor', 'Audio-Editor'],
	['moreToolsLink', 'More kw.media tools', 'Weitere kw.media Tools'],
	['audacityGuidesLink', 'Audacity guides', 'Audacity-Ratgeber'],
	['legalLink', 'Privacy policy', 'Datenschutzerklärung'],
	['reportIssueLink', 'Report an issue', 'Ein Problem melden'],
	['githubProjectLink', 'GitHub project', 'GitHub-Projekt'],
	['themeToggle', 'Switch color theme', 'Farbschema wechseln'],
	['lightTheme', 'Light', 'Hell'],
	['darkTheme', 'Dark', 'Dunkel'],
	['collapseNavigation', 'Collapse navigation', 'Navigation einklappen'],
	['expandNavigation', 'Expand navigation', 'Navigation ausklappen'],
	['languageLabel', 'Language', 'Sprache'],
]);

export const SITE_SIDEBAR_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(SITE_SIDEBAR_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(SITE_SIDEBAR_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
