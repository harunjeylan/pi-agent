#!/usr/bin/env python3
"""Export graph to Neo4j Cypher or push directly."""

import json
import sys
from pathlib import Path
from typing import Any


def generate_cypher(graph_path: Path) -> str:
    """Generate Cypher statements from graph."""
    with open(graph_path) as f:
        data = json.load(f)
    
    statements = []
    
    # Clear existing (optional - commented out by default)
    # statements.append("MATCH (n) DETACH DELETE n;")
    
    nodes = data.get('nodes', [])
    edges = data.get('links', data.get('edges', []))
    
    # Create nodes
    for node in nodes:
        node_id = node.get('id', '').replace('"', '\\"')
        label = node.get('label', node_id).replace('"', '\\"')
        node_type = node.get('type', 'Node')
        community = node.get('community', 0)
        
        # Properties dict
        props = {
            'id': node_id,
            'label': label,
            'type': node_type,
            'community': community,
        }
        if 'file' in node:
            props['file'] = node['file']
        if 'line' in node:
            props['line'] = node['line']
        
        props_str = ', '.join([f"{k}: {json.dumps(v)}" for k, v in props.items()])
        
        cypher = f'CREATE (n:{node_type} {{{props_str}}});'
        statements.append(cypher)
    
    # Create edges
    for edge in edges:
        source = edge.get('source', '').replace('"', '\\"')
        target = edge.get('target', '').replace('"', '\\"')
        rel_type = edge.get('type', 'CONNECTS').upper()
        
        cypher = f'''
MATCH (a {{id: "{source}"}}), (b {{id: "{target}"}})
CREATE (a)-[:{rel_type}]->(b);
'''.strip()
        statements.append(cypher)
    
    return '\n'.join(statements)


def push_to_neo4j(cypher: str, bolt_url: str, user: str = "neo4j", password: str = "password") -> bool:
    """Push Cypher to Neo4j database."""
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("neo4j-python-driver required for push", file=sys.stderr)
        return False
    
    try:
        driver = GraphDatabase.driver(bolt_url, auth=(user, password))
        with driver.session() as session:
            # Run in transaction
            for statement in cypher.split(';'):
                stmt = statement.strip()
                if stmt:
                    session.run(stmt)
        driver.close()
        print(f"Pushed to Neo4j: {bolt_url}")
        return True
    except Exception as e:
        print(f"Neo4j push failed: {e}", file=sys.stderr)
        return False


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: neo4j_export.py <graph.json> <output.cypher> [--push bolt://url]", file=sys.stderr)
        sys.exit(1)
    
    graph_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    
    if not graph_path.exists():
        print(f"Graph not found: {graph_path}", file=sys.stderr)
        sys.exit(1)
    
    # Generate Cypher
    cypher = generate_cypher(graph_path)
    
    # Write to file
    output_path.write_text(cypher)
    print(f"Cypher exported: {output_path}")
    
    # Push if requested
    if len(sys.argv) > 4 and sys.argv[3] == "--push":
        bolt_url = sys.argv[4]
        push_to_neo4j(cypher, bolt_url)
