/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 4_096;
const MAX_REQUEST_TARGET_LENGTH = 2_048;
const AUTH_COOKIE = 'web_vcr_fixture_auth=authorized';
const FIXTURE_ROOT = new URL('../../tests/fixtures/web-vcr/', import.meta.url);
const CERTIFICATE_PATH = new URL('fixture-cert.pem', FIXTURE_ROOT);
const KEY_PATH = new URL('fixture-key.pem', FIXTURE_ROOT);
const CERTIFICATE_PEM = readFileSync(CERTIFICATE_PATH, 'utf8');
const PRIVATE_KEY_PEM = readFileSync(KEY_PATH, 'utf8');
const CERTIFICATE = new X509Certificate(CERTIFICATE_PEM);
const PINNED_CERTIFICATE_SHA256 = '338b8e455fa680fbb281823d0d334e58e632f68ecf69c628b2a5583664402f61';
const PINNED_SPKI_SHA256 = 'FKYjtNhMIpOI/vI03Cj8eoWUo0bwinbcxXlDbOfqgYw=';
const ACTUAL_CERTIFICATE_SHA256 = createHash('sha256').update(CERTIFICATE.raw).digest('hex');
const ACTUAL_SPKI_SHA256 = createHash('sha256')
	.update(CERTIFICATE.publicKey.export({ type: 'spki', format: 'der' }))
	.digest('base64');

if (ACTUAL_CERTIFICATE_SHA256 !== PINNED_CERTIFICATE_SHA256
	|| ACTUAL_SPKI_SHA256 !== PINNED_SPKI_SHA256
	|| CERTIFICATE.checkIP(HOST) !== HOST) {
	throw new Error('Web VCR HTTPS fixture certificate does not match its pinned loopback identity.');
}

export const FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_PEM = CERTIFICATE_PEM;
export const FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_FINGERPRINT_256 = CERTIFICATE.fingerprint256;
export const FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256 = PINNED_CERTIFICATE_SHA256;
export const FRAMESCAPER_WEB_VCR_FIXTURE_SPKI_SHA256 = PINNED_SPKI_SHA256;

const STATIC_ASSETS = Object.freeze(new Map([
	['/assets/main-fixture.js', readFixtureAsset('main-fixture.js')],
	['/assets/interactive-fixture.js', readFixtureAsset('interactive-fixture.js')],
	['/assets/media-fixture.js', readFixtureAsset('media-fixture.js')],
	['/assets/oauth-complete.js', readFixtureAsset('oauth-complete.js')],
]));

/**
 * Start a test-only HTTPS origin bound exclusively to 127.0.0.1.
 *
 * The checked-in key is intentionally limited to this fixture. Production must
 * admit the fixture, when needed, by the exact exported certificate fingerprint
 * rather than by disabling TLS validation.
 */
export async function createFramescaperWebVcrHttpsFixture(options = {}) {
	const port = validateOptions(options);
	const sockets = new Set();
	let origin = null;
	let closePromise = null;
	const server = createServer({
		key: PRIVATE_KEY_PEM,
		cert: CERTIFICATE_PEM,
		minVersion: 'TLSv1.2',
	}, (request, response) => {
		void handleRequest(request, response, () => requiredOrigin(origin)).catch(() => {
			if (!response.headersSent) sendText(response, 500, 'Fixture request failed.');
			else response.destroy();
		});
	});
	server.maxHeadersCount = 32;
	server.headersTimeout = 5_000;
	server.requestTimeout = 10_000;
	server.keepAliveTimeout = 1_000;
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
	});
	await listen(server, port);
	const address = server.address();
	if (!address || typeof address === 'string' || address.address !== HOST) {
		await closeServer(server, sockets);
		throw new Error('Web VCR HTTPS fixture did not bind to the required loopback host.');
	}
	origin = `https://${HOST}:${String(address.port)}`;
	server.unref();
	const urls = Object.freeze({
		index: `${origin}/`,
		login: `${origin}/login`,
		session: `${origin}/session`,
		sessionCheck: `${origin}/session/check`,
		oauthAuthorize: `${origin}/oauth/authorize?state=fixture-state`,
		input: `${origin}/input`,
		inputResult: `${origin}/input/result`,
		mediaEnded: `${origin}/media/ended`,
		mediaLoop: `${origin}/media/loop`,
		httpsRedirect: `${origin}/redirect/https`,
		httpRedirect: `${origin}/redirect/http`,
	});
	return Object.freeze({
		host: HOST,
		port: address.port,
		origin,
		urls,
		certificateFingerprint256: FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_FINGERPRINT_256,
		certificateSha256: FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
		spkiSha256: FRAMESCAPER_WEB_VCR_FIXTURE_SPKI_SHA256,
		close() {
			closePromise ??= closeServer(server, sockets);
			return closePromise;
		},
	});
}

