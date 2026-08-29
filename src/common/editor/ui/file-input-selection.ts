/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Read a file picker's selection and re-arm the control in one step.
 *
 * A file input raises `change` only when its value changes, so a picker that
 * keeps the previous selection cannot be handed the same file twice. That is
 * exactly the second attempt someone makes after an import reports a failure,
 * or after they edit the file on disk and pick it again under the name they
 * already chose, and a picker that ignores it looks like a dead control.
 *
 * Clearing has to happen as the selection is read rather than after the import
 * it started has succeeded, because the failed import is the case that needs
 * the retry. The chosen files survive the clear, so reading and re-arming
 * together costs the caller nothing.
 */

interface FilePickerElement {
	files?: ArrayLike<File> | null;
	value?: string;
}

/** Every chosen file, leaving the control ready to raise `change` again. */
export function takeSelectedFiles(input: FilePickerElement | null | undefined): readonly File[] {
	if (!input) return [];
	const files = input.files ? Array.from(input.files) : [];
	input.value = '';
	return files;
}

/** The single chosen file, leaving the control ready to raise `change` again. */
export function takeSelectedFile(input: FilePickerElement | null | undefined): File | null {
	return takeSelectedFiles(input)[0] ?? null;
}
