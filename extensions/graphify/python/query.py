#!/usr/bin/env python3
"""Query the knowledge graph."""

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
        print("Usage: query.py <graph_path> <question> <mode> [budget]", file=sys.stderr)
        sys.exit(1)

    graph_path = Path(sys.argv[1])
    question = sys.argv[2]
    mode = sys.argv[3]
    budget = int(sys.argv[4]) if len(sys.argv) > 4 else 2000

    if not graph_path.exists():
        print("No graph found. Run /graphify first.")
        sys.exit(0)

    data = json.loads(graph_path.read_text())
    G = json_graph.node_link_graph(data, edges='links')

    terms = [t.lower() for t in question.split() if len(t) > 3]

    # Find best-matching start nodes
    scored = []
    for nid, ndata in G.nodes(data=True):
        label = ndata.get('label', '').lower()
        score = sum(1 for t in terms if t in label)
        if score > 0:
            scored.append((score, nid))
    scored.sort(reverse=True)
    start_nodes = [nid for _, nid in scored[:3]]

    if not start_nodes:
        print(f"No matching nodes found for: {question}")
        sys.exit(0)

    subgraph_nodes = set()
    subgraph_edges = []

    if mode == 'dfs':
        visited = set()
        stack = [(n, 0) for n in reversed(start_nodes)]
        while stack:
            node, depth = stack.pop()
            if node in visited or depth > 6:
                continue
            visited.add(node)
            subgraph_nodes.add(node)
            for neighbor in G.neighbors(node):
                if neighbor not in visited:
                    stack.append((neighbor, depth + 1))
                    subgraph_edges.append((node, neighbor))
    else:
        frontier = set(start_nodes)
        subgraph_nodes = set(start_nodes)
        for _ in range(3):
            next_frontier = set()
            for n in frontier:
                for neighbor in G.neighbors(n):
                    if neighbor not in subgraph_nodes:
                        next_frontier.add(neighbor)
                        subgraph_edges.append((n, neighbor))
            subgraph_nodes.update(next_frontier)
            frontier = next_frontier

    # Build response
    char_budget = budget * 4

    def relevance(nid):
        label = G.nodes[nid].get('label', '').lower()
        return sum(1 for t in terms if t in label)

    ranked_nodes = sorted(subgraph_nodes, key=relevance, reverse=True)

    lines = [
        f"Query: {question}",
        f"Mode: {mode.upper()} | Found {len(subgraph_nodes)} related nodes",
        ""
    ]

    for nid in ranked_nodes[:20]:
        d = G.nodes[nid]
        lines.append(f"• {d.get('label', nid)}")
        if d.get('source_file'):
            lines.append(f"  Source: {d.get('source_file')}")

    lines.append('')
    lines.append('Connections:')
    for u, v in subgraph_edges[:30]:
        if u in subgraph_nodes and v in subgraph_nodes:
            d = G.edges[u, v]
            lines.append(
                f"  {G.nodes[u].get('label', u)} → "
                f"{G.nodes[v].get('label', v)} ({d.get('relation', 'related')})"
            )

    output = '\n'.join(lines)
    if len(output) > char_budget:
        output = output[:char_budget] + '\n... (truncated)'
    print(output)
