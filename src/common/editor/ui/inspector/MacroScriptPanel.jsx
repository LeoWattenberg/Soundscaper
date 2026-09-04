/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useRef, useState } from 'react';

import MacroScriptEditor from './MacroScriptEditor.jsx';

/**
 * One macro program: the editor, the run, and what the run said.
 *
 * The run state lives here rather than in the manager so the manager stays a
 * list and a detail pane, and so a program's log is discarded with the program
 * rather than outliving it.
 */
export default function MacroScriptPanel({ controller, copy, script, blocked, onChange }) {
	const [log, setLog] = useState([]);
	const [failure, setFailure] = useState(null);
	const [running, setRunning] = useState(false);
	const runRef = useRef(null);

	const run = useCallback(async () => {
		if (runRef.current) return;
		const operation = Symbol('macro-script-run');
		runRef.current = operation;
		setLog([]);
		setFailure(null);
		setRunning(true);
		try {
			const result = await controller.actions.macros.runScript({
				name: script.name,
				source: script.source,
			});
			if (runRef.current !== operation) return;
			setLog(result?.log ? [...result.log] : []);
		} catch (cause) {
			if (runRef.current !== operation) return;
			setFailure({
				message: cause instanceof Error ? cause.message : String(cause),
				line: typeof cause?.line === 'number' ? cause.line : null,
			});
		} finally {
			if (runRef.current === operation) {
				runRef.current = null;
				setRunning(false);
			}
		}
	}, [controller, script.name, script.source]);

	return (
		<MacroScriptEditor
			copy={copy}
			script={script}
			log={log}
			failure={failure}
			running={running}
			blocked={blocked}
			onChange={onChange}
			onRun={() => { void run(); }}
			onCancel={() => controller.actions.macros.cancel()}
		/>
	);
}
