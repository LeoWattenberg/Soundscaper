import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { MUSICAL_TIMELINE_COPY_BY_LOCALE } from '../src/common/i18n/musical-timeline-copy.js';
import { SITE_SIDEBAR_COPY_BY_LOCALE } from '../src/common/i18n/site-sidebar-copy.js';
import { TIMELINE_ANNOTATION_COPY_BY_LOCALE } from '../src/common/i18n/timeline-annotation-copy.js';
import { WORKSPACE_CHROME_COPY_BY_LOCALE } from '../src/common/i18n/workspace-chrome-copy.js';
import { WORKSPACE_ONBOARDING_COPY_BY_LOCALE } from '../src/common/i18n/workspace-onboarding-copy.js';
import { PREFERENCES_COPY_BY_LOCALE } from '../src/common/i18n/preferences-copy.js';
import { AUDACITY_ACTION_MANIFEST } from '../src/common/editor/audacity-action-parity.js';
import * as runtime from '../src/common/i18n/runtime.js';

const { loadTranslationManifest, loadTranslationPack, normalizeLocale } = runtime;

test('bundled catalogs are complete and user-visible values contain no ellipses', () => {
	assert.deepEqual(Object.keys(GERMAN_COPY), Object.keys(ENGLISH_COPY));
	assert.ok(Object.keys(ENGLISH_COPY).length >= 700);
	for (const [locale, catalog] of Object.entries({ en: ENGLISH_COPY, de: GERMAN_COPY })) {
		for (const [key, value] of Object.entries(catalog)) {
			assert.equal(typeof value, 'string', `${locale}.${key}`);
			assert.doesNotMatch(value, /…|\.\.\./u, `${locale}.${key}`);
		}
	}
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		assert.doesNotMatch(definition.label, /…|\.\.\./u, definition.id);
		for (const reason of Object.values(definition.reason || {})) assert.doesNotMatch(reason, /…|\.\.\./u, definition.id);
	}
});

test('site sidebar copy stays localized and merged into the bundled catalogs', () => {
	assert.equal(SITE_SIDEBAR_COPY_BY_LOCALE.en.reportIssueLink, 'Report an issue');
	assert.equal(SITE_SIDEBAR_COPY_BY_LOCALE.de.reportIssueLink, 'Ein Problem melden');
	assert.deepEqual(Object.keys(SITE_SIDEBAR_COPY_BY_LOCALE.de), Object.keys(SITE_SIDEBAR_COPY_BY_LOCALE.en));
	assert.ok(Object.isFrozen(SITE_SIDEBAR_COPY_BY_LOCALE));
	assert.ok(Object.isFrozen(SITE_SIDEBAR_COPY_BY_LOCALE.en));
	for (const locale of ['en', 'de']) {
		const catalog = locale === 'en' ? ENGLISH_COPY : GERMAN_COPY;
		for (const [key, value] of Object.entries(SITE_SIDEBAR_COPY_BY_LOCALE[locale])) {
			assert.equal(catalog[key], value, `${locale}.${key}`);
		}
	}
});

test('the Soundscaper and Audacity workspace labels and their chrome copy exist in both locales', () => {
	assert.equal(ENGLISH_COPY.workspaceModern, 'Soundscaper');
	assert.equal(GERMAN_COPY.workspaceModern, 'Soundscaper');
	assert.equal(ENGLISH_COPY.workspaceAudacity, 'Audacity');
	assert.equal(GERMAN_COPY.workspaceAudacity, 'Audacity');
	assert.equal(ENGLISH_COPY.timecode, 'Timecode');
	assert.equal(ENGLISH_COPY.panelMenu, 'Panel menu');
	assert.equal(GERMAN_COPY.panelMenu, 'Bedienfeldmenü');
	assert.equal(ENGLISH_COPY.snapInterval, 'Snap interval');
	assert.equal(ENGLISH_COPY.workspaceOnboardingTitle, 'Getting started');
	assert.equal(ENGLISH_COPY.workspaceOnboardingMenu, 'Set up workspace');
	assert.equal(GERMAN_COPY.workspaceOnboardingMenu, 'Arbeitsbereich einrichten');
	assert.deepEqual(Object.keys(WORKSPACE_CHROME_COPY_BY_LOCALE.de), Object.keys(WORKSPACE_CHROME_COPY_BY_LOCALE.en));
	assert.deepEqual(Object.keys(WORKSPACE_ONBOARDING_COPY_BY_LOCALE.de), Object.keys(WORKSPACE_ONBOARDING_COPY_BY_LOCALE.en));
	for (const key of ['panelMenu', 'timecode', 'snapInterval']) {
		assert.equal(typeof WORKSPACE_CHROME_COPY_BY_LOCALE.en[key], 'string', key);
	}
	for (const key of [
		'workspaceOnboardingTitle', 'workspaceOnboardingQuestion', 'workspaceOnboardingAudacityDescription',
		'workspaceOnboardingSoundscaperDescription', 'workspaceOnboardingHint', 'workspaceOnboardingSelect',
		'workspaceOnboardingMenu',
	]) {
		assert.equal(typeof WORKSPACE_ONBOARDING_COPY_BY_LOCALE.en[key], 'string', key);
	}
	for (const [locale, catalog] of Object.entries({ en: ENGLISH_COPY, de: GERMAN_COPY })) {
		for (const module of [WORKSPACE_CHROME_COPY_BY_LOCALE, WORKSPACE_ONBOARDING_COPY_BY_LOCALE]) {
			for (const [key, value] of Object.entries(module[locale])) {
				assert.equal(catalog[key], value, `${locale}.${key}`);
				assert.ok(value.length > 0, `${locale}.${key}`);
			}
		}
	}
});

