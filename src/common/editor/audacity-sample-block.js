const SAMPLE_FORMAT = Object.freeze({
	INT16: 0x00020001,
	INT24: 0x00040001,
	FLOAT32: 0x0004000f,
});

const DEFAULT_MAX_SAMPLES = 128 * 1024 * 1024;

/** Decode the PCM payload shared by AUP3 and AUP4 sample-block rows. */
export function decodeAudacitySampleBlock(input, sampleFormat, options = {}) {
	const bytes = toBytes(input);
	const format = Number(sampleFormat);
	const bytesPerSample = format >>> 16;
	if (![SAMPLE_FORMAT.INT16, SAMPLE_FORMAT.INT24, SAMPLE_FORMAT.FLOAT32].includes(format)) {
		throw sampleBlockError(`Unsupported Audacity sample format: 0x${format.toString(16)}.`, 'UNSUPPORTED_SAMPLE_FORMAT');
	}
	if (!bytesPerSample || bytes.byteLength % bytesPerSample !== 0) {
		throw sampleBlockError('An Audacity sample block has an invalid byte length.', 'INVALID_SAMPLE_BLOCK');
	}
	const sampleCount = bytes.byteLength / bytesPerSample;
	const requestedLimit = Number(options.maxSamples);
	const maxSamples = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
		? requestedLimit
		: DEFAULT_MAX_SAMPLES;
	if (!Number.isSafeInteger(sampleCount) || sampleCount > maxSamples) {
		throw sampleBlockError('An Audacity sample block is too large to decode in this browser.', 'PROJECT_TOO_LARGE');
	}
	const result = new Float32Array(sampleCount);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0, offset = 0; index < result.length; index += 1, offset += bytesPerSample) {
		if (format === SAMPLE_FORMAT.INT16) result[index] = view.getInt16(offset, true) / 32768;
		else if (format === SAMPLE_FORMAT.INT24) result[index] = view.getInt32(offset, true) / 8388608;
		else {
			const value = view.getFloat32(offset, true);
			result[index] = Number.isFinite(value) ? value : 0;
		}
	}
	return result;
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value)) return Uint8Array.from(value);
	throw new TypeError('Audacity sample data must be bytes.');
}

function sampleBlockError(message, code) {
	const error = new Error(message);
	error.name = 'AudacitySampleBlockError';
	error.code = code;
	return error;
}
