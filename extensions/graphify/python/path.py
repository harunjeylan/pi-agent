#!/usr/bin/env python3
"""Find shortest path between two concepts in the graph."""

import json
import sys
from pathlib import Path

try:
    from networkx.readwrite import json_graph
    import networkx as nx
except ImportError as e:
    print(f"Import error: {e}", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: path.py <graph_path> <from_term> <to_term>", file=sys.stderr)
        sys.exit(1)

    graph_path = Path(sys.argv[1])
    a_term = sys.argv[2]
    b_term = sys.argv[3]

    if not graph_path.exists():
        print("No graph found. Run /graphify first.")
        sys.exit(0)

    data = json.loads(graph_path.read_text())
    G = json_graph.node_link_graph(data, edges='links')

    def find_node(term):
        term = term.lower()
        scored = sorted(
            [(sum(1 for w in term.split() if w in G.nodes[n].get('label', '').lower()), n)
             for n in G.nodes()],
            reverse=True
        )
        return scored[0][1] if scored and scored[0][0] > 0 else None

    src = find_node(a_term)
    tgt = find_node(b_term)

    if not src or not tgt:
        print(f"Could not find nodes matching: {a_term} or {b_term}")
        sys.exit(0)

    try:
        path = nx.shortest_path(G, src, tgt)
        print(f"Path from {G.nodes[src].get('label', src)} to {G.nodes[tgt].get('label', tgt)}:")
        print()
        for i, nid in enumerate(path):
            label = G.nodes[nid].get('label', nid)
            if i < len(path) - 1:
                edge = G.edges[nid, path[i+1]]
                rel = edge.get('relation', 'related')
                conf = edge.get('confidence', 'unknown')
                print(f"{i+1}. {label}")
                print(f"   → ({rel}, {conf})")
            else:
                print(f"{i+1}. {label}")
    except nx.NetworkXNoPath:
        print(f"No path found between {a_term} and {b_term}")
    except nx.NodeNotFound as e:
        print(f"Node not found: {e}")
