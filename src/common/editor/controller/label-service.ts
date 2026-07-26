/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddLabelTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { parseAudioEditorLabels, serializeAudioEditorLabels } from '../label-io.js';
import {
	labelExportFileName,
	labelMimeType,
	stripExtension,
} from './app-helpers.ts';
import {
	EditorProjectChangedError,
	type EditorControllerLifetime,
	type EditorProjectGeneration,
	type EditorProjectToken,
	type EditorTaskScope,
} from './lifecycle.ts';

export interface LabelValue extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly color: string;
}

export interface LabelTrack extends Readonly<Record<string, unknown>> {
	readonly type: 'label';
	readonly id: string;
	readonly name: string;
	readonly labels: readonly LabelValue[];
}

export interface LabelProjectDocument {
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly (LabelTrack | Readonly<Record<string, unknown>>)[];
}

export interface LabelServiceState {
	importing: boolean;
	selectedTrackId: string | null;
}

export interface LabelServiceCopy {
	readonly labelTrackMissing: string;
	readonly labels: string;
	readonly labelsExported: string;
	readonly labelsImported: string;
	readonly labelsImportEmpty: string;
	readonly labelsImporting: string;
}

export interface LabelInputFile {
	readonly name: string;
	arrayBuffer?(): Promise<ArrayBuffer>;
	text?(): Promise<string>;
}

export interface LabelImportOptions {
	readonly format?: string;
	readonly name?: unknown;
	readonly strict?: boolean;
}

export interface LabelExportOptions {
	readonly download?: boolean;
	readonly fileName?: unknown;
	readonly format?: unknown;
	readonly trackIds?: readonly string[];
}

export interface LabelImportResult {
	readonly format: string;
	readonly labels: readonly LabelValue[];
	readonly warnings: readonly unknown[];
	readonly trackId: string;
}

export interface LabelExportResult {
	readonly format: string;
	readonly fileName: string;
	readonly mimeType: string;
	readonly text: string;
	readonly labelCount: number;
	readonly trackIds: readonly string[];
	readonly cancelled?: true;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface LabelServiceDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: EditorProjectGeneration;
	readonly state: LabelServiceState;
	readonly copy: LabelServiceCopy;
	getProject(): LabelProjectDocument;
	editingBlocked(): boolean;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	setStatus(message: string, state?: string): void;
	publish(): void;
	saveExport(result: LabelExportResult): Promise<unknown> | unknown;
}

export interface LabelService {
	importLabelFile(file: LabelInputFile | null | undefined, options?: LabelImportOptions): Promise<LabelImportResult | null>;
	exportLabels(options?: LabelExportOptions): Promise<LabelExportResult>;
}

interface ParsedLabels {
	readonly format: string;
	readonly labels: readonly LabelValue[];
	readonly warnings: readonly unknown[];
}

export function createLabelService(dependencies: LabelServiceDependencies): Readonly<LabelService> {
	let importGeneration = 0;

	return Object.freeze({ importLabelFile, exportLabels });

	async function importLabelFile(
		file: LabelInputFile | null | undefined,
		options: LabelImportOptions = {},
	): Promise<LabelImportResult | null> {
		dependencies.lifetime.assertActive();
		if (!file || dependencies.editingBlocked()) return null;
		const ownership = captureOwnership('labels:import');
		const generation = ++importGeneration;
		dependencies.state.importing = true;
		dependencies.publish();
		dependencies.setStatus(dependencies.copy.labelsImporting);
		try {
			const data = await readLabelFile(file);
			assertOwnership(ownership);
			const parsed = parseAudioEditorLabels(data, {
				filename: file.name,
				format: options.format,
				sampleRate: ownership.project.sampleRate,
				strict: options.strict,
				idFactory: () => dependencies.createId('label'),
			}) as ParsedLabels;
			if (!parsed.labels.length) throw new Error(dependencies.copy.labelsImportEmpty);
			const trackId = dependencies.createId('label-track');
			const trackName = String(
				options.name || stripExtension(file.name) || dependencies.copy.labels,
			).trim();
			assertOwnership(ownership);
			dependencies.commit(createAddLabelTrackCommand({
				id: trackId,
				name: trackName,
				labels: parsed.labels,
			}), { selectTrackId: trackId });
			dependencies.setStatus(
				dependencies.copy.labelsImported.replace('{count}', String(parsed.labels.length)),
				parsed.warnings.length ? 'info' : 'success',
			);
			return { ...parsed, trackId };
		} finally {
			ownership.task.finish();
			if (generation === importGeneration) {
				dependencies.state.importing = false;
				if (!dependencies.lifetime.inactive) dependencies.publish();
			}
		}
	}

	async function exportLabels(options: LabelExportOptions = {}): Promise<LabelExportResult> {
		dependencies.lifetime.assertActive();
		const ownership = captureOwnership('labels:export');
		try {
			const requestedIds = Array.isArray(options.trackIds) ? new Set(options.trackIds) : null;
			let tracks = ownership.project.tracks
				.filter(isLabelTrack)
				.filter((track) => !requestedIds || requestedIds.has(track.id));
			const selected = tracks.find((track) => track.id === dependencies.state.selectedTrackId);
			if (!requestedIds && selected) tracks = [selected];
			if (!tracks.length) throw new Error(dependencies.copy.labelTrackMissing);
			const format = String(options.format || 'txt').toLowerCase().replace(/^\./u, '');
			const labels = tracks.flatMap((track) => track.labels);
			const text = String(serializeAudioEditorLabels(labels, {
				format,
				sampleRate: ownership.project.sampleRate,
			}));
			const result = Object.freeze({
				format,
				fileName: labelExportFileName(options.fileName || ownership.project.title, format),
				mimeType: labelMimeType(format),
				text,
				labelCount: labels.length,
				trackIds: Object.freeze(tracks.map((track) => track.id)),
			});
			const saved = options.download !== false
				? await dependencies.saveExport(result)
				: null;
			assertOwnership(ownership);
			if (isCancelledSave(saved)) return { ...result, cancelled: true };
			dependencies.setStatus(
				dependencies.copy.labelsExported.replace('{count}', String(labels.length)),
				'success',
			);
			return result;
		} finally {
			ownership.task.finish();
		}
	}

	function captureOwnership(name: string): Readonly<{
		project: LabelProjectDocument;
		projectToken: EditorProjectToken;
		task: EditorTaskScope;
	}> {
		const project = dependencies.getProject();
		const projectToken = dependencies.projectGeneration.capture(project.id);
		const task = dependencies.lifetime.startTask(name);
		return Object.freeze({ project, projectToken, task });
	}

	function assertOwnership(ownership: Readonly<{
		project: LabelProjectDocument;
		projectToken: EditorProjectToken;
		task: EditorTaskScope;
	}>): void {
		ownership.task.assertCurrent();
		dependencies.projectGeneration.assertCurrent(ownership.projectToken);
		if (dependencies.getProject() !== ownership.project) throw new EditorProjectChangedError();
	}
}

function isLabelTrack(track: Readonly<Record<string, unknown>>): track is LabelTrack {
	return track.type === 'label'
		&& typeof track.id === 'string'
		&& typeof track.name === 'string'
		&& Array.isArray(track.labels);
}

async function readLabelFile(file: LabelInputFile): Promise<ArrayBuffer | string> {
	if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
	if (typeof file.text === 'function') return file.text();
	throw new TypeError('A readable label file is required.');
}

function isCancelledSave(value: unknown): value is Readonly<{ cancelled: true }> {
	return typeof value === 'object' && value !== null && 'cancelled' in value && value.cancelled === true;
}
