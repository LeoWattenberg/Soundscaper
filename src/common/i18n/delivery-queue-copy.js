/**
 * Copy for delivery: what is delivered, in what form, and what the queue did.
 *
 * The range and output vocabulary lives here with the batch that reuses it,
 * because a batch target and an export range are the same choice offered twice
 * and they must not read differently in the two places.
 *
 * One entry per key with both locales beside each other, so a translation can
 * never drift into a different position from the string it translates — the
 * catalogs assert that both locales carry exactly the same keys.
 */
const DELIVERY_QUEUE_COPY_ENTRIES = Object.freeze([
	['exportMode', 'Output', 'Ausgabe'],
	['mix', 'Stereo mix', 'Stereomix'],
	['stems', 'Individual stems (archive)', 'Einzelspuren (Archiv)'],
	['exportRange', 'Range', 'Bereich'],
	['entireProject', 'Entire project', 'Gesamtes Projekt'],
	['currentSelection', 'Current selection', 'Aktuelle Auswahl'],
	['loopRegion', 'Loop region', 'Loop-Bereich'],
	['deliveryQueue', 'Delivery queue', 'Auslieferungswarteschlange'],
	['deliveryQueueEmpty', 'Nothing is queued.', 'Nichts in der Warteschlange.'],
	['deliveryQueuePause', 'Pause between jobs', 'Zwischen Aufträgen pausieren'],
	['deliveryQueueResume', 'Resume', 'Fortsetzen'],
	['deliveryQueueCancelJob', 'Cancel', 'Abbrechen'],
	['deliveryQueueRetryJob', 'Retry', 'Wiederholen'],
	['deliveryQueueSelectDestination', 'Choose destination', 'Ziel auswählen'],
	['deliveryQueueReauthorizeDestination', 'Reauthorize destination', 'Ziel erneut autorisieren'],
	['deliveryQueueMoveEarlier', 'Move earlier', 'Nach vorn verschieben'],
	['deliveryQueueMoveLater', 'Move later', 'Nach hinten verschieben'],
	['deliveryQueueShowReport', 'View report', 'Bericht anzeigen'],
	['deliveryQueueReport', 'Persisted delivery report', 'Gespeicherter Auslieferungsbericht'],
	['deliveryQueueProgress', '{percent}% complete', '{percent} % abgeschlossen'],
	['deliveryQueueStateQueued', 'Queued', 'In Warteschlange'],
	['deliveryQueueStateRunning', 'Running', 'Läuft'],
	['deliveryQueueStateWaitingForProject', 'Waiting for the exact saved project', 'Wartet auf das exakt gespeicherte Projekt'],
	['deliveryQueueStateNeedsAuthorization', 'Destination authorization required', 'Zielautorisierung erforderlich'],
	['deliveryQueueStateStale', 'Stale project or plan', 'Veraltetes Projekt oder veralteter Plan'],
	['deliveryQueueStateCompleted', 'Delivered', 'Ausgeliefert'],
	['deliveryQueueStateFailed', 'Failed', 'Fehlgeschlagen'],
	['deliveryQueueStateCancelled', 'Cancelled', 'Abgebrochen'],
	['deliveryBatch', 'Batch delivery', 'Stapelauslieferung'],
	['deliveryBatchTargets', 'Deliver', 'Ausliefern'],
	['deliveryBatchFormats', 'Formats', 'Formate'],
	['deliveryBatchQueue', 'Queue batch', 'Stapel einreihen'],
	['deliveryBatchRetryFailures', 'Retry what did not deliver', 'Nicht Ausgeliefertes wiederholen'],
	['deliveryBatchQueued', '{members} deliveries queued.', '{members} Auslieferungen eingereiht.'],
	['deliveryBatchNoFormats', 'Save a delivery preset to queue a batch.', 'Speichere eine Auslieferungsvorgabe, um einen Stapel einzureihen.'],
	['deliveryBatchNoTargets', 'Choose at least one thing to deliver.', 'Wähle mindestens etwas zum Ausliefern.'],
	[
		'deliveryBatchSummary',
		'{delivered} delivered, {failed} failed, {cancelled} cancelled, {notStarted} not started.',
		'{delivered} ausgeliefert, {failed} fehlgeschlagen, {cancelled} abgebrochen, {notStarted} nicht gestartet.',
	],
	['deliveryTargetNoSelection', 'Make a selection to deliver it.', 'Triff eine Auswahl, um sie auszuliefern.'],
	['deliveryTargetNoLoop', 'Enable the loop to deliver it.', 'Aktiviere den Loop, um ihn auszuliefern.'],
	[
		'deliveryTargetSequenceUndeliverable',
		'Resolve the sequence issues to deliver it.',
		'Behebe die Probleme der Sequenz, um sie auszuliefern.',
	],
	[
		'deliveryTargetStemsUnsupported',
		'A mastering sequence cannot be delivered as stems.',
		'Eine Mastering-Sequenz kann nicht als Einzelspuren ausgeliefert werden.',
	],
	// The export dialog asks what is delivered once, so its options name both the
	// form and the span in the same words. The queue still asks the two questions
	// separately and keeps the vocabulary above.
	['exportOutputStems', 'Individual stems (split by tracks)', 'Einzelspuren (nach Spuren getrennt)'],
	['exportOutputChapters', 'Chapters (split by labels)', 'Kapitel (nach Beschriftungen getrennt)'],
	['exportOutputLoop', 'In/Out (looping region)', 'In/Out (Loop-Bereich)'],
	['exportOutputNoLabels', 'Add labels to split the export into chapters.', 'Füge Beschriftungen hinzu, um den Export in Kapitel zu teilen.'],
]);

export const DELIVERY_QUEUE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(DELIVERY_QUEUE_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(DELIVERY_QUEUE_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
