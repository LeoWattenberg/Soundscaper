#!/bin/sh
':' /*
trap "" TERM
sleep 30 &
descendant=$!
printf '{"leader":%s,"descendant":%s}\n' "$$" "$descendant" > "$1"
count=0
while [ "$count" -lt 128 ]; do printf xxxxxxxx; count=$((count + 1)); done
wait "$descendant"
exit 0
: <<'JAVASCRIPT'
*/

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [role, marker] = process.argv.slice(2);
if (role === 'descendant') {
	process.send?.('ready');
	setInterval(() => {}, 1_000);
} else {
	const descendant = spawn(process.execPath, [process.argv[1], 'descendant', marker], {
		stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
		windowsHide: true,
	});
	descendant.once('message', () => {
		writeFileSync(marker, JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
		process.stdout.write('x'.repeat(1_024));
	});
	setInterval(() => {}, 1_000);
}
const JAVASCRIPT = undefined;
JAVASCRIPT
