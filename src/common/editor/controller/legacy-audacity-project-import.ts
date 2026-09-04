/* SPDX-License-Identifier: AGPL-3.0-only */

/** The runtime a legacy Audacity project import reads. */
export interface LegacyAudacityImportRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = LegacyAudacityImportRuntime[string];

/**
 * Import an Audacity 2.x `.aup` project and the data files beside it.
 *
 * The import runs long enough that the user can switch projects underneath it, and each
 * awaited stage would then persist decoded sources into whichever project is open now. So
 * every stage re-asserts that the project it started on is still the current one, and the
 * import fails rather than writing into the wrong project.
 */
export function createLegacyAudacityProjectImport(runtime: LegacyAudacityImportRuntime) {
	const {
		assertProject, captureProject, convertLegacyAupToProject, copy, createStableId,
		decodeLegacyAupProject, formatLegacyAupWarning, generateWaveformPeaks, getProject,
		peakCacheKey, persistDecodedLegacyAupProject, preflightStorage, reportProgress,
		setStatus, sourceChunkFrames, store, stripExtension, switchProject,
	} = runtime;

	function captureImportProjectCurrentAssertion(message: string) {
		const hasProjectIdentity = typeof getProject === 'function';
		const startingProjectId = hasProjectIdentity ? getProject()?.id ?? null : null;
		const hasProjectToken = typeof captureProject === 'function' && typeof assertProject === 'function';
		const startingProjectToken = hasProjectToken ? captureProject() : null;
		return () => {
			try { if (hasProjectToken) assertProject(startingProjectToken); }
			catch (error) { throw new Error(message, { cause: error }); }
			if (hasProjectIdentity && (getProject()?.id ?? null) !== startingProjectId) throw new Error(message);
		};
	}

	function updateProgress(progress: RuntimeValue) {
		const rawValue = typeof progress === 'number'
			? progress
			: Number(progress?.progress ?? progress?.value);
		if (!Number.isFinite(rawValue)) return;
		const percentage = rawValue <= 1 ? rawValue * 100 : rawValue;
		reportProgress(percentage / 100);
		setStatus(`${copy.aupImporting} ${Math.max(0, Math.min(100, Math.round(percentage)))}%`);
	}

	return async function importLegacyAudacityProject(
		file: RuntimeValue, legacyDataFiles: RuntimeValue = [],
	) {
		const assertImportProjectCurrent = captureImportProjectCurrentAssertion(
			'The project changed during Audacity project import.',
		);
		assertImportProjectCurrent();
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		assertImportProjectCurrent();
		setStatus(copy.aupImporting);
		const structure = await decodeLegacyAupProject(file, legacyDataFiles, { onProgress: updateProgress });
		assertImportProjectCurrent();
		const decoded = await convertLegacyAupToProject(structure, {
			title: stripExtension(file.name),
			projectId: createStableId('project'),
		});
		assertImportProjectCurrent();
		const importedProject = await persistDecodedLegacyAupProject({
			decoded,
			assertCurrent: assertImportProjectCurrent,
			sourceChunkFrames,
			copy,
			generateWaveformPeaks,
			getProject,
			peakCacheKey,
			preflightStorage,
			store,
			switchProject,
		});
		const detail = decoded.warnings.map(formatLegacyAupWarning).filter(Boolean).join(' ');
		return {
			project: importedProject,
			warnings: decoded.warnings,
			notice: detail ? `${copy.aupImported} ${detail}` : copy.aupImported,
		};
	};
}
