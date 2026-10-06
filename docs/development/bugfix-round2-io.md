# Second import and export bug audit

Each numbered entry is a new, distinct underlying defect beyond the first
round's 102 fixes. Reproductions use ordinary file imports, project menus, and
export controls. No entry requires malformed files or injected application state.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R2-IO-001 | Import a WAV. File → Project management → Rename project, enter `東京の録音`, save the name, then Export audio → Export. | The downloaded WAV was named `audio-project-mix-<date>.wav`, losing the project title. The download should retain the recognizable Japanese name. | Preserve Unicode letters, numbers and combining marks while retaining existing separator sanitization and Latin accent handling. Browser: `a Japanese project title identifies its ordinary WAV download` was red before the fix and passes in Chromium, Firefox and WebKit. Domain: `audio-editor-round2-io-export-name.test.ts` also covers track stem names and other ordinary writing systems. |
| R2-IO-002 | Import a normal silent WAV, open Export audio, choose 16-bit PCM and Dither → Triangular high-pass, and export the WAV. | The mode differences two triangular draws and halves the result, giving half the required noise power and a different probability distribution. On silence only about 8.3% of exported samples changed, rather than the triangular distribution's 25%. | Difference successive centered uniform draws, preserving triangular noise power of 1/6 LSB² with high-pass correlation. Browser: `high-pass triangular dither writes the promised triangular noise into a quiet WAV` failed on the actual downloaded PCM before the fix and passes in all three browsers. Domain: `audio-editor-round2-io-dither.test.ts` measures noise power, correlation, probability and sub-LSB level preservation; existing encoder and Bitcrusher parity checks remain green. |

The first two workflows passed all six browser cases against the production
build. Focused export-name checks passed 10 tests; the dither, encoder and
Bitcrusher suite passed 27 tests. Targeted lint passed.

These source, test and documentation changes keep the existing assistance
runtime closure. A manual **Update AI assets** run is not required.
