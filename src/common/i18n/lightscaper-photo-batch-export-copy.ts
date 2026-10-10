/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ title: 'Download selected photos', description: 'Download this captured selection in page order. Keep this tab open; this queue cannot resume after a reload.',
	start: 'Start downloads', hide: 'Hide queue', pause: 'Pause queue', resume: 'Resume queue', cancel: 'Cancel queue', cancelMember: 'Cancel photo',
	format: 'Format', png: 'PNG', jpeg: 'JPEG', preparing: 'Preparing selected versions…', failed: 'Some photos could not be downloaded. Completed downloads remain available in your browser.',
	idle: 'Ready', queued: 'Queued', running: 'Exporting…', saved: 'Delivered', downloaded: 'Download started: {name}. Check your browser’s downloads.',
	cancelled: 'Cancelled', memberFailed: 'Failed', settled: 'Queue finished', paused: 'Queue paused' });
const DE = Object.freeze({ title: 'Ausgewählte Fotos herunterladen', description: 'Diese Auswahl in Seitenreihenfolge herunterladen. Lassen Sie diesen Tab geöffnet; nach dem Neuladen kann die Warteschlange nicht fortgesetzt werden.',
	start: 'Downloads starten', hide: 'Warteschlange ausblenden', pause: 'Warteschlange pausieren', resume: 'Warteschlange fortsetzen', cancel: 'Warteschlange abbrechen', cancelMember: 'Foto abbrechen',
	format: 'Format', png: 'PNG', jpeg: 'JPEG', preparing: 'Ausgewählte Versionen werden vorbereitet…', failed: 'Einige Fotos konnten nicht heruntergeladen werden. Abgeschlossene Downloads bleiben in Ihrem Browser verfügbar.',
	idle: 'Bereit', queued: 'Geplant', running: 'Wird exportiert…', saved: 'Übergeben', downloaded: 'Download gestartet: {name}. Prüfen Sie die Downloads Ihres Browsers.',
	cancelled: 'Abgebrochen', memberFailed: 'Fehlgeschlagen', settled: 'Warteschlange abgeschlossen', paused: 'Warteschlange pausiert' });
export function photoBatchExportCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
