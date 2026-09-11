/* SPDX-License-Identifier: AGPL-3.0-only */

const CD_FRAMES_PER_SECOND = 75;
const DEFAULT_MAX_INPUT_CHARS = 16 * 1024 * 1024;
const DEFAULT_MAX_CUES = 4_096;

export interface AudioEditorCuePoint {
	readonly number: number;
	readonly title: string;
	readonly performer: string;
	readonly positionFrame: number;
}

export interface AudioEditorCueSheet {
	readonly title: string;
	readonly performer: string;
	readonly cues: readonly AudioEditorCuePoint[];
}

export interface AudioEditorCueParseOptions {
	readonly sampleRate: number;
	readonly maxInputChars?: number;
	readonly maxCues?: number;
}

export class AudioEditorCueImportError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(message: string, code = 'INVALID_CUE_FILE', details: Readonly<Record<string, unknown>> = {}) {
		super(message);
		this.name = 'AudioEditorCueImportError';
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}

interface PendingTrack {
	readonly number: number;
	readonly audio: boolean;
	readonly file: string | null;
	title: string;
	performer: string;
	index01: number | null;
	line: number;
}

/** Parse the single-file AUDIO program represented by a CUE sheet. */
export function parseAudioEditorCueSheet(
	input: string | Uint8Array | ArrayBuffer,
	options: AudioEditorCueParseOptions,
): AudioEditorCueSheet {
	const sampleRate = positiveSafeInteger(options?.sampleRate, 'sampleRate');
	const maxInputChars = positiveSafeInteger(options?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS, 'maxInputChars');
	const maxCues = positiveSafeInteger(options?.maxCues ?? DEFAULT_MAX_CUES, 'maxCues');
	const text = normalizeInput(input, maxInputChars);
	let albumTitle = '';
	let albumPerformer = '';
	let activeFile: string | null = null;
	let track: PendingTrack | null = null;
	let audioFile: string | null | undefined;
	const cues: AudioEditorCuePoint[] = [];
	const trackNumbers = new Set<number>();

	const finishTrack = () => {
		if (!track?.audio) {
			track = null;
			return;
		}
		if (track.index01 === null) {
			throw cueError('An AUDIO track is missing INDEX 01.', 'MISSING_INDEX', {
				line: track.line,
				track: track.number,
			});
		}
		if (audioFile === undefined) audioFile = track.file;
		else if (track.file !== audioFile) {
			throw cueError('CUE sheets spanning multiple files cannot be placed on one timeline.', 'MULTI_FILE_UNSUPPORTED', {
				line: track.line,
				track: track.number,
			});
		}
		if (cues.length >= maxCues) {
			throw cueError('The CUE sheet exceeds the configured track limit.', 'CUE_LIMIT', { limit: maxCues });
		}
		const previous = cues.at(-1);
		const positionFrame = Math.round(track.index01 * sampleRate / CD_FRAMES_PER_SECOND);
		if (previous && positionFrame < previous.positionFrame) {
			throw cueError('CUE track indexes must be chronological.', 'NON_CHRONOLOGICAL_INDEX', {
				line: track.line,
				track: track.number,
			});
		}
		cues.push(Object.freeze({
			number: track.number,
			title: track.title || `Track ${String(track.number).padStart(2, '0')}`,
			performer: track.performer || albumPerformer,
			positionFrame,
		}));
		track = null;
	};

	const lines = text.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const line = lines[index]!.trim();
		if (!line || /^REM(?:\s|$)/iu.test(line)) continue;
		const command = line.match(/^(\S+)(?:\s+(.*))?$/u);
		if (!command) continue;
		const keyword = command[1]!.toUpperCase();
		const value = command[2] ?? '';
		if (keyword === 'FILE') {
			finishTrack();
			activeFile = cueFileName(value, lineNumber);
			continue;
		}
		if (keyword === 'TRACK') {
			finishTrack();
			const match = value.match(/^(\d{1,3})\s+(\S+)$/u);
			if (!match) throw cueError('A CUE TRACK directive is malformed.', 'INVALID_TRACK', { line: lineNumber });
			const number = Number(match[1]);
			if (number < 1 || number > 999 || trackNumbers.has(number)) {
				throw cueError('CUE track numbers must be unique positive integers.', 'INVALID_TRACK', {
					line: lineNumber,
					track: number,
				});
			}
			trackNumbers.add(number);
			track = {
				number,
				audio: match[2]!.toUpperCase() === 'AUDIO',
				file: activeFile,
				title: '',
				performer: '',
				index01: null,
				line: lineNumber,
			};
			continue;
		}
		if (keyword === 'TITLE') {
			const title = cueText(value, lineNumber, 'TITLE');
			if (track) track.title = title;
			else albumTitle = title;
			continue;
		}
		if (keyword === 'PERFORMER') {
			const performer = cueText(value, lineNumber, 'PERFORMER');
			if (track) track.performer = performer;
			else albumPerformer = performer;
			continue;
		}
		if (keyword === 'INDEX' && track?.audio) {
			const match = value.match(/^(\d{2})\s+(\S+)$/u);
			if (!match) throw cueError('A CUE INDEX directive is malformed.', 'INVALID_INDEX', { line: lineNumber });
			if (match[1] !== '01') continue;
			if (track.index01 !== null) {
				throw cueError('An AUDIO track has more than one INDEX 01.', 'DUPLICATE_INDEX', { line: lineNumber });
			}
			track.index01 = parseCdFrame(match[2]!, lineNumber);
		}
	}
	finishTrack();
	return Object.freeze({
		title: albumTitle,
		performer: albumPerformer,
		cues: Object.freeze(cues),
	});
}

