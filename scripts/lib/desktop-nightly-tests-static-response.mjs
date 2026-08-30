/* SPDX-License-Identifier: AGPL-3.0-only */

export function pipeDesktopNightlyTestsStaticResponse(stream, response) {
	const destroyStream = () => stream.destroy();
	response.once('close', destroyStream);
	stream.once('close', () => response.off('close', destroyStream));
	stream.once('error', () => response.destroy());
	stream.pipe(response);
}
