export const AUDIO_EDITOR_LABEL_FORMATS = Object.freeze(['txt', 'srt', 'vtt']);

const FORMAT_SET = new Set(AUDIO_EDITOR_LABEL_FORMATS);
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_MAX_INPUT_CHARS = 16 * 1024 * 1024;
const DEFAULT_MAX_LABELS = 100_000;
const DEFAULT_MAX_TITLE_CHARS = 1_000_000;
const DEFAULT_MAX_TOTAL_TITLE_CHARS = 8 * 1024 * 1024;
const TIME_ARROW = /\s+-->\s+/;

/** Error with machine-readable context for a malformed label file. */
export class AudioEditorLabelIoError extends Error {
	constructor(message, code = 'INVALID_LABEL_FILE', details = {}) {
		super(message);
		this.name = 'AudioEditorLabelIoError';
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}

/**
 * Detect label interchange format from an explicit format, filename, or text.
 * Explicit values always win so a caller never has to rely on content sniffing.
 */
export function detectAudioEditorLabelFormat(options = {}) {
	if (typeof options === 'string') options = { filename: options };
	const explicit = String(options.format || '').trim().toLowerCase().replace(/^\./, '');
	if (explicit) return assertFormat(explicit);
	const match = String(options.filename || '').trim().toLowerCase().match(/\.([^.]+)$/);
	if (match && FORMAT_SET.has(match[1])) return match[1];
	const text = stripBom(String(options.text || '')).trimStart();
	if (/^WEBVTT(?:\s|$)/i.test(text)) return 'vtt';
	if (/^(?:\d+\s*\r?\n)?\s*\d{1,}:\d{2}:\d{2}[,.]\d{1,3}\s+-->\s+/m.test(text)) return 'srt';
	return 'txt';
}

/**
 * Parse Audacity TXT, SubRip, or WebVTT into materialized V2 label values.
 * The result is deliberately UI-agnostic and safe for localized Unicode text.
 */
export function parseAudioEditorLabels(input, options = {}) {
	const text = normalizeInput(input, options);
	const format = detectAudioEditorLabelFormat({ ...options, text });
	const context = createParseContext(options, format);
	const entries = format === 'txt'
		? parseTxtEntries(text, context)
		: parseTimedEntries(text, context, format);
	const labels = entries.map((entry, index) => materializeLabel(entry, index, context));
	const ids = new Set();
	for (const label of labels) {
		if (ids.has(label.id)) throw labelError('Imported labels contain duplicate IDs.', 'DUPLICATE_LABEL_ID', { id: label.id });
		ids.add(label.id);
	}
	return Object.freeze({
		format,
		labels: Object.freeze(labels),
		warnings: Object.freeze(context.warnings),
	});
}

export function parseAudacityLabelsTxt(input, options = {}) {
	return parseAudioEditorLabels(input, { ...options, format: 'txt' });
}

export function parseSubRipLabels(input, options = {}) {
	return parseAudioEditorLabels(input, { ...options, format: 'srt' });
}

export function parseWebVttLabels(input, options = {}) {
	return parseAudioEditorLabels(input, { ...options, format: 'vtt' });
}

/** Serialize V2 label values to Audacity TXT, SubRip, or WebVTT. */
export function serializeAudioEditorLabels(labels, options = {}) {
	const format = detectAudioEditorLabelFormat(options);
	const context = createSerializeContext(options, format);
	const normalized = normalizeLabels(labels, context);
	if (format === 'txt') return serializeTxt(normalized, context);
	return serializeTimed(normalized, context, format);
}

export function serializeAudacityLabelsTxt(labels, options = {}) {
	return serializeAudioEditorLabels(labels, { ...options, format: 'txt' });
}

export function serializeSubRipLabels(labels, options = {}) {
	return serializeAudioEditorLabels(labels, { ...options, format: 'srt' });
}

export function serializeWebVttLabels(labels, options = {}) {
	return serializeAudioEditorLabels(labels, { ...options, format: 'vtt' });
}

function normalizeInput(input, options) {
	let text;
	if (typeof input === 'string') text = input;
	else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(input);
		} catch (error) {
			throw labelError('Label data is not valid UTF-8.', 'INVALID_UTF8', {}, error);
		}
	} else {
		throw new TypeError('Label data must be a string, Uint8Array, or ArrayBuffer.');
	}
	const maxInputChars = positiveSafeInteger(options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS, 'maxInputChars');
	if (text.length > maxInputChars) {
		throw labelError('Label data exceeds the configured input limit.', 'INPUT_LIMIT', {
			limit: maxInputChars,
			actual: text.length,
		});
	}
	if (text.includes('\0')) throw labelError('Label data contains a NUL character.', 'INVALID_CHARACTER');
	return stripBom(text).replace(/\r\n?/g, '\n');
}

