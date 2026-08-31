/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from './lifecycle.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import type { ScapeArchiveByteSource } from '../scape-archive-byte-source.ts';
import type { ProjectFileExtension } from '../../project-file-extensions.ts';
import type { ProjectFlushOptions } from './project-save-service.ts';

export type NativeAwaitable<Value> = PromiseLike<Value> | Value;
export type NativeSaveState = 'dirty' | 'saved' | 'saving' | string;
export type NativeStatusState = 'error' | 'info' | 'success';

export interface NativeStorageEstimate {
	readonly usage: number | null;
	readonly quota: number | null;
}

export interface NativeProjectAudioSource {
	/** V2 audio sources predate the explicit `kind` discriminator. */
	readonly kind?: 'audio';
	readonly id: string;
	readonly storageKey?: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

export interface NativeProjectVideoSource {
	readonly kind: 'video';
	readonly id: string;
	readonly storageKey?: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
}

export type NativeProjectSource = NativeProjectAudioSource | NativeProjectVideoSource;

export interface NativeProjectClip {
	readonly id: string;
	readonly kind?: string;
	readonly sourceId: string;
}

export interface NativeProjectDocument {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly sources: readonly NativeProjectSource[];
	readonly clips: readonly NativeProjectClip[];
	readonly [extension: string]: unknown;
}

export interface NativeProjectState {
	importing: boolean;
	saveState: NativeSaveState;
	readOnly: boolean;
	mobile: boolean;
}

export interface NativeProjectCopy {
	readonly projectNotFound: string;
	readonly projectReadOnly: string;
	readonly missingSourcesPreventSave: string;
	readonly projectSaved: string;
	readonly futureProjectReadOnly: string;
	readonly chooseAup4File: string;
	readonly aup4Validating: string;
	readonly importing: string;
	readonly oversizedAup4ReadOnly: string;
	readonly newerAup4ReadOnly: string;
	readonly aup4Opened: string;
	readonly aup4OnlyV2: string;
	readonly aup4Saving: string;
	readonly sourcePcmUnavailable: string;
	readonly aup4Saved: string;
}

export type NativeProjectFile = Blob & Readonly<{ name: string }>;
export type NativeScapeProjectFile = NativeProjectFile | ScapeArchiveByteSource;

export interface NativeSourceWriter {
	write(channels: readonly Float32Array[]): NativeAwaitable<unknown>;
	commit(metadata: Readonly<{
		sampleRate: number;
		channelCount: number;
	}>): NativeAwaitable<unknown>;
	abort(): NativeAwaitable<unknown>;
}

export interface NativeProjectStore {
	estimateStorage(): Promise<Readonly<{ usage?: number; quota?: number }>>;
	beginSourceWrite(sourceId: string, metadata: Readonly<{
		name: string;
		mimeType: string;
		sampleRate: number;
		channelCount: number;
		chunkFrames: number;
	}>): Promise<NativeSourceWriter>;
	deleteSource(sourceId: string): PromiseLike<unknown> | unknown;
}

export interface NativeFileSaveRequest {
	readonly purpose: 'project';
	readonly blob: Blob;
	readonly suggestedName: string;
	readonly mimeType: string;
	readonly target?: unknown;
	readonly useFileSystemAccess?: boolean;
	readonly signal: AbortSignal;
}

export interface NativeSavedFile extends Readonly<Record<string, unknown>> {
	readonly cancelled?: boolean;
}

export interface NativeCancelledSave {
	readonly mode: 'cancelled';
	readonly cancelled: true;
	readonly fileName: string;
}

export interface NativeBlobSave {
	readonly mode: 'blob';
	readonly fileName: string;
	readonly target: unknown;
}

export interface NativeDirectSave {
	readonly mode: 'stream';
	createWritable(maximumBytes: number): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Promise<NativeSavedFile>;
	abort(reason?: unknown): Promise<void>;
}

export type NativePreparedSave = NativeCancelledSave | NativeBlobSave | NativeDirectSave;

/** One `showSaveFilePicker` file type: a description and its MIME/suffix map. */
export interface NativeProjectFileType {
	readonly description: string;
	readonly accept: Readonly<Record<string, readonly string[]>>;
}

export interface NativeProjectFileService {
	readonly isDesktop: boolean;
	chooseSaveTarget(request: Readonly<{
		purpose: 'aup4';
		suggestedName: string;
		mimeType: string;
	}>): Promise<unknown>;
	prepareSave(request: Readonly<{
		purpose: 'project';
		suggestedName: string;
		mimeType: string;
		target?: unknown;
		types: readonly NativeProjectFileType[];
		useFileSystemAccess: boolean;
		signal: AbortSignal;
	}>): Promise<NativePreparedSave>;
	saveFile(request: NativeFileSaveRequest): Promise<NativeSavedFile>;
}

export interface NativeProgress {
	readonly value?: number;
}

export interface Aup4CompatibilityIssue {
	readonly code?: string;
	readonly level?: string;
	readonly message?: string;
}

export interface Aup4Validation extends Readonly<Record<string, unknown>> {
	readonly issues?: readonly Aup4CompatibilityIssue[];
	readonly compatibilityReport?: unknown;
}

export interface Aup4OpenedProject {
	readonly readOnly: boolean;
	readonly validation?: Aup4Validation;
}

export interface Aup4DecodedSource {
	readonly sourceId: string;
	readonly channels: readonly Float32Array[];
}

export interface Aup4DecodedProject {
	readonly project: unknown;
	readonly sources: readonly Aup4DecodedSource[];
	readonly warnings?: readonly string[];
	readonly validation?: Aup4Validation;
	readonly compatibilityReport?: unknown;
}

export interface Aup4Environment extends Readonly<Record<string, unknown>> {
	readonly opfs?: boolean;
}

export interface Aup4PortableOptions {
	readonly mobile: boolean;
	readonly opfs?: boolean;
	readonly quota?: number;
	readonly usage?: number;
	readonly workingBytes: number;
	readonly onProgress: (progress: NativeProgress) => void;
}

export interface Aup4SnapshotSource {
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
}

export interface Aup4ExportResult extends Readonly<Record<string, unknown>> {
	readonly bytes?: Uint8Array;
	readonly mimeType?: string;
	readonly validation?: Aup4Validation;
	readonly compatibilityReport?: unknown;
}

export interface Aup4SnapshotResult extends Readonly<Record<string, unknown>> {
	readonly compatibilityReport?: unknown;
}

export interface NativeAup4Client {
	initialize(): Promise<Aup4Environment>;
	create(projectId: string): PromiseLike<unknown> | unknown;
	openFile(projectId: string, file: NativeProjectFile, options: Aup4PortableOptions): Promise<Aup4OpenedProject>;
	decode(projectId: string, options: Readonly<{
		title: string;
		onProgress: (progress: NativeProgress) => void;
	}>): Promise<Aup4DecodedProject>;
	writeSnapshot(
		projectId: string,
		project: NativeProjectDocument,
		sources: AsyncIterable<Aup4SnapshotSource>,
		options: Aup4PortableOptions,
	): Promise<Aup4SnapshotResult>;
	commit(projectId: string): PromiseLike<unknown> | unknown;
	export(projectId: string, options: Aup4PortableOptions): Promise<Aup4ExportResult>;
	inspect(projectId: string): Promise<Aup4Validation>;
	delete?(projectId: string): PromiseLike<unknown> | unknown;
	close?(projectId: string): PromiseLike<unknown> | unknown;
	dispose?(): PromiseLike<unknown> | unknown;
}

export interface NativeCompatibilityReport extends Readonly<Record<string, unknown>> {
	readonly direction: 'open' | 'save';
}

export interface ScapeImportResult extends Readonly<Record<string, unknown>> {
	readonly project: NativeProjectDocument;
	readonly readOnly: boolean;
	readonly reason?: string | null;
	readonly manifest: Readonly<Record<string, unknown>>;
}

export interface ScapeExportResult {
	readonly blob: Blob | null;
	readonly byteLength?: number;
	readonly manifest: Readonly<Record<string, unknown>>;
}

export interface NativeSessionTab {
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NativeAudioBuffer {
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

export interface NativeProjectServiceRuntime {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly state: NativeProjectState;
	readonly copy: NativeProjectCopy;
	readonly store: NativeProjectStore;
	readonly fileService: NativeProjectFileService;
	readonly taskProgress?: EditorTaskProgressCoordinator;
	readonly getProject: () => NativeProjectDocument | null;
	readonly switchProject: (project: NativeProjectDocument, options: Readonly<{
		readOnly?: boolean;
		readOnlyReason?: string | null;
		skipFlush?: boolean;
		save?: boolean;
		preserveScapeOpenRequest?: boolean;
	}>) => PromiseLike<unknown> | unknown;
	readonly editingBlocked: () => boolean;
	readonly flushProject: (options?: ProjectFlushOptions) => PromiseLike<unknown> | unknown;
	readonly hasMissingTimelineSources: (
		project: NativeProjectDocument,
		options?: Readonly<{ audioOnly?: boolean }>,
	) => boolean;
	readonly estimateStorageForPreflight: (
		requiredBytes: number,
		operation: 'export' | 'import',
		signal?: AbortSignal,
	) => NativeAwaitable<Readonly<NativeStorageEstimate>>;
	readonly preflightStorage: (requiredBytes: number, operation: 'export' | 'import') => PromiseLike<unknown> | unknown;
	readonly createStableId: (prefix: string) => string;
	readonly ensureAup4FileName: (value: unknown) => string;
	/** The project suffix this product writes; every accepted suffix still opens. */
	readonly projectFileExtension: ProjectFileExtension;
	readonly ensureProjectFileName: (value: unknown, extension: unknown) => string;
	readonly sourcePcmBytes: (source: NativeProjectAudioSource) => number;
	readonly loadStoredSourceChannels: (
		store: NativeProjectStore,
		source: NativeProjectAudioSource,
	) => Promise<readonly Float32Array[] | null>;
	readonly requestAup4FileHandle: (options: Readonly<{ fileName: string }>) => Promise<unknown>;
	readonly saveAup4Result: (result: Aup4ExportResult, options: Readonly<{
		fileName: string;
		fileHandle?: unknown;
		fileService: NativeProjectFileService;
		saveTarget?: unknown;
	}>) => Promise<NativeSavedFile>;
	readonly createAup4Client: (options: Readonly<Record<string, unknown>>) => NativeAup4Client;
	readonly initialAup4Client?: NativeAup4Client | null;
	readonly aup4Options?: Readonly<Record<string, unknown>>;
	readonly adaptAudacityProject?: (value: unknown) => NativeAwaitable<NativeProjectDocument>;
	readonly prepareAudacityProjectExport?: (
		project: NativeProjectDocument,
	) => NativeAwaitable<NativeProjectDocument>;
	readonly loadProject: (value: unknown) => Readonly<{ project: NativeProjectDocument }>;
	readonly importScapeProject: (
		file: NativeScapeProjectFile,
		store: NativeProjectStore,
		options: Readonly<{
			collision: string;
			estimateStorageForPreflight: (
				requiredBytes: number,
				operation: 'import',
			) => NativeAwaitable<Readonly<NativeStorageEstimate>>;
			signal: AbortSignal;
		}>,
	) => Promise<ScapeImportResult>;
	readonly exportScapeProject: (
		project: NativeProjectDocument,
		store: NativeProjectStore,
		options: Readonly<{
			createWritable?: (maximumBytes: number) => Promise<WritableStream<Uint8Array>>;
			signal: AbortSignal;
		}>,
	) => Promise<ScapeExportResult>;
	readonly copyFutureScapeArchive: (
		input: Blob,
		write: (bytes: Uint8Array) => void | PromiseLike<void>,
		options: Readonly<{ signal: AbortSignal }>,
	) => Promise<Readonly<{ byteLength: number; schemaVersion: number }>>;
	readonly normalizeCompatibilityReport: (
		report: unknown,
		direction: 'open' | 'save',
	) => NativeCompatibilityReport;
	readonly reportHasMissingPcm: (report: unknown) => boolean;
	readonly sessionTab: (projectId: string) => NativeSessionTab | null;
	readonly updateProjectMetadata: (projectId: string, metadata: Readonly<Record<string, unknown>>) => void;
	readonly setStatus: (message: string, state?: NativeStatusState) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly sourceBuffers: ReadonlyMap<string, NativeAudioBuffer>;
	readonly sourceChunkFrames: number;
	readonly scapeMimeType: string;
}

export interface OpenScapeOptions {
	readonly collision?: string;
	readonly signal?: AbortSignal;
}

export interface SaveScapeOptions {
	readonly saveCopy?: boolean;
	readonly fileName?: string;
	readonly saveTarget?: unknown;
	readonly useFileSystemAccess?: boolean;
}

export interface SaveAup4Options {
	readonly saveCopy?: boolean;
	readonly fileName?: string;
	readonly fileHandle?: unknown;
	readonly saveTarget?: unknown;
	readonly useFileSystemAccess?: boolean;
}
