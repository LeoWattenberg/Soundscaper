/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_MCP_COPY_BY_LOCALE = (typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined'
	|| __SCAPE_DESKTOP_RENDERER__) ? Object.freeze({
	en: Object.freeze({
		connection: 'MCP connection',
		disclosure: 'Connected local clients can read project metadata and edit the open project without confirmation for each edit. Share this token only with a client you trust.',
		authorization: 'Connect to the endpoint with an Authorization: Bearer <token> header.',
		closeKeepsRunning: 'Closing this dialog keeps MCP running until you stop it or quit Soundscaper.',
		disabled: 'MCP is off for this session.',
		enabled: 'MCP is running for this session.',
		loading: 'Reading MCP connection status',
		start: 'Start MCP',
		stop: 'Stop MCP',
		endpoint: 'Endpoint',
		token: 'Session token',
		copyEndpoint: 'Copy endpoint',
		copyToken: 'Copy token',
		copied: 'Copied to clipboard.',
		copyFailed: 'Could not copy to clipboard.',
	}),
	de: Object.freeze({
		connection: 'MCP-Verbindung',
		disclosure: 'Verbundene lokale Clients können Projektmetadaten lesen und das geöffnete Projekt ohne Bestätigung für jede Änderung bearbeiten. Gib dieses Token nur an einen vertrauenswürdigen Client weiter.',
		authorization: 'Verbinde dich mit dem Endpunkt und sende den Header Authorization: Bearer <token>.',
		closeKeepsRunning: 'Wenn du diesen Dialog schließt, läuft MCP weiter, bis du es stoppst oder Soundscaper beendest.',
		disabled: 'MCP ist für diese Sitzung ausgeschaltet.',
		enabled: 'MCP läuft für diese Sitzung.',
		loading: 'MCP-Verbindungsstatus wird gelesen',
		start: 'MCP starten',
		stop: 'MCP stoppen',
		endpoint: 'Endpunkt',
		token: 'Sitzungstoken',
		copyEndpoint: 'Endpunkt kopieren',
		copyToken: 'Token kopieren',
		copied: 'In die Zwischenablage kopiert.',
		copyFailed: 'Kopieren in die Zwischenablage fehlgeschlagen.',
	}),
}) : null;
