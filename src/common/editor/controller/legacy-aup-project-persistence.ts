/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;

interface ImportedSourceDescriptor extends Record<string, unknown> {
	readonly id: unknown;
	readonly name?: unknown;
	readonly mimeType?: unknown;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

interface ImportedProject extends Record<string, unknown> {
	readonly id: unknown;
	readonly sources: readonly ImportedSourceDescriptor[];
}

interface DecodedSourceAudio extends Record<string, unknown> {
	readonly sourceId: unknown;
	readonly channels?: unknown;
}

interface ImportedSourceWriter {
	write(channels: readonly Float32Array[]): Awaitable<unknown>;
	commit(metadata: Readonly<Record<string, unknown>>): Awaitable<unknown>;
	abort(): Awaitable<unknown>;
}

interface ImportedProjectStore {
	beginSourceWrite(sourceId: unknown, metadata: Readonly<Record<string, unknown>>): Awaitable<ImportedSourceWriter>;
	saveAnalysis(key: unknown, analysis: unknown): Awaitable<unknown>;
	deleteSource(sourceId: unknown): Promise<unknown>;
	saveProject(project: ImportedProject): Awaitable<unknown>;
	deleteProject(projectId: unknown): Promise<unknown>;
}

export interface PersistDecodedLegacyAupProjectOptions {
	readonly decoded: unknown;
	readonly assertCurrent?: () => void;
	readonly sourceChunkFrames: number;
	readonly copy: Readonly<{
		structuredProjectRequired: string;
		importedSourceDescriptorMissing: string;
		importedSourcePcmInvalid: string;
	}>;
	readonly generateWaveformPeaks: (channels: readonly Float32Array[], copy: unknown) => Awaitable<unknown>;
	readonly getProject: () => Readonly<{ id?: unknown }> | null | undefined;
	readonly peakCacheKey: (sourceId: unknown) => unknown;
	readonly preflightStorage: (bytes: number, purpose: string) => Awaitable<unknown>;
	readonly store: ImportedProjectStore;
	readonly switchProject: (project: ImportedProject, options: Readonly<{ save: false }>) => Awaitable<unknown>;
}

export async function persistDecodedLegacyAupProject({
	decoded,
	assertCurrent = () => undefined,
	sourceChunkFrames,
	copy,
	generateWaveformPeaks,
	getProject,
	peakCacheKey,
	preflightStorage,
	store,
	switchProject,
}: PersistDecodedLegacyAupProjectOptions): Promise<ImportedProject> {
	assertCurrent();
	const { project: importedProject, sources } = admitDecodedProject(decoded, copy.structuredProjectRequired);
	const sourceById = new Map(importedProject.sources.map((source) => [source.id, source]));
	const totalBytes = sources.reduce((sum, source) => sum + decodedSourceBytes(source), 0);
	await preflightStorage(totalBytes, 'import');
	assertCurrent();
	const persistedSourceIds: unknown[] = [];
	let projectSaved = false;
	try {
		for (const sourceAudio of sources) {
			assertCurrent();
			const source = sourceById.get(sourceAudio.sourceId);
			if (!source) {
				throw new Error(copy.importedSourceDescriptorMissing.replace('{source}', String(sourceAudio.sourceId)));
			}
			const channels = sourceAudio.channels;
			if (!Array.isArray(channels) || channels.length !== source.channelCount
				|| !channels.every((channel) => channel instanceof Float32Array && channel.length === source.frameCount)) {
				throw new Error(copy.importedSourcePcmInvalid.replace('{source}', String(source.name || source.id)));
			}
			const writer = await store.beginSourceWrite(source.id, {
				name: source.name,
				mimeType: source.mimeType,
				sampleRate: source.sampleRate,
				channelCount: source.channelCount,
				chunkFrames: sourceChunkFrames,
			});
			try {
				assertCurrent();
				for (let offset = 0; offset < source.frameCount; offset += sourceChunkFrames) {
					const end = Math.min(source.frameCount, offset + sourceChunkFrames);
					await writer.write(channels.map((channel) => channel.subarray(offset, end)));
					assertCurrent();
				}
				await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
				persistedSourceIds.push(source.id);
				assertCurrent();
				const peaks = await generateWaveformPeaks(channels, copy);
				assertCurrent();
				await store.saveAnalysis(peakCacheKey(source.id), peaks);
				assertCurrent();
			} catch (error) {
				await writer.abort();
				throw error;
			}
		}
		assertCurrent();
		await store.saveProject(importedProject);
		projectSaved = true;
		assertCurrent();
		await switchProject(importedProject, { save: false });
		return importedProject;
	} catch (error) {
		if (projectSaved && getProject()?.id !== importedProject.id) {
			await store.deleteProject(importedProject.id).catch(() => undefined);
		}
		if (getProject()?.id !== importedProject.id) {
			for (const sourceId of persistedSourceIds) await store.deleteSource(sourceId).catch(() => undefined);
		}
		throw error;
	}
}

function admitDecodedProject(
	value: unknown,
	requiredMessage: string,
): { project: ImportedProject; sources: readonly DecodedSourceAudio[] } {
	if (!isRecord(value) || !isRecord(value.project) || !Array.isArray(value.project.sources)
		|| !Array.isArray(value.sources)) {
		throw new TypeError(requiredMessage);
	}
	return {
		project: value.project as ImportedProject,
		sources: value.sources as readonly DecodedSourceAudio[],
	};
}

function decodedSourceBytes(source: DecodedSourceAudio): number {
	if (!Array.isArray(source?.channels)) return 0;
	return source.channels.reduce((sum, channel) => (
		sum + (ArrayBuffer.isView(channel) ? channel.byteLength : 0)
	), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