function createParseContext(options, format) {
	return {
		format,
		sampleRate: positiveSafeInteger(options.sampleRate ?? DEFAULT_SAMPLE_RATE, 'sampleRate'),
		maxLabels: positiveSafeInteger(options.maxLabels ?? DEFAULT_MAX_LABELS, 'maxLabels'),
		maxTitleChars: positiveSafeInteger(options.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS, 'maxTitleChars'),
		maxTotalTitleChars: positiveSafeInteger(options.maxTotalTitleChars ?? DEFAULT_MAX_TOTAL_TITLE_CHARS, 'maxTotalTitleChars'),
		totalTitleChars: 0,
		idFactory: typeof options.idFactory === 'function' ? options.idFactory : (index) => `label-${index + 1}`,
		color: nonEmptyString(options.color ?? 'auto', 'color'),
		strict: options.strict !== false,
		warnings: [],
	};
}

function createSerializeContext(options, format) {
	return {
		format,
		sampleRate: positiveSafeInteger(options.sampleRate ?? DEFAULT_SAMPLE_RATE, 'sampleRate'),
		maxLabels: positiveSafeInteger(options.maxLabels ?? DEFAULT_MAX_LABELS, 'maxLabels'),
		maxTitleChars: positiveSafeInteger(options.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS, 'maxTitleChars'),
		lineEnding: options.lineEnding === '\r\n' ? '\r\n' : '\n',
		includeBom: Boolean(options.includeBom),
		includeCueIdentifiers: format === 'srt' || options.includeCueIdentifiers !== false,
	};
}

function parseTxtEntries(text, context) {
	const entries = [];
	const lines = text.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim()) continue;
		if (line.startsWith('\\')) {
			const previous = entries.at(-1);
			if (!previous) {
				recoverableError(context, 'A TXT continuation has no preceding label.', 'ORPHAN_CONTINUATION', { line: index + 1 });
				continue;
			}
			const fields = line.split('\t');
			if (fields[0] === '\\' && fields.length >= 3) {
				const minimumFrequency = parseFiniteNumber(fields[1]);
				const maximumFrequency = parseFiniteNumber(fields[2]);
				if (minimumFrequency != null && maximumFrequency != null && minimumFrequency >= 0 && maximumFrequency >= minimumFrequency) {
					previous.frequencyRange = { minimumFrequency, maximumFrequency };
				} else {
					recoverableError(context, 'A TXT frequency continuation is malformed.', 'INVALID_CONTINUATION', { line: index + 1 });
				}
			} else if (fields[0] === '\\') recoverableError(context, 'A TXT continuation is malformed.', 'INVALID_CONTINUATION', { line: index + 1 });
			continue;
		}
		try {
			assertCanAddLabel(entries, context, index + 1);
			const fields = line.split('\t');
			if (fields.length < 2) throw labelError('A TXT label needs a time and title.', 'INVALID_TXT_ROW', { line: index + 1 });
			const startSeconds = requiredSeconds(fields[0], { line: index + 1, field: 'start' });
			const possibleEnd = parseFiniteNumber(fields[1]);
			const endSeconds = possibleEnd == null ? startSeconds : requiredSeconds(fields[1], { line: index + 1, field: 'end' });
			const title = possibleEnd == null ? fields.slice(1).join('\t') : fields.slice(2).join('\t');
			entries.push(validateEntry({ startSeconds, endSeconds, title, line: index + 1 }, context));
		} catch (error) {
			handleEntryError(error, context, { line: index + 1 });
		}
	}
	return entries;
}

function parseTimedEntries(text, context, format) {
	const lines = text.split('\n');
	let index = 0;
	if (format === 'vtt') {
		if (!/^WEBVTT(?:[ \t].*)?$/i.test(lines[0] || '')) {
			throw labelError('A WebVTT file must begin with WEBVTT.', 'MISSING_WEBVTT_HEADER', { line: 1 });
		}
		index = 1;
		while (index < lines.length && lines[index].trim()) index += 1;
	}
	const entries = [];
	while (index < lines.length) {
		while (index < lines.length && !lines[index].trim()) index += 1;
		if (index >= lines.length) break;
		const cueStartLine = index + 1;
		if (format === 'vtt' && /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[index])) {
			while (index < lines.length && lines[index].trim()) index += 1;
			continue;
		}
		let identifier = null;
		if (!TIME_ARROW.test(lines[index])) identifier = lines[index++].trim();
		if (index >= lines.length || !TIME_ARROW.test(lines[index])) {
			const error = labelError('A subtitle cue is missing its timing line.', 'MISSING_CUE_TIMING', { line: cueStartLine });
			handleEntryError(error, context, { line: cueStartLine });
			while (index < lines.length && lines[index].trim()) index += 1;
			continue;
		}
		const timingLine = lines[index++];
		const titleLines = [];
		while (index < lines.length && lines[index].trim()) titleLines.push(lines[index++]);
		try {
			assertCanAddLabel(entries, context, cueStartLine);
			const timing = parseCueTiming(timingLine, format, cueStartLine + (identifier == null ? 0 : 1));
			entries.push(validateEntry({
				...timing,
				title: titleLines.join('\n'),
				identifier,
				line: cueStartLine,
			}, context));
		} catch (error) {
			handleEntryError(error, context, { line: cueStartLine });
		}
	}
	return entries;
}