async function handleRequest(request, response, getOrigin) {
	const method = request.method ?? '';
	const origin = getOrigin();
	const requestTarget = request.url ?? '';
	if (!validRequestTarget(requestTarget)) {
		sendText(response, 400, 'Invalid fixture request target.');
		return;
	}
	if (request.headers.host !== origin.slice('https://'.length)) {
		sendText(response, 400, 'Invalid fixture host.');
		return;
	}
	const url = new URL(requestTarget, origin);
	const asset = STATIC_ASSETS.get(url.pathname);
	if (asset !== undefined) {
		if (!requireMethod(method, 'GET', response)) return;
		send(response, 200, asset, 'text/javascript; charset=utf-8');
		return;
	}
	switch (url.pathname) {
		case '/healthz':
			if (!requireMethod(method, 'GET', response)) return;
			sendJson(response, 200, { status: 'ok' });
			return;
		case '/':
			if (!requireMethod(method, 'GET', response)) return;
			sendHtml(response, 200, indexPage());
			return;
		case '/login':
			if (!requireMethod(method, 'GET', response)) return;
			sendHtml(response, 200, loginPage());
			return;
		case '/session':
			if (!requireMethod(method, 'GET', response)) return;
			sendJson(response, 200, { authenticated: isAuthenticated(request.headers.cookie) });
			return;
		case '/session/check':
			if (!requireMethod(method, 'GET', response)) return;
			redirect(response, 302, isAuthenticated(request.headers.cookie)
				? '/session/authenticated' : '/session/anonymous');
			return;
		case '/session/authenticated':
		case '/session/anonymous':
			if (!requireMethod(method, 'GET', response)) return;
			sendHtml(response, 200, sessionStatusPage(url.pathname.endsWith('authenticated')));
			return;
		case '/session/login':
			if (!requireMethod(method, 'POST', response)) return;
			await login(request, response);
			return;
		case '/session/logout':
			if (!requireMethod(method, 'POST', response)) return;
			redirect(response, 303, '/session', expiredAuthCookie());
			return;
		case '/oauth/authorize':
			if (!requireMethod(method, 'GET', response)) return;
			authorizePopup(response, url.searchParams.get('state'));
			return;
		case '/oauth/complete':
			if (!requireMethod(method, 'GET', response)) return;
			completePopup(response, url.searchParams.get('state'));
			return;
		case '/input':
			if (!requireMethod(method, 'GET', response)) return;
			sendHtml(response, 200, inputPage());
			return;
		case '/input/result':
			if (!requireMethod(method, 'GET', response)) return;
			serveInputResult(response, url.searchParams);
			return;
		case '/media/ended':
		case '/media/loop':
			if (!requireMethod(method, 'GET', response)) return;
			serveMediaPage(response, url.pathname === '/media/loop', url.searchParams.get('durationMs'));
			return;
		case '/redirect/https':
			if (!requireMethod(method, 'GET', response)) return;
			redirect(response, 302, `${origin}/media/ended`);
			return;
		case '/redirect/http':
			if (!requireMethod(method, 'GET', response)) return;
			redirect(response, 302, `http://${HOST}:${new URL(origin).port}/rejected`);
			return;
		default:
			sendText(response, 404, 'Fixture route not found.');
	}
}

async function login(request, response) {
	let form;
	try {
		form = await readForm(request);
	} catch (error) {
		if (error instanceof FixtureRequestError) {
			sendText(response, error.status, error.message);
			return;
		}
		throw error;
	}
	if (!hasExactFormKeys(form, ['username', 'password'])
		|| form.get('username') !== 'fixture'
		|| form.get('password') !== 'authorized') {
		sendText(response, 401, 'Fixture credentials rejected.');
		return;
	}
	redirect(response, 303, '/session', persistentAuthCookie());
}

function authorizePopup(response, stateValue) {
	const state = validState(stateValue);
	if (state === null) {
		sendText(response, 400, 'Invalid OAuth fixture state.');
		return;
	}
	sendHtml(response, 200, htmlDocument('Authorize fixture', `
		<main>
			<h1>Authorize Web VCR fixture</h1>
			<p>This local page simulates a bounded same-origin authentication popup.</p>
			<a id="fixture-oauth-authorize" href="/oauth/complete?state=${escapeHtml(state)}">Authorize</a>
		</main>`));
}

function completePopup(response, stateValue) {
	const state = validState(stateValue);
	if (state === null) {
		sendText(response, 400, 'Invalid OAuth fixture state.');
		return;
	}
	sendHtml(response, 200, htmlDocument('Authorization complete', `
		<main><h1>Authorization complete</h1><p>This popup may close.</p></main>
		<script src="/assets/oauth-complete.js"></script>`, ` data-state="${escapeHtml(state)}"`), {
		'set-cookie': persistentAuthCookie(),
	});
}

