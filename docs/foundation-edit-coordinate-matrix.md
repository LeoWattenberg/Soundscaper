# Foundation edit coordinate matrix

The machine-readable authority matrix lives in
`src/common/editor/foundation-edit-coordinate-matrix.ts`. It is the review
artifact for schema 10 edit conformance.

Commands operate on the resolved runtime projection. The command projection
then reconciles results to exactly one persisted authority for each coordinate:
timeline samples or rational beats for audio, sequence frames for video
placement/extent, and source frames for video in/out. A/V links share derived
presentation endpoints; they do not persist duplicated cross-domain timing.

| Primitive | Operation delta | Video rule | Linked-audio rule |
| --- | --- | --- | --- |
| Move | Destination minus origin | One integer sequence-frame delta | Recompute from video endpoints |
| Ripple | Deleted absolute span | One conformed frame span per sequence | Shift by resolved video span |
| Roll | Shared edit point | One frame boundary | Use the same resolved boundary |
| Slip | Source-domain delta | Integer source frame/PTS | Independent audio source samples |
| Slide | Center-clip move | One frame delta, fixed outer edges | Recompute shared endpoints |
| Split | Absolute boundary | One frame boundary | Split at resolved video boundary |
| Paste | One destination anchor | Endpoint conversion in frame space | Recompute pasted linked pair |
| Duplicate | Paste at selection end | Same as paste | Same as paste |
| Range delete | Selected absolute range | One conformed span per sequence | Follow conformed video survivors |
| Insert | Resolved edit span | One conformed span opens every media lane | Placed pair shares the video endpoints |
| Overwrite | Resolved edit span | One conformed span on the lanes that receive | Placed pair shares the video endpoints |
| Replace | The replaced clip's own range | Placement and extent unchanged; source in from the monitor | Follow the replacing video endpoints |

The source artifact contains the full placement, extent, and source-range rule
for audio and video plus the implementation files that cite each matrix row.
