/* SPDX-License-Identifier: AGPL-3.0-only */

/* Dedicated sandbox preload: exposes no global API and imports no editor/runtime surface. */
const { ipcRenderer } = require('electron');

const CONNECT_CHANNEL = 'framescaper:external-display:v1:connect';
const CLOSE_CHANNEL = 'framescaper:external-display:v1:close';
const FRAME_BYTES_MAXIMUM = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
let port = null;
let lastSequence = -1;
let canvas = null;
let chain = Promise.resolve();
let closing = false;

window.addEventListener('DOMContentLoaded', () => {
	const element = document.getElementById('programme');
	if (!(element instanceof HTMLCanvasElement)) return requestClose('frame-refused');
	canvas = element;
});

window.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape') return;
	event.preventDefault();
	requestClose('escape-key');
});

window.addEventListener('pagehide', () => {
	closing = true;
	port?.close();
	port = null;
}, { once: true });

ipcRenderer.on(CONNECT_CHANNEL, (event, value) => {
	try {
		exactRecord(value, ['version', 'pixelFormat', 'colorSpace'], 'sink handshake');
		if (value.version !== 1 || value.pixelFormat !== 'rgba8' || value.colorSpace !== 'srgb'
			|| !Array.isArray(event.ports) || event.ports.length !== 1 || port !== null) {
			throw new TypeError('The external-display sink handshake is invalid.');
		}
		port = event.ports[0];
		port.onmessage = (message) => {
			chain = chain.then(() => present(message.data)).catch(() => requestClose('frame-refused'));
		};
		port.onmessageerror = () => requestClose('frame-refused');
		port.onclose = () => { if (!closing) requestClose('port-loss'); };
		port.start();
	} catch {
		requestClose('frame-refused');
	}
});

async function present(value) {
	exactRecord(value, [
		'version', 'type', 'sequence', 'evaluationFingerprint', 'width', 'height',
		'dynamicRange', 'rgbaSha256', 'rgba',
	], 'sink frame');
	if (value.version !== 1 || value.type !== 'frame' || value.dynamicRange !== 'sdr'
		|| !Number.isSafeInteger(value.sequence) || value.sequence <= lastSequence
		|| !SHA256.test(value.evaluationFingerprint) || !SHA256.test(value.rgbaSha256)) {
		throw new TypeError('The external-display sink frame identity is invalid.');
	}
	const width = dimension(value.width);
	const height = dimension(value.height);
	const byteLength = width * height * 4;
	if (!Number.isSafeInteger(byteLength) || byteLength > FRAME_BYTES_MAXIMUM
		|| !(value.rgba instanceof Uint8Array) || value.rgba.byteLength !== byteLength) {
		throw new RangeError('The external-display sink frame geometry is invalid.');
	}
	const digest = hex(await crypto.subtle.digest('SHA-256', value.rgba));
	if (digest !== value.rgbaSha256) throw new Error('The external-display sink frame digest is invalid.');
	if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The external-display sink canvas is unavailable.');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
	if (context === null) throw new Error('The external-display sink canvas context is unavailable.');
	context.putImageData(new ImageData(new Uint8ClampedArray(value.rgba), width, height), 0, 0);
	lastSequence = value.sequence;
	port.postMessage(Object.freeze({
		version: 1, type: 'presented', sequence: value.sequence, sha256: value.rgbaSha256,
	}));
}

function requestClose(reason) {
	if (closing) return;
	closing = true;
	try { port?.close(); } catch { /* already lost */ }
	port = null;
	ipcRenderer.send(CLOSE_CHANNEL, Object.freeze({ reason }));
}

function dimension(value) {
	if (!Number.isSafeInteger(value) || value < 1 || value > 32_768) {
		throw new RangeError('The external-display sink dimension is invalid.');
	}
	return value;
}

function exactRecord(value, fields, label) {
	const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : [];
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The external-display ${label} has unsupported fields.`);
	}
}

function hex(value) {
	return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
