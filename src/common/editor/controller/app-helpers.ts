import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';

interface NamedFile {
	readonly name?: unknown;
	readonly type?: unknown;
}

interface GeneratorCopy {
	readonly silenceGenerator: string;
	readonly toneGenerator: string;
	readonly chirpGenerator: string;
	readonly noiseGenerator: string;
	readonly dtmfGenerator: string;
}

interface LabelExportResult {
	readonly text: string;
	readonly mimeType: string;
	readonly fileName: string;
	readonly [key: string]: unknown;
}

interface LabelFileService {
	saveFile(options: {
		readonly purpose: 'labels';
		readonly suggestedName: string;
		readonly mimeType: string;
		readonly blob: Blob;
	}): unknown;
}

interface CompatibilityItem {
	readonly disposition?: unknown;
	readonly code?: unknown;
	readonly [key: string]: unknown;
}

export interface Aup4CompatibilityReport {
	readonly schemaVersion: 1;
	readonly format: 'aup4';
	readonly direction: 'open' | 'save';
	readonly items: readonly CompatibilityItem[];
	readonly counts: Readonly<{
		preserved: number;
		converted: number;
		missing: number;
		omitted: number;
	}>;
	readonly [key: string]: unknown;
}

export function classifyMobile(): boolean {
	const navigatorValue = globalThis.navigator as Navigator & {
		readonly userAgentData?: { readonly mobile?: boolean };
	};
	if (navigatorValue?.userAgentData?.mobile != null) return Boolean(navigatorValue.userAgentData.mobile);
	return Boolean(
		navigatorValue?.maxTouchPoints > 0
		&& globalThis.matchMedia?.('(pointer: coarse)').matches
		&& Math.min(globalThis.innerWidth || 9999, globalThis.innerHeight || 9999) < 900,
	);
}

export function normalizeProjectSampleRate(value: unknown): number {
	const sampleRate = Number(value ?? AUDIO_EDITOR_SAMPLE_RATE);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000) return AUDIO_EDITOR_SAMPLE_RATE;
	return sampleRate;
}

export function historyEntrySummary(entry: unknown) {
	const entryRecord = objectRecord(entry);
	const command = objectRecord(entryRecord.command);
	const commands = command.type === 'batch' && Array.isArray(command.commands) ? command.commands : null;
	return Object.freeze({
		type: String(command.type || 'edit'),
		commandCount: commands?.length || 1,
		commands: Object.freeze((commands || [command]).map((item) => String(objectRecord(item).type || 'edit'))),
	});
}

export function formatBytes(value: unknown): string {
	if (!Number.isFinite(value)) return '—';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = Number(value);
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function isAup3File(file: NamedFile | null | undefined): boolean {
	return /\.aup3$/i.test(String(file?.name || '').trim());
}

export function isLegacyAupFile(file: NamedFile | null | undefined): boolean {
	return /\.aup$/i.test(String(file?.name || '').trim());
}

export function isLegacyBlockFile(file: NamedFile | null | undefined): boolean {
	return /\.au$/i.test(String(file?.name || '').trim());
}

export function isWavFile(file: NamedFile | null | undefined): boolean {
	const mimeType = String(file?.type || '').trim().toLowerCase();
	return /\.(?:wav|wave)$/i.test(String(file?.name || '').trim())
		|| ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'].includes(mimeType);
}

export function formatAup3Warning(warning: unknown): string {
	if (typeof warning === 'string') return warning.trim();
	const value = objectRecord(warning);
	if (value.message) return String(value.message).trim();
	if (value.code) return String(value.code).trim();
	return '';
}

export function generatorName(type: string, copy: GeneratorCopy): string {
	const names: Record<string, string> = {
		silence: copy.silenceGenerator,
		tone: copy.toneGenerator,
		chirp: copy.chirpGenerator,
		noise: copy.noiseGenerator,
		dtmf: copy.dtmfGenerator,
	};
	return names[type] || type;
}

export function stripExtension(name: unknown): string {
	return String(name || '').replace(/\.[^.]+$/, '');
}

export function labelMimeType(format: string): string {
	if (format === 'vtt') return 'text/vtt;charset=utf-8';
	if (format === 'srt') return 'application/x-subrip;charset=utf-8';
	return 'text/plain;charset=utf-8';
}

export function labelExportFileName(value: unknown, format: string): string {
	const base = stripExtension(String(value || 'labels')).replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').trim() || 'labels';
	return `${base}.${format}`;
}

export function ensureAup4FileName(value: unknown): string {
	const base = String(value || 'audacity-project').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').trim() || 'audacity-project';
	return /\.aup4$/i.test(base) ? base : `${base}.aup4`;
}

export function ensureScapeFileName(value: unknown): string {
	const base = String(value || 'project').trim() || 'project';
	return /\.scape$/i.test(base) ? base : `${base}.scape`;
}

export function normalizeAup4CompatibilityReport(report: unknown, direction: unknown): Aup4CompatibilityReport {
	const value = report && typeof report === 'object'
		? structuredClone(report) as Record<string, unknown>
		: {};
	const items = Array.isArray(value.items) ? value.items as CompatibilityItem[] : [];
	const suppliedCounts = objectRecord(value.counts);
	const count = (disposition: string): number => {
		const supplied = Number(suppliedCounts[disposition]);
		if (Number.isSafeInteger(supplied) && supplied >= 0) return supplied;
		return items.filter((item) => item?.disposition === disposition).length;
	};
	return Object.freeze({
		...value,
		schemaVersion: 1,
		format: 'aup4',
		direction: direction === 'open' ? 'open' : 'save',
		items: Object.freeze(items),
		counts: Object.freeze({
			preserved: count('preserved'),
			converted: count('converted'),
			missing: count('missing'),
			omitted: count('omitted'),
		}),
	});
}

export function aup4ReportHasMissingPcm(report: unknown): boolean {
	const value = objectRecord(report);
	if (Array.isArray(value.missingAudio) && value.missingAudio.length) return true;
	return Array.isArray(value.items)
		&& value.items.some((item) => objectRecord(item).code === 'MISSING_LOCAL_AUDIO');
}

export async function saveLabelExport(
	result: LabelExportResult,
	customSaver: ((value: LabelExportResult & { readonly blob: Blob }) => unknown) | null | undefined,
	fileService: LabelFileService | null | undefined,
): Promise<unknown> {
	const blob = new Blob([result.text], { type: result.mimeType });
	if (typeof customSaver === 'function') return customSaver({ ...result, blob });
	if (fileService?.saveFile) return fileService.saveFile({
		purpose: 'labels',
		suggestedName: result.fileName,
		mimeType: result.mimeType,
		blob,
	});
	if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) return { ...result, blob };
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = result.fileName;
		anchor.hidden = true;
		document.body?.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
	return { ...result, blob };
}

export function abortError(): DOMException | Error {
	return typeof DOMException === 'function'
		? new DOMException('Aborted', 'AbortError')
		: Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

export function throwIfAborted(signal: AbortSignal | null | undefined): void {
	if (signal?.aborted) throw abortError();
}

export function formatPlaybackRate(rate: unknown): string {
	return Number(rate).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}

function objectRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
