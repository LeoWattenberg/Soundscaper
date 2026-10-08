# Round six import and export bugs

Only distinct defects reachable through ordinary menus, pickers and authored
projects qualify. Variants of one broken owner count once; setup failures and
unreachable internal inputs are excluded.

| ID | Ordinary user workflow | Defect and repair | Evidence |
| --- | --- | --- | --- |
| R6-IO-001 | Import a normal WAV, then import an Audacity TXT label file with Interview and Transcript point labels at zero and Conclusion at 0.4 seconds. Export audio → Chapters (split by labels) → Export; inspect the downloaded ZIP. | The archive silently omitted Interview because its chapter ended at Transcript's identical start. Coincident boundaries now share the next distinct start, retaining each named output. A coincident region still constrains a point's end; original document and distinct boundaries retain their behavior. Label/marker and point/region manifestations share this boundary resolver root. | Actual public Chromium RED: `/tmp/soundscaper-r6-io-coincident-red.log`, two archived files instead of three. Public GREEN on immutable green1: `/tmp/soundscaper-r6-io-public-green1b.log`, exact Interview/Transcript/Conclusion filenames and three valid WAV bodies. Strict causal tests: 2 RED plus passing distinct-boundary control → GREEN; chapter and embedded-chapter support: 36/36 pass (`/tmp/soundscaper-r6-io-coincident-node-green.log`). Targeted type-aware ESLint passes. |
| R6-IO-002 | Import a normal WAV; select the clip, Effect → Pitch and tempo → Audio warp and transients → Create identity warp map; add an ordinary nonlinear marker. Close, right-click the clip → Move to Project bin; its card → Play. | The audition publishes a playing state but never starts audible PCM because its detached render project has no held tempo map. It also retired musical anchors without converting their beat-domain warp. Retain the timing authority required by every warp, and materialize a musical map on the detached preview's sample grid. The original authored document and unwarped previews retain their behavior. | Public causal Chromium RED on immutable green1: `/tmp/soundscaper-r6-io-bin-warp-output-red.log`; no audible native output and the status reported missing hold tempo authority. Public GREEN on immutable validation48: `/tmp/soundscaper-r6-io-bin-warp-output-green.log`; the actual output exceeds peak 0.1 for more than 0.5 seconds. Diagnostic evidence measured peak 0.24749 over 0.75755 seconds; the engine streams through a worklet without buffer-source starts, so the corrected observer measures actual output and retains the original five-second deadline. Strict sample/musical causal tests: 2 RED with ordinary unwarped control PASS → GREEN; bin service and transport ownership support 15/15 (`/tmp/soundscaper-r6-io-bin-warp-preview-node-green.log`). Targeted type-aware ESLint passes. The initial buffer-source-only public GREEN failure was a test observer limitation and is excluded; the final native-output assertion also fails causally on the original immutable build. Verified I/O count is two. |

An uncounted follow-through of IO-010 also fixes an ordinary saved MP3 chapter
preset queued as stems. The batch converter already omitted saved mix-only
loudness normalization, but retained `embedLabelChapters`, so the queue reached
the exporter's single-mix refusal and marked the member Failed. The converter
now omits the chapter choice for stems, preserving the preset and its ordinary
mixed members. Immutable public RED reached that Failed row through the actual
menu and preset flow (`/tmp/soundscaper-r6-io-batch-chapters-red2.log`); an initial
missing test import was excluded. Strict causal RED plus a passing mix control
now pass with all batch and queue support, 33/33
(`/tmp/soundscaper-r6-io-batch-chapters-node-green.log`). Public GREEN passes on immutable green4
(`/tmp/soundscaper-r6-io-batch-chapters-public-green.log`): the actual two
audio-track stems decode as MP3, each lasts more than half a second and the
programme contains audible PCM. The first green harness incorrectly expected
one track and a mix-only ID3 chapter header; the corrected inventory and actual
MP3 decoder assertions retain the original causal Delivered requirement. The earlier register explicitly identifies this same batch adapter's
hidden mix-setting omission at `docs/development/bugfix-io.md:45`, so this repair
adds no distinct-bug count.

No assistance runtime source pins, recipes, archive logic, dependencies or target
inventories changed. A manual **Update AI assets** run is not required.
