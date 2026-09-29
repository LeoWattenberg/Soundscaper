# Source graphs for local development

Run `npm run graphs:generate`. The script analyzes the current `src/`, `desktop/`,
and `native/` trees and writes separate Graphviz `.dot` and Mermaid `.mmd` files
to `.source-graphs/`. That directory is ignored by Git. No graph renderer is
needed to generate the files; open an `.mmd` file in a Mermaid viewer or render
a `.dot` file with Graphviz. If Graphviz is installed, run
`npm run graphs:generate -- --svg` to create SVGs as well. The full inheritance
and dependency graphs use Graphviz's `sfdp` renderer; the smaller graphs use
`dot`.

| File stem | What it shows |
| --- | --- |
| `ownership` | Directory ownership and source file counts, including native C/C++/Rust source. |
| `ownership-overview` | Top-level source areas and key editor directories; residual groups account for all remaining files. |
| `architecture-overview` | The three strongest import destinations per source area. |
| `dependencies` | All cross-owner relative JavaScript/TypeScript imports, with type-only imports dashed. |
| `inheritance` | Class `extends`, class `implements`, and interface `extends` declarations. |
| `inheritance-overview` | The largest connected inheritance family with at most 18 types. |
| `audio-routing` | Static audio `connect` call sites, grouped by source module. |
| `audio-routing-overview` | The source function with the most audio connections, with repeated endpoints counted. |

The diagrams come from source syntax, not a running application. An audio edge
records a possible connection call, including calls inside conditional branches;
it does not claim that all those edges are active at once. Import edges include
relative static, dynamic, and CommonJS imports. External packages are left out
of the dependency graph. The native source tree contributes to ownership counts,
while import and inheritance parsing covers JavaScript and TypeScript.
