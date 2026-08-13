/* SPDX-License-Identifier: AGPL-3.0-only */

/** Start one bounded render ledger from stable enabled effect-instance IDs. */
export function beginVideoPreviewRenderLedger(layers, supportedEffectTypes) {
	if (!(supportedEffectTypes instanceof Set)) {
		throw new TypeError('Video preview supported effect types must be a Set.');
	}
	const effects = new Map();
	for (const layer of layers || []) {
		for (const entry of layer?.entries || []) {
			for (const effect of entry?.effects || []) {
				if (!effect || effect.enabled === false) continue;
				const id = boundedEffectId(effect.id);
				if (effects.has(id)) throw new Error(`Video preview effect instance ID ${id} is duplicate.`);
				effects.set(id, {
					entry,
					supported: supportedEffectTypes.has(effect.type),
					outcome: null,
				});
			}
		}
	}
	return { effects };
}

/** Mark every supported effect on one entry as semantically rendered. */
export function recordVideoPreviewEntryRendered(ledger, entry) {
	recordEntryOutcome(ledger, entry, 'rendered');
}

/** Mark a visible unprocessed-source fallback without calling it an omission. */
export function recordVideoPreviewEntryFallback(ledger, entry) {
	recordEntryOutcome(ledger, entry, 'fallbackRendered');
}

/** Freeze the exact requested/rendered/fallback/omitted partition for observers. */
export function completeVideoPreviewRenderLedger(
	ledger,
	renderedEntryCount,
	rendererStatus = 'available',
) {
	if (!Number.isSafeInteger(renderedEntryCount) || renderedEntryCount < 0) {
		throw new RangeError('Video preview rendered entry count must be a non-negative integer.');
	}
	if (rendererStatus !== 'available' && rendererStatus !== 'failed') {
		throw new TypeError('Video preview renderer status must be available or failed.');
	}
	const requested = [];
	const rendered = [];
	const fallbackRendered = [];
	const omitted = [];
	for (const [id, state] of ledger.effects) {
		requested.push(id);
		if (!state.supported || state.outcome === null) omitted.push(id);
		else if (state.outcome === 'rendered') rendered.push(id);
		else fallbackRendered.push(id);
	}
	const effects = Object.freeze({
		requested: Object.freeze(requested),
		rendered: Object.freeze(rendered),
		fallbackRendered: Object.freeze(fallbackRendered),
		omitted: Object.freeze(omitted),
	});
	return Object.freeze({
		status: rendererStatus === 'failed' || omitted.length || fallbackRendered.length
			? 'fallback'
			: 'rendered',
		rendererStatus,
		renderedEntryCount,
		effects,
	});
}

/** Produce a structured fallback report when the compositor cannot enter render. */
export function createVideoPreviewFallbackReport(layers, supportedEffectTypes) {
	const ledger = beginVideoPreviewRenderLedger(layers, supportedEffectTypes);
	for (const layer of layers || []) {
		for (const entry of layer?.entries || []) recordVideoPreviewEntryFallback(ledger, entry);
	}
	return completeVideoPreviewRenderLedger(ledger, 0, 'failed');
}

/**
 * Report renderer failure even when the layer set itself cannot produce a
 * ledger. Recovery paths call this instead of the strict report: throwing a
 * second time there abandons the render loop rather than reporting the failure.
 */
export function createVideoPreviewSafeFallbackReport(layers, supportedEffectTypes) {
	try {
		return createVideoPreviewFallbackReport(layers, supportedEffectTypes);
	} catch {
		return completeVideoPreviewRenderLedger({ effects: new Map() }, 0, 'failed');
	}
}

/** Preserve the old render-loop contract while reporting effect fallback separately. */
export function shouldContinueVideoPreviewPlayback(report, transportState) {
	return transportState === 'playing' && report?.rendererStatus === 'available';
}

function recordEntryOutcome(ledger, entry, outcome) {
	if (!ledger?.effects || !(ledger.effects instanceof Map)) {
		throw new TypeError('A video preview render ledger is required.');
	}
	for (const state of ledger.effects.values()) {
		if (state.entry === entry && state.supported) state.outcome = outcome;
	}
}

function boundedEffectId(value) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160) {
		throw new TypeError('Video preview effect instances require bounded stable IDs.');
	}
	return value;
}
