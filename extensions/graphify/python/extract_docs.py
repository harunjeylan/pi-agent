#!/usr/bin/env python3
"""Extract entities and relationships from markdown documents.

Extends graphify to handle .md files for knowledge base graphs.
"""

import re
from pathlib import Path
from typing import Any


def extract_markdown(path: Path) -> dict[str, Any]:
    """Extract nodes and edges from a markdown file.
    
    Nodes:
        - File node (the document itself)
        - Heading nodes (sections)
        - Code block nodes
        - Wiki-link targets (referenced concepts)
    
    Edges:
        - Document -> contains -> Heading
        - Heading -> contains -> Subheading
        - Any node -> references -> Wiki-link target
        - Document -> has_code -> Code block
    """
    content = path.read_text(encoding='utf-8')
    lines = content.split('\n')
    
    nodes = []
    edges = []
    
    # File node
    file_node = {
        'id': str(path),
        'label': path.stem,
        'type': 'document',
        'file': str(path),
        'line': 1,
    }
    nodes.append(file_node)
    
    # Parse frontmatter
    frontmatter = {}
    if content.startswith('---'):
        try:
            _, fm, rest = content.split('---', 2)
            for line in fm.strip().split('\n'):
                if ':' in line:
                    k, v = line.split(':', 1)
                    frontmatter[k.strip()] = v.strip().strip('"\'')
            # Update file node with frontmatter
            if 'title' in frontmatter:
                file_node['label'] = frontmatter['title']
            if 'type' in frontmatter:
                file_node['doc_type'] = frontmatter['type']
        except ValueError:
            pass
    
    # Extract headings (create hierarchy)
    headings = []
    heading_stack = []  # Track parent headings
    
    for i, line in enumerate(lines, 1):
        # Match ATX headings: # Heading
        match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            anchor = re.sub(r'[^\w\s-]', '', title.lower()).replace(' ', '-')
            
            heading_id = f"{path}#{anchor}"
            heading_node = {
                'id': heading_id,
                'label': title,
                'type': 'heading',
                'file': str(path),
                'line': i,
                'level': level,
            }
            nodes.append(heading_node)
            headings.append(heading_node)
            
            # Manage parent relationship based on level
            while heading_stack and heading_stack[-1]['level'] >= level:
                heading_stack.pop()
            
            if heading_stack:
                # Parent is the previous heading with lower level
                edges.append({
                    'source': heading_stack[-1]['id'],
                    'target': heading_id,
                    'type': 'CONTAINS',
                    'line': i,
                })
            else:
                # Direct child of document
                edges.append({
                    'source': str(path),
                    'target': heading_id,
                    'type': 'CONTAINS',
                    'line': i,
                })
            
            heading_stack.append({'id': heading_id, 'level': level})
    
    # Extract wiki-links [[Target]] or [[Target|Display]]
    wiki_pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]')
    for i, line in enumerate(lines, 1):
        for match in wiki_pattern.finditer(line):
            target = match.group(1).strip()
            target_id = f"[[{target}]]"
            
            # Add target as a concept node if not exists
            existing = [n for n in nodes if n['id'] == target_id]
            if not existing:
                nodes.append({
                    'id': target_id,
                    'label': target,
                    'type': 'concept',
                    'file': str(path),
                    'line': i,
                })
            
            # Find nearest parent (heading or document)
            parent_id = str(path)
            for h in reversed(headings):
                if h['line'] <= i:
                    parent_id = h['id']
                    break
            
            edges.append({
                'source': parent_id,
                'target': target_id,
                'type': 'REFERENCES',
                'line': i,
            })
    
    # Extract code blocks
    in_code_block = False
    code_start = 0
    code_lang = ''
    code_content = []
    
    for i, line in enumerate(lines, 1):
        code_fence = re.match(r'^```(\w+)?', line)
        if code_fence:
            if not in_code_block:
                in_code_block = True
                code_start = i
                code_lang = code_fence.group(1) or 'text'
                code_content = []
            else:
                # End of code block
                in_code_block = False
                code_id = f"{path}:code:{code_start}"
                code_node = {
                    'id': code_id,
                    'label': f"Code ({code_lang})",
                    'type': 'code_block',
                    'file': str(path),
                    'line': code_start,
                    'language': code_lang,
                    'content': '\n'.join(code_content)[:500],  # Truncate
                }
                nodes.append(code_node)
                
                # Link to nearest heading
                parent_id = str(path)
                for h in reversed(headings):
                    if h['line'] <= code_start:
                        parent_id = h['id']
                        break
                
                edges.append({
                    'source': parent_id,
                    'target': code_id,
                    'type': 'CONTAINS',
                    'line': code_start,
                })
        elif in_code_block:
            code_content.append(line)
    
    # Extract inline code references (function names, etc)
    inline_code_pattern = re.compile(r'`([^`]+)`')
    for i, line in enumerate(lines, 1):
        # Skip code blocks
        if i >= code_start and i < code_start + len(code_content) + 1:
            continue
        
        for match in inline_code_pattern.finditer(line):
            code_text = match.group(1).strip()
            # Only meaningful code refs (function calls, etc)
            if '(' in code_text or '.' in code_text or len(code_text) > 3:
                code_id = f"{path}:inline:{i}:{code_text[:30]}"
                nodes.append({
                    'id': code_id,
                    'label': code_text[:50],
                    'type': 'inline_code',
                    'file': str(path),
                    'line': i,
                })
                
                parent_id = str(path)
                for h in reversed(headings):
                    if h['line'] <= i:
                        parent_id = h['id']
                        break
                
                edges.append({
                    'source': parent_id,
                    'target': code_id,
                    'type': 'MENTIONS',
                    'line': i,
                })
    
    # Extract bare URLs as external references
    url_pattern = re.compile(r'https?://[^\s\)\]<>]+')
    for i, line in enumerate(lines, 1):
        for match in url_pattern.finditer(line):
            url = match.group(0)
            url_id = f"@url:{url[:100]}"
            existing = [n for n in nodes if n['id'] == url_id]
            if not existing:
                nodes.append({
                    'id': url_id,
                    'label': url[:50],
                    'type': 'external_link',
                    'file': str(path),
                    'line': i,
                })
            
            parent_id = str(path)
            for h in reversed(headings):
                if h['line'] <= i:
                    parent_id = h['id']
                    break
            
            edges.append({
                'source': parent_id,
                'target': url_id,
                'type': 'LINKS_TO',
                'line': i,
            })
    
    return {
        'nodes': nodes,
        'edges': edges,
        'entities': nodes,  # For compatibility
        'relationships': edges,  # For compatibility
    }


