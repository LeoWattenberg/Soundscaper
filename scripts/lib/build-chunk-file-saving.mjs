/* SPDX-License-Identifier: AGPL-3.0-only */

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const fileSavingChunkGroups = [
	{
		// Picker preparation, staged native writes and delayed download delivery
		// are shared file operations independent of read, codec and editor services.
		name: 'editor-file-saving',
		test: /src[\\/]common[\\/]editor[\\/](?:browser-file-save-service|file-save-stream|object-url-revoke)\.ts$/,
		priority: 99, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
	},
	{
		// Portable ZIP framing, byte digests, bounded document serialization and
		// output destinations do not own timeline sources or PCM encoding.
		name: 'editor-scape-archive-bytes',
		test: /src[\\/]common[\\/]editor[\\/]scape-(?:abort|byte-stream|export-estimate|export-destination|archive-zip-profile|photo-catalog-pack|project-document|project-json-preflight)\.ts$/,
		priority: 99, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
	},
];
