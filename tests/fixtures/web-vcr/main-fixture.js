/* SPDX-License-Identifier: AGPL-3.0-only */

document.querySelector('#fixture-oauth-popup').addEventListener('click', () => {
	window.open('/oauth/authorize?state=fixture-state', 'web-vcr-fixture-oauth', 'popup,width=520,height=640');
});

window.addEventListener('message', (event) => {
	if (event.origin !== window.location.origin || event.data?.type !== 'web-vcr-fixture-oauth') return;
	document.querySelector('#fixture-oauth-status').textContent = `${event.data.status}:${event.data.state}`;
});
