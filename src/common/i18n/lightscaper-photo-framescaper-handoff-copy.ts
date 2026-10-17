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

const RECEIVE_EN = Object.freeze({ title: 'Import editable Framescaper photo',
	description: 'Choose a saved .fscape file, then choose a photo or still to import as a new photo in this library. Saved photo settings are kept.',
	file: 'Editable Framescaper file', source: 'Photo to import', choose: 'Choose a photo…', originalDimensions: 'Original dimensions',
	imageClip: 'Still to copy', chooseClip: 'Choose a still…', timeline: 'Timeline', projectBin: 'Project Bin',
	ordinaryStill: 'This still opens with its original appearance. The filename saved in Framescaper is used. Timeline timing and composition stay in Framescaper.',
	unavailable: '{count} images are unavailable for editable import.', empty: 'This file has no supported editable photos.',
	importPhoto: 'Import photo', close: 'Close', reload: 'Reload library', working: 'Reading or importing the selected photo…',
	imported: 'Photo imported.', recovery: 'Photo imported. Reload the library to finish the import.',
	refreshFailed: 'Photo imported. The library view could not be refreshed. Reload the library.',
	failed: 'The editable photo could not be read or imported. Choose another file or photo and try again.', reloadFailed: 'The library could not be reloaded. Try Reload library again.' });
const RECEIVE_DE = Object.freeze({ title: 'Bearbeitbares Framescaper-Foto importieren',
	description: 'Eine gespeicherte .fscape-Datei und anschließend ein Foto oder Standbild auswählen, um es als neues Foto in diese Bibliothek zu importieren. Gespeicherte Fotoeinstellungen bleiben erhalten.',
	file: 'Bearbeitbare Framescaper-Datei', source: 'Zu importierendes Foto', choose: 'Ein Foto auswählen…', originalDimensions: 'Originalabmessungen',
	imageClip: 'Zu kopierendes Standbild', chooseClip: 'Ein Standbild auswählen…', timeline: 'Zeitleiste', projectBin: 'Projektablage',
	ordinaryStill: 'Dieses Standbild wird mit seinem ursprünglichen Aussehen geöffnet. Der in Framescaper gespeicherte Dateiname wird verwendet. Zeitablauf und Komposition der Zeitleiste bleiben in Framescaper.',
	unavailable: '{count} Bilder können nicht bearbeitbar importiert werden.', empty: 'Diese Datei enthält keine unterstützten bearbeitbaren Fotos.',
	importPhoto: 'Foto importieren', close: 'Schließen', reload: 'Bibliothek neu laden', working: 'Das ausgewählte Foto wird gelesen oder importiert…',
	imported: 'Foto importiert.', recovery: 'Foto importiert. Die Bibliothek neu laden, um den Import abzuschließen.',
	refreshFailed: 'Foto importiert. Die Bibliotheksansicht konnte nicht aktualisiert werden. Die Bibliothek neu laden.',
	failed: 'Das bearbeitbare Foto konnte nicht gelesen oder importiert werden. Eine andere Datei oder ein anderes Foto auswählen und erneut versuchen.', reloadFailed: 'Die Bibliothek konnte nicht neu geladen werden. Erneut auf Bibliothek neu laden klicken.' });
export function photoFramescaperReceiveCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? RECEIVE_DE : RECEIVE_EN; }

const COLLECTION_EN = Object.freeze({ title: 'Framescaper collection sequence',
	description: 'Keep every photo’s active saved recipe, original image and LUT resources in one editable sequence. Photos in this library stay unchanged.',
	next: 'Download the .fscape file, then open it in Framescaper or import it into its library.',
	scope: 'Collection source', chooseScope: 'Choose a collection source…', catalog: 'Catalog collections', savedQuery: 'Saved filters',
	manual: 'Manual', smart: 'Smart', savedCollection: 'Saved filter', chooseCollection: 'Choose a saved filter…', emptySaved: 'No saved filters on this page.',
	download: 'Download sequence', close: 'Close', fileType: 'Editable Framescaper sequence', preparing: 'Reading or preparing the selected collection…',
	working: 'Preparing and saving the sequence…', saved: 'Sequence saved: {name}', downloadStarted: 'Download started: {name}', cancelled: 'Download cancelled.',
	failed: 'The sequence could not be prepared or saved. Close this dialog and choose the collection again.',
	photoDefinitionRoot: 'Root', photoDefinitionUp: 'Up', photoDefinitionNext: 'Next page', photoDefinitionReload: 'Reload collections',
	photoDefinitionChoose: 'Choose', photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear selection', photoDefinitionSelected: 'Selected collection',
	photoDefinitionEmpty: 'No collections on this page.', photoDefinitionFailed: 'Collections could not be read. Try Reload collections again.', photoWorking: 'Reading collections…' });
const COLLECTION_DE = Object.freeze({ title: 'Framescaper-Sammlungssequenz',
	description: 'Die aktive gespeicherte Entwicklung, das Originalbild und die LUT-Ressourcen jedes Fotos bleiben in einer bearbeitbaren Sequenz erhalten. Die Fotos in dieser Bibliothek bleiben unverändert.',
	next: 'Die .fscape-Datei herunterladen und anschließend in Framescaper öffnen oder in dessen Bibliothek importieren.',
	scope: 'Sammlungsquelle', chooseScope: 'Eine Sammlungsquelle auswählen…', catalog: 'Katalogsammlungen', savedQuery: 'Gespeicherte Filter',
	manual: 'Manuell', smart: 'Intelligent', savedCollection: 'Gespeicherter Filter', chooseCollection: 'Einen gespeicherten Filter auswählen…', emptySaved: 'Keine gespeicherten Filter auf dieser Seite.',
	download: 'Sequenz herunterladen', close: 'Schließen', fileType: 'Bearbeitbare Framescaper-Sequenz', preparing: 'Die ausgewählte Sammlung wird gelesen oder vorbereitet…',
	working: 'Die Sequenz wird vorbereitet und gespeichert…', saved: 'Sequenz gespeichert: {name}', downloadStarted: 'Download gestartet: {name}', cancelled: 'Download abgebrochen.',
	failed: 'Die Sequenz konnte nicht vorbereitet oder gespeichert werden. Diesen Dialog schließen und die Sammlung erneut auswählen.',
	photoDefinitionRoot: 'Wurzel', photoDefinitionUp: 'Nach oben', photoDefinitionNext: 'Nächste Seite', photoDefinitionReload: 'Sammlungen neu laden',
	photoDefinitionChoose: 'Auswählen', photoDefinitionOpen: 'Öffnen', photoDefinitionClear: 'Auswahl aufheben', photoDefinitionSelected: 'Ausgewählte Sammlung',
	photoDefinitionEmpty: 'Keine Sammlungen auf dieser Seite.', photoDefinitionFailed: 'Die Sammlungen konnten nicht gelesen werden. Erneut auf Sammlungen neu laden klicken.', photoWorking: 'Sammlungen werden gelesen…' });
export function photoFramescaperCollectionHandoffCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? COLLECTION_DE : COLLECTION_EN; }