test("the General page's Program start copy reaches both catalogs", () => {
	assert.deepEqual(Object.keys(PREFERENCES_COPY_BY_LOCALE.de), Object.keys(PREFERENCES_COPY_BY_LOCALE.en));
	assert.equal(ENGLISH_COPY.programStart, 'Program start');
	assert.equal(GERMAN_COPY.programStart, 'Programmstart');
	for (const [locale, catalog] of Object.entries({ en: ENGLISH_COPY, de: GERMAN_COPY })) {
		for (const [key, value] of Object.entries(PREFERENCES_COPY_BY_LOCALE[locale])) {
			assert.equal(catalog[key], value, `${locale}.${key}`);
			assert.ok(value.length > 0, `${locale}.${key}`);
		}
	}
});

test('musical timeline and annotation controls own distinct catalog keys', () => {
	assert.deepEqual(
		Object.keys(MUSICAL_TIMELINE_COPY_BY_LOCALE.en)
			.filter((key) => Object.hasOwn(TIMELINE_ANNOTATION_COPY_BY_LOCALE.en, key)),
		[],
	);
	assert.equal(ENGLISH_COPY.tempoMusicalAnchor, 'Musical');
	assert.equal(GERMAN_COPY.tempoMusicalAnchor, 'Musikalisch');
	assert.equal(ENGLISH_COPY.musicalAnchor, 'Musically anchored');
	assert.equal(GERMAN_COPY.musicalAnchor, 'Musikalisch verankert');
});

test('recording preparation failures are localized in English and German', () => {
	assert.equal(ENGLISH_COPY.showArmControls, ENGLISH_COPY.enableMultiTrackRecording);
	assert.equal(GERMAN_COPY.showArmControls, GERMAN_COPY.enableMultiTrackRecording);
	assert.equal(ENGLISH_COPY.recordingAssignInput, 'Assign an input to at least one armed track before recording.');
	assert.equal(GERMAN_COPY.recordingAssignInput, 'Weise vor der Aufnahme mindestens einer aktivierten Spur einen Eingang zu.');
	assert.equal(ENGLISH_COPY.timedRecordingAssignedInputsUnavailable, 'Every assigned recording input must remain available for timer recording.');
	assert.equal(GERMAN_COPY.timedRecordingAssignedInputsUnavailable, 'Alle zugewiesenen Aufnahme-Eingänge müssen für die zeitgesteuerte Aufnahme verfügbar bleiben.');
});

test('Scape feature decisions are explicit in English and German', () => {
	assert.equal(ENGLISH_COPY.scapeCompatibilityTitle, 'Project features unavailable');
	assert.equal(GERMAN_COPY.scapeCompatibilityTitle, 'Projektfunktionen nicht verfügbar');
	assert.equal(ENGLISH_COPY.scapeOpenReadOnly, 'Open read-only');
	assert.equal(GERMAN_COPY.scapeOpenReadOnly, 'Schreibgeschützt öffnen');
	assert.equal(ENGLISH_COPY.scapeOpenReadOnlyCopy, 'Open as read-only copy');
	assert.equal(GERMAN_COPY.scapeOpenReadOnlyCopy, 'Als schreibgeschützte Kopie öffnen');
	assert.match(ENGLISH_COPY.scapeCompatibilityMessage, /\{title\}.*read-only/iu);
	assert.match(GERMAN_COPY.scapeCompatibilityMessage, /\{title\}.*schreibgeschützt/iu);
	assert.equal(ENGLISH_COPY.scapeCompatibilityRenderedFallback, 'Rendered fallback declared');
	assert.equal(GERMAN_COPY.scapeCompatibilityRenderedFallback, 'Gerenderte Ersatzquelle deklariert');
	assert.equal(ENGLISH_COPY.scapeCompatibilityEditorPlaybackFallback, 'Rendered fallback active during editor playback');
	assert.equal(GERMAN_COPY.scapeCompatibilityEditorPlaybackFallback, 'Gerenderte Ersatzquelle bei der Wiedergabe im Editor aktiv');
});

test('normalizes explicit BCP-47 locales without a German/English clamp', () => {
	assert.equal(normalizeLocale('pt_BR'), 'pt-BR');
	assert.equal(normalizeLocale('ar'), 'ar');
	assert.equal(normalizeLocale('not a locale'), 'en');
});

test('the runtime no longer reaches for a translation origin', async () => {
	const runtime = await readFile(new URL('../src/common/i18n/runtime.js', import.meta.url), 'utf8');
	assert.doesNotMatch(runtime, /fetch|translations\.soundscaper\.org|latest\.json|PUBLIC_TRANSLATIONS_BASE_URL/u);
	assert.equal(typeof loadTranslationManifest, 'undefined');
	assert.equal(typeof loadTranslationPack, 'undefined');
});
