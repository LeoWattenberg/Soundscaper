/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the two report surfaces.
 *
 * Delivery reports generalize the AUP4 compatibility report's vocabulary, so
 * both sets of strings live together: the disposition labels are literally
 * shared by the two renderers, and splitting them across files is how one of
 * them ends up translated and the other not.
 */
const REPORT_COPY_ENTRIES = Object.freeze([
	['aup4CompatibilityReport', 'AUP4 Compatibility Report', 'AUP4-Kompatibilitätsbericht'],
	['aup4CompatibilityDescription', 'AUP4 is an Audacity interchange format. The local Soundscaper project remains the authoritative, fully editable version.', 'AUP4 ist ein Audacity-Austauschformat. Das lokale Soundscaper-Projekt bleibt die maßgebliche, vollständig bearbeitbare Fassung.'],
	['aup4CompatibilitySummary', '{direction}: {converted} converted, {missing} missing, {omitted} omitted.', '{direction}: {converted} konvertiert, {missing} fehlend, {omitted} ausgelassen.'],
	['aup4CompatibilityOpen', 'AUP4 open', 'AUP4-Import'],
	['aup4CompatibilitySave', 'AUP4 export', 'AUP4-Export'],
	['aup4CompatibilityViewReport', 'View report', 'Bericht anzeigen'],
	['aup4CompatibilityDismiss', 'Dismiss compatibility summary', 'Kompatibilitätshinweis schließen'],
	['aup4CompatibilityNoIssues', 'No compatibility losses were reported for this interchange.', 'Für diesen Austausch wurden keine Kompatibilitätsverluste gemeldet.'],
	['aup4CompatibilityPreserved', 'Preserved', 'Beibehalten'],
	['aup4CompatibilityConverted', 'Converted', 'Konvertiert'],
	['aup4CompatibilityMissing', 'Missing', 'Fehlend'],
	['aup4CompatibilityOmitted', 'Omitted', 'Ausgelassen'],
	['aup4CompatibilityDetails', 'Details', 'Details'],
	['deliveryReport', 'Delivery Report', 'Lieferbericht'],
	['deliveryReportDescription', 'What this delivery did to the material. Every conversion is itemized; nothing is applied silently.', 'Was diese Lieferung mit dem Material gemacht hat. Jede Konvertierung wird einzeln aufgeführt; nichts wird stillschweigend angewendet.'],
	['deliveryReportSummary', '{format}: {converted} converted, {omitted} omitted.', '{format}: {converted} konvertiert, {omitted} ausgelassen.'],
	['deliveryReportSubject', '{format}, {sampleRate} Hz, {channels} ch', '{format}, {sampleRate} Hz, {channels} Kan.'],
	['deliveryReportSave', 'Save report', 'Bericht speichern'],
	['deliveryReportNoConversions', 'This delivery converted nothing.', 'Diese Lieferung hat nichts konvertiert.'],
]);

export const REPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(REPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(REPORT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
