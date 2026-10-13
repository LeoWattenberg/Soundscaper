/* SPDX-License-Identifier: AGPL-3.0-only */

/** A bounded observed set, not a claim that the browser retained every historical entry. */
export function observeApplicationResources(performance: Performance, Observer: typeof PerformanceObserver) {
	const entries = new Map<string, string>();
	let failure: Error | undefined;
	let disposed = false;
	const refuse = () => { failure ??= new Error('Used-asset resource observation overflow.'); };
	const accept = (list: readonly PerformanceEntry[]) => {
		if (disposed || failure) return;
		if (list.length > 4096) { refuse(); return; }
		for (const item of list) {
			const end = (item as PerformanceResourceTiming).responseEnd;
			if (item.entryType !== 'resource' || typeof item.name !== 'string' || item.name.length > 8192
				|| !Number.isFinite(item.startTime) || item.startTime < 0 || !Number.isFinite(item.duration) || item.duration < 0
				|| !Number.isFinite(end) || end < 0) {
				failure = new Error('Malformed used-asset resource observation.'); return;
			}
			if (end === 0) continue; // Not a completed resource with visible timing.
			const key = JSON.stringify([item.name, item.startTime, item.duration, end]);
			if (!entries.has(key) && entries.size === 4096) { refuse(); return; }
			entries.set(key, item.name);
		}
	};
	const observer = new Observer((list: PerformanceObserverEntryList, _observer: PerformanceObserver, options?: { droppedEntriesCount?: number }) => {
		// Absent droppedEntriesCount is unknown, never evidence of complete history.
		const dropped = options?.droppedEntriesCount;
		if (dropped !== undefined && (!Number.isSafeInteger(dropped) || dropped < 0)) {
			failure = new Error('Malformed used-asset dropped-entry count.');
		} else if (dropped !== undefined && dropped > 0) refuse();
		accept(list.getEntries());
	});
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		observer.disconnect();
		performance.removeEventListener('resourcetimingbufferfull', refuse);
	};
	try {
		performance.addEventListener('resourcetimingbufferfull', refuse);
		observer.observe({ type: 'resource', buffered: true });
		accept(performance.getEntriesByType('resource'));
	} catch (error) { dispose(); throw error; }
	return {
		read(): readonly string[] {
			if (disposed) throw new Error('Used-asset resource observation is closed.');
			accept(observer.takeRecords());
			accept(performance.getEntriesByType('resource'));
			if (failure) throw failure;
			return [...entries.values()];
		},
		dispose,
	};
}
