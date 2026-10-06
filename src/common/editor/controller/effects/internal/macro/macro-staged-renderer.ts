/* SPDX-License-Identifier: AGPL-3.0-only */

export type MacroSnapshotRenderer<Buffer> = (
	project: unknown,
	range: Readonly<Record<string, unknown>>,
	sources?: unknown,
	signal?: AbortSignal | null,
	chunkSources?: unknown,
	prepareTimePitchCaches?: boolean,
) => Promise<Buffer>;

/** Staged PCM has no document identity or time/pitch clips to prepare. */
export function createMacroStagedRenderer<Buffer>(renderSnapshot: MacroSnapshotRenderer<Buffer>) {
	return (project: unknown, range: Readonly<Record<string, unknown>>, sources: ReadonlyMap<string, unknown>) => (
		renderSnapshot(project, range, sources, null, null, false)
	);
}
