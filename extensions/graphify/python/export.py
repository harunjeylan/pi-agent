#!/usr/bin/env python3
"""Export graph to various formats: SVG, GraphML."""

import json
import sys
from pathlib import Path

try:
    import networkx as nx
except ImportError:
    print("networkx required for export", file=sys.stderr)
    sys.exit(1)


def export_svg(graph_path: Path, output_path: Path) -> None:
    """Export graph to SVG using graphviz."""
    try:
        import graphviz
    except ImportError:
        print("graphviz required for SVG export", file=sys.stderr)
        sys.exit(1)
    
    # Load graph
    with open(graph_path) as f:
        data = json.load(f)
    
    G = nx.node_link_graph(data)
    
    # Create directed graph
    dot = graphviz.Digraph(comment='Knowledge Graph')
    dot.attr(rankdir='TB', size='20,20')
    
    # Color by community
    communities = {}
    for node in G.nodes():
        comm = G.nodes[node].get('community', 0)
        communities[node] = comm
    
    # Unique colors for communities
    colors = [
        '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
        '#ffff33', '#a65628', '#f781bf', '#999999', '#66c2a5'
    ]
    
    # Add nodes
    for node in G.nodes():
        comm = communities.get(node, 0)
        color = colors[comm % len(colors)]
        label = G.nodes[node].get('label', node)[:30]
        dot.node(str(node), label, color=color, style='filled', fillcolor=color + '40')
    
    # Add edges
    for edge in G.edges():
        source, target = edge
        dot.edge(str(source), str(target))
    
    # Render
    dot.format = 'svg'
    dot.render(str(output_path.with_suffix('')), cleanup=True)
    print(f"SVG exported: {output_path}")


def export_graphml(graph_path: Path, output_path: Path) -> None:
    """Export graph to GraphML format for Gephi/yEd."""
    with open(graph_path) as f:
        data = json.load(f)
    
    G = nx.node_link_graph(data)
    
    # Write GraphML
    nx.write_graphml(G, str(output_path))
    print(f"GraphML exported: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: export.py <graph.json> <output> --svg|--graphml", file=sys.stderr)
        sys.exit(1)
    
    graph_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    format_type = sys.argv[3]
    
    if not graph_path.exists():
        print(f"Graph not found: {graph_path}", file=sys.stderr)
        sys.exit(1)
    
    if format_type == "--svg":
        export_svg(graph_path, output_path)
    elif format_type == "--graphml":
        export_graphml(graph_path, output_path)
    else:
        print(f"Unknown format: {format_type}", file=sys.stderr)
        sys.exit(1)
