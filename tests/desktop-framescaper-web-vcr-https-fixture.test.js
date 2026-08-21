/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import test from 'node:test';

import {
	FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_FINGERPRINT_256,
	FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_PEM,
	FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
	FRAMESCAPER_WEB_VCR_FIXTURE_SPKI_SHA256,
	createFramescaperWebVcrHttpsFixture,
} from '../scripts/lib/framescaper-web-vcr-https-fixture.mjs';

test('Web VCR HTTPS fixture pins its exact loopback certificate and lifecycle', async () => {
	const certificate = new X509Certificate(FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_PEM);
	assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1');
	assert.equal(certificate.fingerprint256, FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_FINGERPRINT_256);
	assert.equal(
		createHash('sha256').update(certificate.raw).digest('hex'),
		FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
	);
	assert.equal(
		createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
			.digest('base64'),
		FRAMESCAPER_WEB_VCR_FIXTURE_SPKI_SHA256,
	);

	const fixture = await createFramescaperWebVcrHttpsFixture();
	assert.match(fixture.origin, /^https:\/\/127\.0\.0\.1:\d+$/u);
	assert.equal(fixture.host, '127.0.0.1');
	assert.ok(fixture.port > 0);
	assert.equal(fixture.certificateFingerprint256, certificate.fingerprint256);
	assert.equal(fixture.certificateSha256, FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256);
	assert.equal(fixture.spkiSha256, FRAMESCAPER_WEB_VCR_FIXTURE_SPKI_SHA256);
	assert.equal(Object.isFrozen(fixture.urls), true);

	const health = await fetchFixture(fixture, '/healthz');
	assert.equal(health.status, 200);
	assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
	assert.equal(health.headers['cache-control'], 'no-store');
	assert.equal(health.headers['x-content-type-options'], 'nosniff');
	assert.match(health.headers['content-security-policy'], /default-src 'none'/u);

	await fixture.close();
	await fixture.close();
	await assert.rejects(fetchFixture(fixture, '/healthz'), /ECONNREFUSED|socket hang up/u);
});

test('Web VCR HTTPS fixture persists only its bounded secure authorization cookie', async (t) => {
	const fixture = await createFramescaperWebVcrHttpsFixture();
	t.after(() => fixture.close());
	const anonymous = await fetchFixture(fixture, '/session');
	assert.deepEqual(JSON.parse(anonymous.body), { authenticated: false });

	const loginPage = await fetchFixture(fixture, '/login');
	assert.equal(loginPage.status, 200);
	assert.match(loginPage.body, /<form[^>]+action="\/session\/login"/u);
	assert.match(loginPage.body, /autocomplete="username"/u);
	assert.match(loginPage.body, /id="fixture-login-username"/u);
	assert.match(loginPage.body, /id="fixture-login-password"/u);
	assert.match(loginPage.body, /id="fixture-login-submit"/u);
	const rejected = await fetchFixture(fixture, '/session/login', {
		method: 'POST', body: 'username=wrong&password=wrong',
	});
	assert.equal(rejected.status, 401);
	assert.equal(rejected.headers['set-cookie'], undefined);

	const accepted = await fetchFixture(fixture, '/session/login', {
		method: 'POST', body: 'username=fixture&password=authorized',
	});
	assert.equal(accepted.status, 303);
	assert.equal(accepted.headers.location, '/session');
	const cookie = String(accepted.headers['set-cookie']);
	assert.match(cookie, /^web_vcr_fixture_auth=authorized;/u);
	assert.match(cookie, /; Secure;/u);
	assert.match(cookie, /; HttpOnly;/u);
	assert.match(cookie, /; SameSite=Strict/u);
	assert.doesNotMatch(cookie, /Domain=/u);
	const authenticated = await fetchFixture(fixture, '/session', { cookie });
	assert.deepEqual(JSON.parse(authenticated.body), { authenticated: true });
	const authenticatedCheck = await fetchFixture(fixture, '/session/check', { cookie });
	assert.equal(authenticatedCheck.status, 302);
	assert.equal(authenticatedCheck.headers.location, '/session/authenticated');
	const anonymousCheck = await fetchFixture(fixture, '/session/check');
	assert.equal(anonymousCheck.headers.location, '/session/anonymous');

	const logout = await fetchFixture(fixture, '/session/logout', { method: 'POST', cookie });
	assert.equal(logout.status, 303);
	assert.match(String(logout.headers['set-cookie']), /Max-Age=0/u);
});