function normalizeInput(input: string | Uint8Array | ArrayBuffer, maximum: number): string {
	let text: string;
	if (typeof input === 'string') text = input;
	else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(input);
		} catch (error) {
			throw cueError('CUE data is not valid UTF-8.', 'INVALID_UTF8', {}, error);
		}
	} else throw new TypeError('CUE data must be a string, Uint8Array, or ArrayBuffer.');
	if (text.length > maximum) throw cueError('CUE data exceeds the configured input limit.', 'INPUT_LIMIT', { limit: maximum });
	if (text.includes('\0')) throw cueError('CUE data contains a NUL character.', 'INVALID_CHARACTER');
	return text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

function cueFileName(value: string, line: number): string {
	const match = value.match(/^("[^"]+"|\S+)\s+\S+$/u);
	if (!match) throw cueError('A CUE FILE directive is malformed.', 'INVALID_FILE', { line });
	return cueText(match[1]!, line, 'FILE');
}

function cueText(value: string, line: number, directive: string): string {
	const trimmed = value.trim();
	const text = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
		? trimmed.slice(1, -1)
		: trimmed;
	if (!text || (trimmed.startsWith('"') !== trimmed.endsWith('"'))) {
		throw cueError(`A CUE ${directive} directive is malformed.`, `INVALID_${directive}`, { line });
	}
	return text;
}

function parseCdFrame(value: string, line: number): number {
	const match = value.match(/^(\d+):([0-5]\d):([0-7]\d)$/u);
	if (!match || Number(match[3]) >= CD_FRAMES_PER_SECOND) {
		throw cueError('A CUE timestamp must use MM:SS:FF with 75 frames per second.', 'INVALID_TIMESTAMP', {
			line,
			value,
		});
	}
	const frames = (Number(match[1]) * 60 + Number(match[2])) * CD_FRAMES_PER_SECOND + Number(match[3]);
	if (!Number.isSafeInteger(frames)) throw cueError('A CUE timestamp is too large.', 'INVALID_TIMESTAMP', { line, value });
	return frames;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function cueError(
	message: string,
	code: string,
	details: Readonly<Record<string, unknown>> = {},
	cause?: unknown,
): AudioEditorCueImportError {
	const error = new AudioEditorCueImportError(message, code, details);
	if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
	return error;
}
