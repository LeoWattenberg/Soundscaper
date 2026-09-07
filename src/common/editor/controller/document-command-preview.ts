/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep preview validation on the authored revision that produced a command view. */
export function createDocumentCommandPreview<Document extends object, View extends object, Command, Result>(
	getDocument: () => Document,
	getView: () => View,
	applyCommand: (document: Document, command: Command) => Result,
) {
	const owners = new WeakMap<View, Document>();
	return Object.freeze({
		getProject(): View {
			const document = getDocument();
			const view = getView();
			owners.set(view, document);
			return view;
		},
		previewCommand(view: View, command: Command): Result {
			const document = owners.get(view);
			if (!document || document !== getDocument()) throw new Error('Command preview project changed.');
			return applyCommand(document, command);
		},
	});
}