test('Web VCR HTTPS fixture serves popup, input, media, and redirect qualification routes', async (t) => {
	const fixture = await createFramescaperWebVcrHttpsFixture();
	t.after(() => fixture.close());
	const index = await fetchFixture(fixture, '/');
	assert.match(index.body, /id="fixture-oauth-popup"/u);
	assert.match(index.body, /href="\/input"/u);
	assert.match(index.body, /href="\/media\/ended"/u);
	assert.match(index.body, /href="\/media\/loop"/u);
	const mainScript = await fetchFixture(fixture, '/assets/main-fixture.js');
	assert.match(mainScript.body, /window\.open\('\/oauth\/authorize\?state=fixture-state'/u);

	const popup = await fetchFixture(fixture, '/oauth/authorize?state=valid_state-1');
	assert.match(popup.body, /href="\/oauth\/complete\?state=valid_state-1"/u);
	const completion = await fetchFixture(fixture, '/oauth/complete?state=valid_state-1');
	assert.match(String(completion.headers['set-cookie']), /Secure/u);
	assert.match(completion.body, /data-state="valid_state-1"/u);
	const popupScript = await fetchFixture(fixture, '/assets/oauth-complete.js');
	assert.match(popupScript.body, /window\.opener\.postMessage/u);
	assert.match(popupScript.body, /window\.close\(\)/u);
	const invalidState = await fetchFixture(fixture, '/oauth/authorize?state=%3Cscript%3E');
	assert.equal(invalidState.status, 400);

	const inputPage = await fetchFixture(fixture, '/input');
	assert.match(inputPage.body, /id="fixture-input"/u);
	assert.match(inputPage.body, /id="fixture-input"[^>]+autofocus/u);
	assert.match(inputPage.body, /id="fixture-input-output"/u);
	const inputScript = await fetchFixture(fixture, '/assets/interactive-fixture.js');
	assert.match(inputScript.body, /addEventListener\('input'/u);
	assert.match(inputScript.body, /mousedown/u);
	assert.match(inputScript.body, /location\.assign/u);
	const inputResult = await fetchFixture(fixture, '/input/result?value=smoke&pointer=64%2C160');
	assert.equal(inputResult.status, 200);
	assert.match(inputResult.body, /smoke/u);
	assert.equal((await fetchFixture(fixture, '/input/result?value=%3Cbad%3E&pointer=64%2C160')).status, 400);

	for (const [route, loopValue] of [['/media/ended', 'false'], ['/media/loop', 'true']]) {
		const page = await fetchFixture(fixture, route);
		assert.equal(page.status, 200);
		assert.match(page.body, /<video id="fixture-video"/u);
		assert.match(page.body, /id="fixture-capture-marker"/u);
		assert.match(page.body, /width: 40vw; height: 12vh/u);
		assert.match(page.body, /rgb\(23, 197, 89\).*rgb\(211, 43, 173\)/u);
		assert.match(page.body, new RegExp(`data-loop="${loopValue}"`, 'u'));
		assert.match(page.body, /src="\/assets\/media-fixture.js"/u);
	}
	const mediaScript = await fetchFixture(fixture, '/assets/media-fixture.js');
	assert.match(mediaScript.body, /new MediaRecorder/u);
	assert.match(mediaScript.body, /createOscillator\(\)/u);
	assert.match(mediaScript.body, /oscillator\.frequency\.value = 440/u);
	assert.match(mediaScript.body, /button\.addEventListener\('mousedown'/u);
	assert.match(mediaScript.body, /video\.addEventListener\('ended'/u);
	assert.match(mediaScript.body, /location\.hash = 'playing'/u);
	assert.match(mediaScript.body, /location\.hash = 'failed'/u);
	assert.match(mediaScript.body, /URL\.createObjectURL/u);
	assert.match(mediaScript.body, /await video\.play\(\)/u);

	const secureRedirect = await fetchFixture(fixture, '/redirect/https');
	assert.equal(secureRedirect.status, 302);
	assert.equal(secureRedirect.headers.location, `${fixture.origin}/media/ended`);
	const rejectedRedirect = await fetchFixture(fixture, '/redirect/http');
	assert.equal(rejectedRedirect.status, 302);
	assert.equal(rejectedRedirect.headers.location, `http://127.0.0.1:${String(fixture.port)}/rejected`);
});

test('Web VCR HTTPS fixture rejects unknown methods, traversal, and oversized bodies', async (t) => {
	const fixture = await createFramescaperWebVcrHttpsFixture();
	t.after(() => fixture.close());
	assert.equal((await fetchFixture(fixture, '/missing')).status, 404);
	assert.equal((await fetchFixture(fixture, '/%2e%2e/secret')).status, 400);
	const wrongMethod = await fetchFixture(fixture, '/healthz', { method: 'PUT' });
	assert.equal(wrongMethod.status, 405);
	assert.equal(wrongMethod.headers.allow, 'GET');
	assert.equal((await fetchFixture(fixture, '/session/login', {
		method: 'POST', body: `username=fixture&password=${'x'.repeat(5_000)}`,
	})).status, 413);
});

function fetchFixture(fixture, path, options = {}) {
	const body = options.body ?? '';
	return new Promise((resolve, reject) => {
		const request = httpsRequest({
			hostname: fixture.host,
			port: fixture.port,
			path,
			method: options.method ?? 'GET',
			ca: FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_PEM,
			headers: {
				...(body === '' ? {} : {
					'content-type': 'application/x-www-form-urlencoded',
					'content-length': Buffer.byteLength(body),
				}),
				...(options.cookie ? { cookie: firstCookie(options.cookie) } : {}),
			},
		}, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => resolve({
				status: response.statusCode,
				headers: response.headers,
				body: Buffer.concat(chunks).toString('utf8'),
			}));
		});
		request.on('error', reject);
		request.end(body);
	});
}

function firstCookie(value) {
	return String(Array.isArray(value) ? value[0] : value).split(';', 1)[0];
}
