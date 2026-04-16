#!/usr/bin/env python3
"""Generate agent-crawlable wiki from graph."""

import json
import sys
from pathlib import Path
from typing import Any


def generate_wiki(graph_path: Path, output_dir: Path) -> None:
    """Generate wiki: index.md + one article per community."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(graph_path) as f:
        data = json.load(f)
    
    nodes = data.get('nodes', [])
    edges = data.get('links', data.get('edges', []))
    
    # Group nodes by community
    communities: dict[int, list[dict]] = {}
    for node in nodes:
        comm = node.get('community', 0)
        if comm not in communities:
            communities[comm] = []
        communities[comm].append(node)
    
    # Generate index.md
    index_lines = [
        "# Knowledge Graph Wiki",
        "",
        "Auto-generated from graphify.",
        "",
        "## Communities",
        "",
    ]
    
    for comm_id in sorted(communities.keys()):
        comm_nodes = communities[comm_id]
        index_lines.append(f"- [[community-{comm_id}|Community {comm_id}]] ({len(comm_nodes)} nodes)")
    
    index_lines.extend([
        "",
        "## Navigation",
        "",
        "- Use wiki-links `[[Community N]]` to explore",
        "- Each community page lists all related concepts",
    ])
    
    (output_dir / "index.md").write_text('\n'.join(index_lines))
    
    # Generate community pages
    for comm_id, comm_nodes in communities.items():
        lines = [
            f"# Community {comm_id}",
            "",
            f"**Nodes:** {len(comm_nodes)}",
            "",
            "## Concepts",
            "",
        ]
        
        # List nodes
        for node in sorted(comm_nodes, key=lambda x: x.get('label', '')):
            label = node.get('label', 'Unknown')
            node_type = node.get('type', 'node')
            lines.append(f"- [[{label}]] ({node_type})")
        
        # Find cross-community edges
        external_links = []
        for edge in edges:
            source = edge.get('source', '')
            target = edge.get('target', '')
            
            # Find source and target communities
            source_comm = None
            target_comm = None
            for n in nodes:
                if n.get('id') == source:
                    source_comm = n.get('community')
                if n.get('id') == target:
                    target_comm = n.get('community')
            
            if source_comm == comm_id and target_comm is not None and target_comm != comm_id:
                external_links.append((edge, target_comm))
            elif target_comm == comm_id and source_comm is not None and source_comm != comm_id:
                external_links.append((edge, source_comm))
        
        if external_links:
            lines.extend([
                "",
                "## Links to Other Communities",
                "",
            ])
            for edge, other_comm in external_links[:20]:  # Limit
                lines.append(f"- → [[community-{other_comm}|Community {other_comm}]]")
        
        (output_dir / f"community-{comm_id}.md").write_text('\n'.join(lines))
    
    print(f"Wiki generated: {output_dir}")
    print(f"  - index.md")
    print(f"  - {len(communities)} community pages")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: wiki.py <graph.json> <output_dir>", file=sys.stderr)
        sys.exit(1)
    
    graph_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    
    if not graph_path.exists():
        print(f"Graph not found: {graph_path}", file=sys.stderr)
        sys.exit(1)
    
    generate_wiki(graph_path, output_dir)
