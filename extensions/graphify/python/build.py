#!/usr/bin/env python3
"""Build knowledge graph from detected files."""

import json
import sys
from pathlib import Path

try:
    from graphify.detect import detect
    from graphify.extract import extract, collect_files
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json, to_html
except ImportError as e:
    print(f"Import error: {e}", file=sys.stderr)
    sys.exit(1)

# Import our custom document extractor
sys.path.insert(0, str(Path(__file__).parent))
from extract_docs import extract_documents


def merge_extractions(code_extraction: dict, doc_extraction: dict) -> dict:
    """Merge code and document extractions into single graph data."""
    merged = {
        'nodes': [],
        'edges': [],
        'entities': [],
        'relationships': [],
        'input_tokens': 0,
        'output_tokens': 0,
    }
    
    # Add code extraction
    if code_extraction:
        merged['nodes'].extend(code_extraction.get('nodes', []))
        merged['edges'].extend(code_extraction.get('edges', []))
        merged['entities'].extend(code_extraction.get('entities', []))
        merged['relationships'].extend(code_extraction.get('relationships', []))
        merged['input_tokens'] += code_extraction.get('input_tokens', 0)
        merged['output_tokens'] += code_extraction.get('output_tokens', 0)
    
    # Add document extraction
    if doc_extraction:
        merged['nodes'].extend(doc_extraction.get('nodes', []))
        merged['edges'].extend(doc_extraction.get('edges', []))
        merged['entities'].extend(doc_extraction.get('entities', []))
        merged['relationships'].extend(doc_extraction.get('relationships', []))
        merged['input_tokens'] += doc_extraction.get('input_tokens', 0)
        merged['output_tokens'] += doc_extraction.get('output_tokens', 0)
    
    return merged


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: build.py <target_path> <output_dir> [--mode deep] [--directed]", file=sys.stderr)
        sys.exit(1)

    target_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    mode = "normal"
    directed = False

    # Parse args
    for i, arg in enumerate(sys.argv[3:], 3):
        if arg == "--mode" and i + 1 < len(sys.argv):
            mode = sys.argv[i + 1]
        elif arg == "--directed":
            directed = True

    output_dir.mkdir(parents=True, exist_ok=True)

    # Detect files
    detect_result = detect(target_path)
    files_by_type = detect_result.get('files', {})

    # Collect CODE files
    code_files = []
    for f in files_by_type.get('code', []):
        p = Path(f)
        if p.is_dir():
            code_files.extend(collect_files(p))
        else:
            code_files.append(p)

    # Collect DOCUMENT files (markdown, etc)
    doc_files = []
    for file_type in ['document', 'paper']:
        for f in files_by_type.get(file_type, []):
            p = Path(f)
            if p.is_dir():
                # Recursively find markdown files
                doc_files.extend(p.rglob('*.md'))
                doc_files.extend(p.rglob('*.markdown'))
            else:
                doc_files.append(p)

    # Deduplicate
    code_files = list(set(code_files))
    doc_files = list(set(doc_files))

    # Extract code
    code_extraction = None
    if code_files:
        code_extraction = extract(code_files)

    # Extract documents
    doc_extraction = None
    if doc_files:
        doc_extraction = extract_documents(doc_files)

    # Merge extractions
    extraction = merge_extractions(code_extraction, doc_extraction)

    # Build graph
    G = build_from_json(extraction, directed=directed)
    communities = cluster(G)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)

    # Generate labels
    labels = {cid: f"Community {cid}" for cid in communities}

    # Generate report
    tokens = {
        'input': extraction.get('input_tokens', 0),
        'output': extraction.get('output_tokens', 0)
    }
    report = generate(
        G, communities, cohesion, labels, gods, surprises,
        detect_result, tokens, str(target_path)
    )
    (output_dir / "GRAPH_REPORT.md").write_text(report)

    # Export
    to_json(G, communities, str(output_dir / "graph.json"))

    if G.number_of_nodes() <= 5000:
        to_html(G, communities, str(output_dir / "graph.html"), community_labels=labels)

    result = {
        'nodes': G.number_of_nodes(),
        'edges': G.number_of_edges(),
        'communities': len(communities),
        'outputDir': str(output_dir)
    }
    print(json.dumps(result))