def extract_documents(paths: list[Path]) -> dict[str, Any]:
    """Extract from multiple markdown documents.
    
    Returns combined graph data with cross-document link resolution.
    """
    all_nodes = []
    all_edges = []
    
    # Build file lookup for cross-document wiki-links
    file_lookup = {}
    for p in paths:
        if p.suffix.lower() in ('.md', '.markdown', '.mdx'):
            file_lookup[p.stem.lower()] = str(p)
            # Also index by headings
            try:
                content = p.read_text(encoding='utf-8')
                for line in content.split('\n'):
                    match = re.match(r'^#{1,6}\s+(.+)$', line)
                    if match:
                        anchor = re.sub(r'[^\w\s-]', '', match.group(1).lower()).replace(' ', '-')
                        file_lookup[f"{p.stem.lower()}#{anchor}"] = f"{p}#{anchor}"
            except Exception:
                pass
    
    # Extract each document
    for p in paths:
        if p.suffix.lower() not in ('.md', '.markdown', '.mdx'):
            continue
        
        try:
            result = extract_markdown(p)
            all_nodes.extend(result['nodes'])
            all_edges.extend(result['edges'])
        except Exception as e:
            print(f"Warning: failed to extract {p}: {e}", file=__import__('sys').stderr)
    
    # Resolve cross-document wiki-links
    for edge in all_edges:
        if edge['type'] == 'REFERENCES':
            target = edge['target'].strip('[]')
            target_lower = target.lower()
            
            # Try exact match first
            if target_lower in file_lookup:
                edge['target'] = file_lookup[target_lower]
                edge['resolved'] = True
            else:
                # Try fuzzy match on stem
                for stem, full_path in file_lookup.items():
                    if '#' not in stem and stem in target_lower:
                        edge['target'] = full_path
                        edge['resolved'] = True
                        break
    
    return {
        'nodes': all_nodes,
        'edges': all_edges,
        'entities': all_nodes,
        'relationships': all_edges,
        'files': [str(p) for p in paths if p.suffix.lower() in ('.md', '.markdown', '.mdx')],
        'input_tokens': sum(len(str(n)) for n in all_nodes) // 4,
        'output_tokens': sum(len(str(e)) for e in all_edges) // 4,
    }


if __name__ == "__main__":
    import json
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: extract_docs.py <markdown_file> [<markdown_file>...]", file=sys.stderr)
        sys.exit(1)
    
    paths = [Path(p) for p in sys.argv[1:]]
    result = extract_documents(paths)
    print(json.dumps(result, indent=2))
