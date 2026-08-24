/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FramescaperVideoProxyDialogModelInput {
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly missingSourceIds: readonly string[];
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
}

export interface FramescaperVideoProxyDialogSource {
	readonly id: string;
	readonly name: string;
	readonly attachmentPresent: boolean;
	readonly originalAuthorityKind: 'owned' | 'linked' | null;
	readonly originalAvailable: boolean;
	readonly projectBinClipId: string | null;
}

export interface FramescaperVideoProxyDialogModel {
	readonly supported: boolean;
	readonly sources: readonly Readonly<FramescaperVideoProxyDialogSource>[];
	readonly selectedSourceId: string | null;
	readonly mutationsDisabled: boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

export function createFramescaperVideoProxyDialogModel(
	input: FramescaperVideoProxyDialogModelInput,
): Readonly<FramescaperVideoProxyDialogModel> {
	const project = record(input.project);
	if (!project || (project.schemaVersion !== 20 && project.schemaVersion !== 27
		&& project.schemaVersion !== 28)) {
		return unsupported();
	}
	const sources = records(project.sources).filter((source) => (
		source.kind === 'video' && typeof source.id === 'string'
		&& Object.hasOwn(source, 'proxyAttachment')
	));
	const missing = new Set(input.missingSourceIds.filter((value) => typeof value === 'string'));
	const binClips = records(record(project.projectBin)?.clips);
	const modelSources = sources.map((source): Readonly<FramescaperVideoProxyDialogSource> => {
		const attachment = record(source.proxyAttachment);
		const binMatches = binClips.filter((clip) => (
			clip.kind === 'video' && clip.sourceId === source.id && typeof clip.id === 'string'
		));
		return Object.freeze({
			id: String(source.id),
			name: typeof source.name === 'string' && source.name ? source.name : String(source.id),
			attachmentPresent: source.proxyAttachment !== null,
			originalAuthorityKind: attachment?.originalAuthorityKind === 'owned'
				|| attachment?.originalAuthorityKind === 'linked'
				? attachment.originalAuthorityKind : null,
			originalAvailable: !missing.has(String(source.id)),
			projectBinClipId: binMatches.length === 1 ? String(binMatches[0]!.id) : null,
		});
	});
	const selectedClip = records(project.clips).find((clip) => clip.id === input.selectedClipId)
		?? binClips.find((clip) => clip.id === input.selectedClipId);
	const selectedSourceId = typeof selectedClip?.sourceId === 'string'
		&& modelSources.some(({ id }) => id === selectedClip.sourceId)
		? selectedClip.sourceId
		: modelSources[0]?.id ?? null;
	return Object.freeze({
		supported: true,
		sources: Object.freeze(modelSources),
		selectedSourceId,
		mutationsDisabled: input.editingBlocked || input.readOnly,
	});
}

function unsupported(): Readonly<FramescaperVideoProxyDialogModel> {
	return Object.freeze({
		supported: false,
		sources: Object.freeze([]),
		selectedSourceId: null,
		mutationsDisabled: true,
	});
}

function record(value: unknown): DataRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as DataRecord;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}