function parseCueTiming(line, format, lineNumber) {
	const parts = line.split(TIME_ARROW);
	if (parts.length !== 2) throw labelError('A subtitle timing line must contain one arrow.', 'INVALID_CUE_TIMING', { line: lineNumber });
	const startToken = parts[0].trim();
	const endToken = parts[1].trim().split(/[ \t]+/, 1)[0];
	return {
		startSeconds: parseTimestamp(startToken, format, lineNumber),
		endSeconds: parseTimestamp(endToken, format, lineNumber),
	};
}

function parseTimestamp(value, format, line) {
	const separator = format === 'srt' ? ',' : '\\.';
	const expression = format === 'vtt'
		? new RegExp(`^(?:(\\d+):)?([0-5]\\d):([0-5]\\d)${separator}(\\d{1,3})$`)
		: new RegExp(`^(\\d+):([0-5]\\d):([0-5]\\d)${separator}(\\d{1,3})$`);
	const match = value.match(expression);
	if (!match) throw labelError('A subtitle timestamp is malformed.', 'INVALID_TIMESTAMP', { line, value });
	let hours;
	let minutes;
	let seconds;
	let fraction;
	if (format === 'vtt') {
		hours = Number(match[1] || 0);
		minutes = Number(match[2]);
		seconds = Number(match[3]);
		fraction = match[4];
	} else {
		hours = Number(match[1]);
		minutes = Number(match[2]);
		seconds = Number(match[3]);
		fraction = match[4];
	}
	const milliseconds = Number(fraction.padEnd(3, '0'));
	const result = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
	if (!Number.isFinite(result)) throw labelError('A subtitle timestamp is outside the supported range.', 'INVALID_TIMESTAMP', { line, value });
	return result;
}

function validateEntry(entry, context) {
	if (entry.endSeconds < entry.startSeconds) {
		throw labelError('A label end cannot precede its start.', 'REVERSED_RANGE', { line: entry.line });
	}
	if (entry.title.length > context.maxTitleChars) {
		throw labelError('A label title exceeds the configured limit.', 'TITLE_LIMIT', {
			line: entry.line,
			limit: context.maxTitleChars,
			actual: entry.title.length,
		});
	}
	context.totalTitleChars += entry.title.length;
	if (context.totalTitleChars > context.maxTotalTitleChars) {
		throw labelError('Label titles exceed the configured total limit.', 'TOTAL_TITLE_LIMIT', {
			line: entry.line,
			limit: context.maxTotalTitleChars,
		});
	}
	return entry;
}

function materializeLabel(entry, index, context) {
	const startFrame = secondsToFrame(entry.startSeconds, context.sampleRate, entry.line);
	const endFrame = secondsToFrame(entry.endSeconds, context.sampleRate, entry.line);
	const id = nonEmptyString(String(context.idFactory(index, Object.freeze({ ...entry, startFrame, endFrame }))), `label ID at index ${index}`);
	const opaqueExtensions = {};
	if (entry.identifier) opaqueExtensions.cueIdentifier = entry.identifier;
	if (entry.frequencyRange) opaqueExtensions.frequencyRange = Object.freeze({ ...entry.frequencyRange });
	return Object.freeze({
		id,
		title: entry.title,
		startFrame,
		endFrame: Math.max(startFrame, endFrame),
		color: context.color,
		opaqueExtensions: Object.freeze(opaqueExtensions),
	});
}

