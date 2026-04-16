# Graphify Extension for PI Agent

Turn any folder of files into a navigable knowledge graph with community detection.

Based on: https://github.com/safishamsi/graphify

## Installation

1. Ensure Python 3.10+ is installed
2. The extension auto-installs `graphifyy` package when first used

## Usage

```
/graphify                          # build graph from current directory
/graphify <path>                   # build graph from specific path
/graphify query "question"         # query the knowledge graph
/graphify path "A" "B"             # find shortest path between concepts
```

## How It Works

1. **Detect** - scans directory for code, docs, papers, images
2. **Extract** - AST parsing + semantic extraction (23 languages)
3. **Build** - merges into persistent NetworkX graph
4. **Cluster** - Leiden community detection reveals subsystems
5. **Export** - generates `graph.html`, `GRAPH_REPORT.md`, `graph.json`

## Outputs

- `graphify-out/graph.html` - interactive visualization
- `graphify-out/GRAPH_REPORT.md` - audit report with god nodes & surprises
- `graphify-out/graph.json` - raw graph data for querying

## Features

- 71.5x token compression vs reading raw files
- Multimodal: code + docs + PDFs + images
- Privacy-first: local processing, no code sent externally
- Honest audit trail: edges tagged `EXTRACTED`, `INFERRED`, or `AMBIGUOUS`