function serveMediaPage(response, loop, durationValue) {
	const durationMs = durationValue === null ? 1_800 : Number(durationValue);
	if (!Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > 30_000) {
		sendText(response, 400, 'Fixture media duration must be an integer from 500 through 30000.');
		return;
	}
	const mode = loop ? 'loop' : 'ended';
	sendHtml(response, 200, htmlDocument(`Media fixture: ${mode}`, `
		<div id="fixture-capture-marker" aria-hidden="true"></div>
		<main>
			<h1>Deterministic ${mode} media fixture</h1>
			<video id="fixture-video" width="640" height="360" controls playsinline></video>
			<button id="fixture-media-action" type="button">Generate fixture media</button>
			<output id="fixture-media-status" aria-live="polite">idle</output>
		</main>
		<script src="/assets/media-fixture.js"></script>`,
		` data-loop="${String(loop)}" data-duration-ms="${String(durationMs)}"`));
}

function indexPage() {
	return htmlDocument('Web VCR diagnostics fixture', `
		<main>
			<h1>Web VCR diagnostics fixture</h1>
			<nav>
				<a href="/login">Persistent login</a>
				<a href="/input">Interactive input</a>
				<a href="/media/ended">Ended media</a>
				<a href="/media/loop">Looping media</a>
			</nav>
			<button id="fixture-oauth-popup" type="button">Open authorization popup</button>
			<output id="fixture-oauth-status" aria-live="polite">not authorized</output>
		</main>
		<script src="/assets/main-fixture.js"></script>`);
}

function loginPage() {
	return htmlDocument('Fixture login', `
		<main>
			<h1>Fixture login</h1>
			<form method="post" action="/session/login">
				<label>Username <input id="fixture-login-username" name="username" autocomplete="username" required autofocus></label>
				<label>Password <input id="fixture-login-password" name="password" type="password" autocomplete="current-password" required></label>
				<button id="fixture-login-submit" type="submit">Sign in</button>
			</form>
		</main>`);
}

function inputPage() {
	return htmlDocument('Interactive fixture', `
		<main>
			<h1>Interactive input fixture</h1>
			<label>Input <input id="fixture-input" autocomplete="off" autofocus></label>
			<div id="fixture-pointer-surface" tabindex="0">Pointer surface</div>
			<output id="fixture-input-output" aria-live="polite">idle</output>
		</main>
		<script src="/assets/interactive-fixture.js"></script>`);
}

function sessionStatusPage(authenticated) {
	const status = authenticated ? 'authenticated' : 'anonymous';
	return htmlDocument(`Fixture session: ${status}`, `
		<main><h1>Fixture session is ${status}</h1></main>`);
}

function serveInputResult(response, parameters) {
	const value = parameters.get('value');
	const pointer = parameters.get('pointer');
	if (typeof value !== 'string' || !/^[a-z\d-]{1,32}$/u.test(value)
		|| typeof pointer !== 'string' || !/^\d{1,4},\d{1,4}$/u.test(pointer)
		|| [...parameters.keys()].some((key) => !['value', 'pointer'].includes(key))
		|| parameters.getAll('value').length !== 1 || parameters.getAll('pointer').length !== 1) {
		sendText(response, 400, 'Invalid interactive fixture evidence.');
		return;
	}
	sendHtml(response, 200, htmlDocument('Interactive fixture result', `
		<main><h1>Interactive input received</h1>
			<output id="fixture-result-value">${escapeHtml(value)}</output>
			<output id="fixture-result-pointer">${escapeHtml(pointer)}</output>
		</main>`));
}