function normalizeLabels(labels, context) {
	if (!Array.isArray(labels)) throw new TypeError('labels must be an array.');
	if (labels.length > context.maxLabels) {
		throw labelError('The label count exceeds the configured limit.', 'LABEL_COUNT_LIMIT', { limit: context.maxLabels, actual: labels.length });
	}
	return labels.map((label, index) => {
		if (!label || typeof label !== 'object') throw new TypeError(`labels[${index}] must be an object.`);
		const startFrame = nonNegativeSafeInteger(label.startFrame, `labels[${index}].startFrame`);
		const endFrame = nonNegativeSafeInteger(label.endFrame ?? startFrame, `labels[${index}].endFrame`);
		if (endFrame < startFrame) throw labelError('A label end cannot precede its start.', 'REVERSED_RANGE', { index });
		const title = String(label.title ?? '');
		if (title.includes('\0')) throw labelError('A label title contains a NUL character.', 'INVALID_CHARACTER', { index });
		if (title.length > context.maxTitleChars) {
			throw labelError('A label title exceeds the configured limit.', 'TITLE_LIMIT', { index, limit: context.maxTitleChars, actual: title.length });
		}
		return { ...label, startFrame, endFrame, title };
	});
}

function serializeTxt(labels, context) {
	const lines = [];
	for (const label of labels) {
		const title = singleLineTxtTitle(label.title);
		lines.push(`${formatFrameSeconds(label.startFrame, context.sampleRate)}\t${formatFrameSeconds(label.endFrame, context.sampleRate)}\t${title}`);
		const frequency = label.opaqueExtensions?.frequencyRange;
		if (frequency && isValidFrequencyRange(frequency)) lines.push(`\\\t${frequency.minimumFrequency}\t${frequency.maximumFrequency}`);
	}
	return withEncodingOptions(lines.join(context.lineEnding) + (lines.length ? context.lineEnding : ''), context);
}

function serializeTimed(labels, context, format) {
	const lines = format === 'vtt' ? ['WEBVTT', ''] : [];
	labels.forEach((label, index) => {
		if (context.includeCueIdentifiers) lines.push(String(format === 'srt' ? index + 1 : label.opaqueExtensions?.cueIdentifier || index + 1));
		lines.push(`${formatTimestamp(label.startFrame, context.sampleRate, format)} --> ${formatTimestamp(label.endFrame, context.sampleRate, format)}`);
		const titleLines = label.title.replace(/\r\n?/g, '\n').split('\n');
		lines.push(...titleLines, '');
	});
	let text = lines.join(context.lineEnding);
	if (format === 'vtt' && labels.length === 0) text += context.lineEnding;
	return withEncodingOptions(text, context);
}

function formatTimestamp(frame, sampleRate, format) {
	const totalMilliseconds = Math.round(frame * 1000 / sampleRate);
	const milliseconds = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	const separator = format === 'srt' ? ',' : '.';
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

function formatFrameSeconds(frame, sampleRate) {
	if (frame === 0) return '0';
	const text = (frame / sampleRate).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
	return text === '-0' ? '0' : text;
}

function secondsToFrame(seconds, sampleRate, line) {
	const frame = Math.round(seconds * sampleRate);
	if (!Number.isSafeInteger(frame) || frame < 0) {
		throw labelError('A label time is outside the supported frame range.', 'TIME_RANGE', { line, seconds, sampleRate });
	}
	return frame;
}

function requiredSeconds(value, details) {
	const number = parseFiniteNumber(value);
	if (number == null || number < 0) throw labelError('A label time must be a non-negative number.', 'INVALID_TIME', { ...details, value });
	return number;
}

function parseFiniteNumber(value) {
	const token = String(value ?? '').trim();
	if (!token || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) return null;
	const number = Number(token);
	return Number.isFinite(number) ? number : null;
}

function assertCanAddLabel(entries, context, line) {
	if (entries.length >= context.maxLabels) {
		throw labelError('The label count exceeds the configured limit.', 'LABEL_COUNT_LIMIT', { line, limit: context.maxLabels });
	}
}

function handleEntryError(error, context, details) {
	if (!(error instanceof AudioEditorLabelIoError)) throw error;
	if (context.strict) throw error;
	context.warnings.push(Object.freeze({ code: error.code, message: error.message, ...error.details, ...details }));
}

function recoverableError(context, message, code, details) {
	handleEntryError(labelError(message, code, details), context, details);
}

function labelError(message, code, details = {}, cause) {
	const error = new AudioEditorLabelIoError(message, code, details);
	if (cause !== undefined) error.cause = cause;
	return error;
}

function singleLineTxtTitle(title) {
	return title.replace(/[\t\r\n]+/g, ' ');
}

function isValidFrequencyRange(value) {
	return Number.isFinite(value.minimumFrequency)
		&& Number.isFinite(value.maximumFrequency)
		&& value.minimumFrequency >= 0
		&& value.maximumFrequency >= value.minimumFrequency;
}

function withEncodingOptions(text, context) {
	return context.includeBom ? `\uFEFF${text}` : text;
}

function stripBom(value) {
	return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

function assertFormat(value) {
	if (!FORMAT_SET.has(value)) throw new RangeError(`Unsupported label format: ${value}.`);
	return value;
}

function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}
