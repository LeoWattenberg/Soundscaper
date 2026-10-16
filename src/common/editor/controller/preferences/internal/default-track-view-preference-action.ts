/* SPDX-License-Identifier: AGPL-3.0-only */

interface ViewChange {
	readonly view: unknown;
	readonly previousView: unknown;
	readonly previous: ViewChange | null;
	status: 'pending' | 'saved' | 'failed';
}

/** Retain optimistic live views only when their preference write succeeds. */
export function createDefaultTrackViewPreferenceAction(dependencies: Readonly<{
	getTimelineView(): unknown;
	setTimelineView(view: unknown): unknown;
	updatePreferences(changes: unknown): unknown;
}>) {
	let lastChange: ViewChange | null = null;
	let pending = 0;
	return (view: unknown): Promise<unknown> => {
		const previousView = dependencies.getTimelineView();
		// Validation still throws synchronously before changing the live view.
		const updated = dependencies.updatePreferences({ appearance: { defaultView: view } });
		const change: ViewChange = {
			view, previousView,
			previous: lastChange?.view === previousView ? lastChange : null,
			status: 'pending',
		};
		lastChange = change;
		pending += 1;
		dependencies.setTimelineView(view);
		return Promise.resolve(updated).then((result) => {
			change.status = 'saved';
			return result;
		}, (error: unknown) => {
			change.status = 'failed';
			if (lastChange === change && dependencies.getTimelineView() === view) {
				let restoredView = change.previousView;
				let previous = change.previous;
				while (previous?.status === 'failed') {
					restoredView = previous.previousView;
					previous = previous.previous;
				}
				dependencies.setTimelineView(restoredView);
			}
			throw error;
		}).finally(() => {
			pending -= 1;
			if (pending === 0) lastChange = null;
		});
	};
}