function htmlDocument(title, content, bodyAttributes = '') {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		body { font: 16px system-ui; margin: 24px; color: #f5f7fa; background: #10212f; }
		main, nav { display: grid; gap: 16px; max-width: 760px; }
		a, button, input { font: inherit; padding: 8px; }
		video { display: block; width: 640px; max-width: 100%; background: #000; }
		#fixture-login-username { position: fixed; left: 256px; top: 120px; width: 320px; height: 48px; box-sizing: border-box; }
		#fixture-login-password { position: fixed; left: 256px; top: 184px; width: 320px; height: 48px; box-sizing: border-box; }
		#fixture-login-submit { position: fixed; left: 256px; top: 248px; width: 320px; height: 64px; }
		#fixture-pointer-surface { position: fixed; left: 256px; top: 200px; width: 640px; height: 240px; background: #294861; }
		#fixture-media-action { position: fixed; left: 256px; top: 512px; width: 320px; height: 64px; }
		#fixture-capture-marker { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 40vw; height: 12vh; pointer-events: none; background: linear-gradient(90deg, rgb(23, 197, 89) 0 50%, rgb(211, 43, 173) 50%); }
	</style>
</head>
<body${bodyAttributes}>${content}</body>
</html>`;
}

function sendHtml(response, status, body, additionalHeaders = {}) {
	send(response, status, body, 'text/html; charset=utf-8', additionalHeaders);
}

function sendJson(response, status, value) {
	send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

function sendText(response, status, body) {
	send(response, status, body, 'text/plain; charset=utf-8');
}

function send(response, status, body, contentType, additionalHeaders = {}) {
	response.writeHead(status, {
		...securityHeaders(),
		'content-type': contentType,
		'content-length': Buffer.byteLength(body),
		...additionalHeaders,
	});
	response.end(body);
}

function redirect(response, status, location, setCookie = null) {
	const headers = { ...securityHeaders(), location, 'content-length': '0' };
	if (setCookie !== null) headers['set-cookie'] = setCookie;
	response.writeHead(status, headers);
	response.end();
}

function sendMethodNotAllowed(response, allow) {
	response.writeHead(405, { ...securityHeaders(), allow, 'content-length': '0' });
	response.end();
}

function securityHeaders() {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
		'cross-origin-opener-policy': 'same-origin-allow-popups',
		'permissions-policy': 'camera=(), microphone=(), geolocation=(), display-capture=()',
		'referrer-policy': 'no-referrer',
		'strict-transport-security': 'max-age=31536000',
		'x-content-type-options': 'nosniff',
	};
}

function requireMethod(actual, expected, response) {
	if (actual === expected) return true;
	sendMethodNotAllowed(response, expected);
	return false;
}

function validRequestTarget(value) {
	return value.length > 0
		&& value.length <= MAX_REQUEST_TARGET_LENGTH
		&& value.startsWith('/')
		&& !value.includes('\\')
		&& !/%(?:2e|2f|5c)/iu.test(value);
}

function validState(value) {
	return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(value) ? value : null;
}

function isAuthenticated(cookieHeader) {
	if (typeof cookieHeader !== 'string' || cookieHeader.length > 2_048) return false;
	return cookieHeader.split(';').some((entry) => entry.trim() === AUTH_COOKIE);
}

function persistentAuthCookie() {
	return `${AUTH_COOKIE}; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Strict`;
}

function expiredAuthCookie() {
	return 'web_vcr_fixture_auth=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}

function hasExactFormKeys(form, keys) {
	const actual = [...form.keys()];
	return actual.length === keys.length
		&& keys.every((key) => form.getAll(key).length === 1)
		&& actual.every((key) => keys.includes(key));
}

function readForm(request) {
	if (!String(request.headers['content-type'] ?? '').toLowerCase()
		.startsWith('application/x-www-form-urlencoded')) {
		throw new FixtureRequestError(415, 'Fixture login requires URL-encoded form data.');
	}
	const declaredLength = Number(request.headers['content-length'] ?? 0);
	if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
		throw new FixtureRequestError(413, 'Fixture request body is too large.');
	}
	return new Promise((resolve, reject) => {
		const chunks = [];
		let length = 0;
		let oversized = false;
		request.on('data', (chunk) => {
			length += chunk.length;
			if (length > MAX_BODY_BYTES) {
				oversized = true;
				chunks.length = 0;
			} else if (!oversized) {
				chunks.push(chunk);
			}
		});
		request.on('error', reject);
		request.on('end', () => {
			if (oversized) reject(new FixtureRequestError(413, 'Fixture request body is too large.'));
			else resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
		});
	});
}

function validateOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Web VCR HTTPS fixture options must be an object.');
	}
	const keys = Object.keys(value);
	if (keys.some((key) => key !== 'port')) throw new TypeError('Web VCR HTTPS fixture options are closed.');
	const port = value.port ?? 0;
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
		throw new RangeError('Web VCR HTTPS fixture port is invalid.');
	}
	return port;
}

function readFixtureAsset(name) {
	return readFileSync(new URL(name, FIXTURE_ROOT), 'utf8');
}

function requiredOrigin(value) {
	if (value === null) throw new Error('Web VCR HTTPS fixture origin is not ready.');
	return value;
}

function listen(server, port) {
	return new Promise((resolve, reject) => {
		const onError = (error) => {
			server.off('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.off('error', onError);
			resolve();
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen({ host: HOST, port, exclusive: true });
	});
}

function closeServer(server, sockets) {
	return new Promise((resolve, reject) => {
		if (!server.listening) {
			for (const socket of sockets) socket.destroy();
			resolve();
			return;
		}
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
		for (const socket of sockets) socket.destroy();
	});
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

class FixtureRequestError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}
