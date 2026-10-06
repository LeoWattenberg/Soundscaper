/* SPDX-License-Identifier: AGPL-3.0-only */

interface DialogFocusOwnership {
	isCurrent(): boolean;
	release(): void;
}

const ownersByDocument = new WeakMap<Document, symbol[]>();

/** Only the newest modal surface may contain keyboard focus. */
export function retainAudioEditorDialogFocusOwner(document: Document): DialogFocusOwnership {
	const owners = ownersByDocument.get(document) ?? [];
	ownersByDocument.set(document, owners);
	const owner = Symbol('audio-editor-dialog-focus-owner');
	owners.push(owner);
	let retained = true;
	return {
		isCurrent: () => retained && owners.at(-1) === owner,
		release() {
			if (!retained) return;
			retained = false;
			const index = owners.indexOf(owner);
			if (index >= 0) owners.splice(index, 1);
			if (!owners.length) ownersByDocument.delete(document);
		},
	};
}
