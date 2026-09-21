/* SPDX-License-Identifier: AGPL-3.0-only */

export function changedContentRelinkClassification(source: object): 'changed-content' {
	if (Object.hasOwn(source, 'provenance')) {
		throw new Error(
			'Import the selected file as new media to preserve attribution; '
			+ 'changed-content relink is unavailable for an attributed source.',
		);
	}
	return 'changed-content';
}
