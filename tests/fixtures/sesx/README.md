# Adobe Audition SESX fixture

`audition-22.2-metronome.sesx` is a reduced derivative of [Synthgirl's
`Metronome.sesx`](https://github.com/Randomwaves/Synthgirl/blob/fe11457895060e78f3db4a16e75f33d9397e5d1f/02%20Software/Synthgirl-App-H723/Data/Metronome/Metronome.sesx),
an Adobe Audition 22.2 session. The complete source file at that commit has
SHA-256 `686d892fba582cc1ffbb23c52c20a123db4b4cd2e0aacc7b2b8cfb7aa42753b1`.

The fixture retains the original XML declaration, doctype, session attributes,
first two audio tracks, their first three clips, and the matching file-table
entries. It keeps the source values and attribute names for track and clip
controls, fades, routing, and channel maps; it removes the other tracks, clips,
file entries, device state, session state, and most disabled EQ parameters. In
particular, clip ID `0` occurs on both tracks, while the file IDs differ. The
referenced WAV files are intentionally absent; tests generate their own media
where needed.

The source repository's [root MIT license](LICENSE-synthgirl-root.txt) and
[application-subtree MIT license](LICENSE-synthgirl-app.txt) accompany this
derivative. Copyright remains with their respective holders.
