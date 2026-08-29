/* SPDX-License-Identifier: AGPL-3.0-only */

interface DialogEscapeOwner {
	readonly id: symbol;
	readonly onEscape: () => void;
}

interface DialogEscapeOwnership {
	readonly owners: DialogEscapeOwner[];
	readonly listener: (event: KeyboardEvent) => void;
}

const ownershipByDocument = new WeakMap<Document, DialogEscapeOwnership>();

/**
 * Retain Escape ownership for an open editor dialog. A document gets one
 * listener, so a single key event can dismiss only the newest eligible owner.
 */
export function retainAudioEditorDialogEscapeOwner(
	document: Document,
	onEscape: () => void,
): () => void {
	let ownership = ownershipByDocument.get(document);
	if (!ownership) {
		const owners: DialogEscapeOwner[] = [];
		const listener = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			const owner = owners.at(-1);
			if (!owner) return;
			event.preventDefault();
			owner.onEscape();
		};
		ownership = { owners, listener };
		ownershipByDocument.set(document, ownership);
		document.addEventListener('keydown', listener);
	}

	const owner = { id: Symbol('audio-editor-dialog-escape-owner'), onEscape };
	ownership.owners.push(owner);
	let retained = true;
	return () => {
		if (!retained) return;
		retained = false;
		const current = ownershipByDocument.get(document);
		if (!current) return;
		const ownerIndex = current.owners.findIndex((candidate) => candidate.id === owner.id);
		if (ownerIndex >= 0) current.owners.splice(ownerIndex, 1);
		if (current.owners.length > 0) return;
		document.removeEventListener('keydown', current.listener);
		ownershipByDocument.delete(document);
	};
}
