/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ title: 'Editable Framescaper copy',
	description: 'Keep this photo’s saved recipe, original image and LUT resources in an editable copy. The photo in this library stays unchanged.',
	next: 'Download the .fscape file, then open it in Framescaper or import it into its library.',
	download: 'Download copy', close: 'Close', fileType: 'Editable Framescaper project',
	preparing: 'Preparing the selected photo…', working: 'Preparing and saving the copy…',
	saved: 'Copy saved: {name}', downloadStarted: 'Download started: {name}', cancelled: 'Download cancelled.',
	failed: 'The copy could not be prepared or saved. The selected photo may have changed. Close this dialog and select the photo again.' });
const DE = Object.freeze({ title: 'Bearbeitbare Framescaper-Kopie',
	description: 'Die gespeicherten Entwicklungseinstellungen, das Originalbild und die LUT-Ressourcen bleiben in der bearbeitbaren Kopie erhalten. Das Foto in dieser Bibliothek bleibt unverändert.',
	next: 'Die .fscape-Datei herunterladen und anschließend in Framescaper öffnen oder in dessen Bibliothek importieren.',
	download: 'Kopie herunterladen', close: 'Schließen', fileType: 'Bearbeitbares Framescaper-Projekt',
	preparing: 'Das ausgewählte Foto wird vorbereitet…', working: 'Die Kopie wird vorbereitet und gespeichert…',
	saved: 'Kopie gespeichert: {name}', downloadStarted: 'Download gestartet: {name}', cancelled: 'Download abgebrochen.',
	failed: 'Die Kopie konnte nicht vorbereitet oder gespeichert werden. Das ausgewählte Foto hat sich möglicherweise geändert. Diesen Dialog schließen und das Foto erneut auswählen.' });
export function photoFramescaperHandoffCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
