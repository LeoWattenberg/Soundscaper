# Second import and export bug audit

Each numbered entry is a new, distinct underlying defect beyond the first
round's 102 fixes. Reproductions use ordinary file imports, project menus, and
export controls. No entry requires malformed files or injected application state.

| ID | Ordinary reproduction | Before / expected behavior | Fix and regression |
| --- | --- | --- | --- |
| R2-IO-001 | Import a WAV. File → Project management → Rename project, enter `東京の録音`, save the name, then Export audio → Export. | The downloaded WAV was named `audio-project-mix-<date>.wav`, losing the project title. The download should retain the recognizable Japanese name. | Preserve Unicode letters, numbers and combining marks while retaining existing separator sanitization and Latin accent handling. Browser: `a Japanese project title identifies its ordinary WAV download` was red before the fix and passes in Chromium, Firefox and WebKit. Domain: `audio-editor-round2-io-export-name.test.ts` also covers track stem names and other ordinary writing systems. |
| R2-IO-002 | Import a normal silent WAV, open Export audio, choose 16-bit PCM and Dither → Triangular high-pass, and export the WAV. | The mode differences two triangular draws and halves the result, giving half the required noise power and a different probability distribution. On silence only about 8.3% of exported samples changed, rather than the triangular distribution's 25%. | Difference successive centered uniform draws, preserving triangular noise power of 1/6 LSB² with high-pass correlation. Browser: `high-pass triangular dither writes the promised triangular noise into a quiet WAV` failed on the actual downloaded PCM before the fix and passes in all three browsers. Domain: `audio-editor-round2-io-dither.test.ts` measures noise power, correlation, probability and sub-LSB level preservation; existing encoder and Bitcrusher parity checks remain green. |
| R2-IO-003 | Import a WAV, save an export preset, open File → Delivery queue, enable Pause between jobs, select that preset, Queue batch, then Cancel its row. | The row became Cancelled and provided no Retry action, even though the queue supports retrying cancelled jobs. The user should be able to explicitly retry that row. | Expose the existing row Retry action for cancelled jobs as well as failures. The mounted queue regression verifies that retrying one cancelled job does not deliver another cancelled job. Browser: `a canceled queued delivery can be retried from its own row` reached the missing button before the fix and now passes in Chromium, Firefox and WebKit, including the actual WAV download and Delivered state. |
| R2-IO-004 | In Framescaper import an ordinary video, select its clip, seek to two seconds, Edit → Audio clips → Rate stretch right edge to playhead, then right-click the clip → Move to Project bin. Play its card. A second reproduction trims its left edge at 0.4 seconds before moving it to the bin. | The stretched card displayed `0:00.0` and played at 1× instead of its authored speed. The trimmed card started at the discarded first source frame. Bin presentation read foundation video ordinals as audio sample coordinates. | Resolve the bin video's sequence duration, source in/out times and playback rate through the existing video timing projection. Domain cases cover constant and verified variable frame timing. Both browser workflows failed before the fix and pass in all three engines; the trim case observes the first playing event so natural playback cannot conceal the incorrect start. These are variants of one bin video clock defect, counted once. |

The first two workflows passed all six browser cases against the production
build. Focused export-name checks passed 10 tests; the dither, encoder and
Bitcrusher suite passed 27 tests. Targeted lint passed.

The queue and bin preview follow-ups passed all nine browser cases and 14
focused queue, mounted UI and video clock tests. Targeted lint passed.

These source, test and documentation changes keep the existing assistance
runtime closure. A manual **Update AI assets** run is not required.
