import { releaseDownloadObjectUrl } from '../../object-url-revoke.ts';
import { AUDIO_EDITOR_SAMPLE_RATE } from '../../project.js';

export type InspectorCopy = Readonly<Record<string, string>>;

export interface InspectorSaveFileRequest {
	readonly purpose: string;
	readonly suggestedName: string;
	readonly mimeType?: string;
	readonly text: string;
}

export interface InspectorFileService {
	readonly saveFile: (request: InspectorSaveFileRequest) => unknown;
}

export function parseJsonObject(value: unknown, label: string, copy: InspectorCopy): Record<string, unknown> {
	const text = String(value || '').trim();
	if (!text) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RangeError(copy.mustBeValidJson.replace('{label}', label));
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new RangeError(copy.mustBeJsonObject.replace('{label}', label));
	}
	return parsed as Record<string, unknown>;
}

export function parseJsonChannelMapping(
	value: unknown,
	label: string,
	copy: InspectorCopy,
): readonly unknown[] | Record<string, unknown> {
	const text = String(value || '').trim();
	if (!text) throw new RangeError(copy.channelMatrixRequired.replace('{label}', label));
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RangeError(copy.mustBeValidJson.replace('{label}', label));
	}
	const parsedRecord = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: null;
	if (!Array.isArray(parsed) && !Array.isArray(parsedRecord?.channels)) {
		throw new RangeError(copy.channelMatrixShape.replace('{label}', label));
	}
	return parsed as readonly unknown[] | Record<string, unknown>;
}

export function compactFields<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item != null && String(item) !== ''),
	) as Partial<T>;
}

export function macroFileName(value: unknown): string {
	return String(value || 'macro')
		.trim()
		.replace(/[^a-z0-9_-]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		|| 'macro';
}

export async function downloadTextFile(
	text: string,
	name: string,
	fileService?: InspectorFileService | null,
	purpose = 'report',
): Promise<unknown> {
	if (fileService?.saveFile) return fileService.saveFile({
		purpose,
		suggestedName: name,
		mimeType: 'text/plain;charset=utf-8',
		text,
	});
	const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
	if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) {
		return { method: 'blob', fileName: name, size: blob.size };
	}
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.hidden = true;
		// A detached anchor downloads nothing in browsers that require the click
		// target to be in the document, which is why the file service attaches
		// its own and why this fallback has to as well.
		document.body?.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		releaseDownloadObjectUrl(url, {
			revoke: (value) => { URL.revokeObjectURL(value); },
			setTimer: globalThis.setTimeout?.bind(globalThis),
		});
	}
	return { method: 'download', fileName: name, size: blob.size };
}

export function createFallbackFileService(): InspectorFileService {
	return {
		saveFile: ({ text, suggestedName, purpose }) => downloadTextFile(text, suggestedName, null, purpose),
	};
}

export function secondsInputToFrames(
	value: unknown,
	copy: InspectorCopy,
	sampleRate = AUDIO_EDITOR_SAMPLE_RATE,
): number {
	const parts = String(value).trim().split(':').map(Number);
	if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) {
		throw new RangeError(copy.invalidTimeValue);
	}
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return Math.round(seconds * sampleRate);
}

export function nonNegativeFrame(value: unknown, copy: InspectorCopy): number {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(copy.invalidFrameValue);
	return frame;
}

export function framesToSecondsText(frames: unknown, sampleRate = AUDIO_EDITOR_SAMPLE_RATE): string {
	return (Number(frames || 0) / sampleRate).toFixed(3);
}

export function linearToDb(value: unknown): number {
	return Number(value) > 0 ? 20 * Math.log10(Number(value)) : -60;
}

export function dbToLinear(value: unknown, maximum: number, copy: InspectorCopy): number {
	const db = Number(value);
	if (!Number.isFinite(db) || db < -60 || db > (maximum === 4 ? 12 : 24)) {
		throw new RangeError(copy.invalidGainValue);
	}
	return Math.max(0, Math.min(maximum, 10 ** (db / 20)));
}

export function formatDb(value: number | null | undefined, unit: string): string {
	return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : `−∞ ${unit}`;
}

export function formatLoudness(value: number | null | undefined, unit: string): string {
	return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : '—';
}

export function bitrateOption(value: number): Readonly<{ value: string; label: string }> {
	return { value: String(value), label: `${value} kbps` };
}
