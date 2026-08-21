/* SPDX-License-Identifier: AGPL-3.0-only */

const state = document.body.dataset.state;
if (window.opener && state) {
	window.opener.postMessage(
		Object.freeze({ type: 'web-vcr-fixture-oauth', status: 'authorized', state }),
		window.location.origin,
	);
}
window.close();
