/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';

const IDLE = Object.freeze({
	status: 'idle', revision: 0, coordinator: null, message: null,
});

/** Menu-owned lifecycle for an injected, authenticated semantic-index source. */
export function useWorkspaceAssistanceSearchRuntime({ project, source }) {
	const [state, setState] = useState(IDLE);
	const openingRef = useRef(0);
	const menuRevisionRef = useRef(0);
	const sessionRef = useRef(null);

	const retire = useCallback(() => {
		openingRef.current += 1;
		const session = sessionRef.current;
		sessionRef.current = null;
		session?.coordinator.cancel();
		if (session) void session.dispose().catch(() => undefined);
	}, []);

	useEffect(() => {
		retire();
		setState(IDLE);
		return retire;
	}, [project?.id, project?.revision, retire, source]);

	const openAssistanceSearch = useCallback(() => {
		const revision = menuRevisionRef.current + 1;
		menuRevisionRef.current = revision;
		retire();
		setState(Object.freeze({
			status: 'opening', revision, coordinator: null,
			message: 'Opening the authenticated disposable index…',
		}));
		if (!project || !source || typeof source.open !== 'function') {
			setState(Object.freeze({
				status: 'unavailable', revision, coordinator: null,
				message: 'Indexed search is unavailable until a reviewed disposable index is created.',
			}));
			return;
		}
		const ownedOpening = openingRef.current;
		void Promise.resolve().then(() => source.open({
			schemaFamily: project.schemaFamily, schemaVersion: project.schemaVersion,
			projectId: project.id, projectRevision: project.revision,
		})).then((session) => {
			if (openingRef.current !== ownedOpening) {
				return session.dispose();
			}
			sessionRef.current = session;
			setState(Object.freeze({
				status: 'ready', revision, coordinator: session.coordinator, message: null,
			}));
			return undefined;
		}, (error) => {
			if (openingRef.current !== ownedOpening) return;
			setState(Object.freeze({
				status: 'unavailable', revision, coordinator: null,
				message: semanticSearchMessage(error),
			}));
		});
	}, [project, retire, source]);
	const closeAssistanceSearch = useCallback(() => {
		retire();
		setState(IDLE);
	}, [retire]);

	return Object.freeze({
		assistanceSearch: state,
		closeAssistanceSearch,
		openAssistanceSearch,
	});
}

function semanticSearchMessage(error) {
	if (error?.reason === 'query-models-unavailable') {
		return 'Indexed search needs the explicitly installed nomic and SigLIP query models.';
	}
	if (error?.reason === 'desktop-unavailable') {
		return 'Indexed search is available only in a supported desktop build.';
	}
	return typeof error?.message === 'string' && error.message.length <= 512
		? error.message
		: 'Indexed search is unavailable until a reviewed disposable index is created.';
}
