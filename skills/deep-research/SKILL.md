---
name: deep-research
description: Comprehensive research skill for conducting deep searches with iterative multi-engine search, document conversion, and academic-style citations.
version: "3.0.0"
---

# Deep Research Skill v3.0 - Multi-Engine Iterative Research

Conduct thorough research using iterative multi-engine searches with proper tool usage, document conversion, and academic citations.

## Quick Start

```
@deep-research Research [topic]
```

The agent will:
1. Execute iterative multi-engine search (up to 10 searches)
2. Analyze gaps and refine queries between rounds
3. Process documents with markitdown and appropriate fetchers
4. Deduplicate and select best sources across all searches
5. Deep fetch and analyze each selected source
6. Synthesize with proper citations
7. Generate comprehensive report with References

## When to Use

Use this skill when you need:
- **Deep research** on any topic (not quick answers)
- **Comprehensive coverage** via multiple search engines
- **Document analysis** (PDF, DOCX, PPTX, GitHub, CSDN, Juejin, Linux.do)
- **Academic-style** reports with proper citations
- **Thorough understanding** with all sources attributed

---

## PHASE 1: ITERATIVE MULTI-ENGINE SEARCH (Steps 1-10)

### Search Strategy

Execute up to 10 searches across different engines. Rotate engines to avoid rate limits.

**Engine Rotation Pattern:**

| Search # | Engines | Operations | Query Strategy |
|----------|---------|------------|----------------|
| 2 | bing | `search` | Same query, verify results |
| 3 | duckduckgo | `search` | Refined based on gaps |
| 4 | brave | `search` | Alternative results |
| 5 | baidu | `search` | Different perspective |
| 6 | csdn | `search` + `fetchCsdnArticle` | Chinese tech resources |
| 7 | juejin | `fetchJuejinArticle` | Chinese dev community |
| 8 | linux.do | `fetchLinuxDoArticle` | Community discussions |
| 9 | bing (different query) | `search` | Subtopic exploration |
| 10 | github readme | `fetchGithubReadme` | Code examples if relevant |

### Gap Analysis Between Searches

After each search round:
1. Analyze results - what aspects are covered?
2. Identify gaps - what's missing?
3. Refine query - add subtopics, different keywords
4. Choose next engine
5. Execute next search with modified query

**Query Evolution Example:**
```
Initial: "quantum computing applications"
After round 1: "quantum computing applications 2025" (add year)
After round 3: "quantum computing healthcare finance applications" (add domains)
After round 5: "quantum computing drug discovery market" (specific use cases)
```

### Web-Search Operations Usage

| Operation | When to Use | Example |
|-----------|-------------|---------|
| `search` | General web search for articles, blogs, news | Most searches |
| `fetchWeb` | Specific URL found in search results | Fetch a specific article |
| `fetchGithubReadme` | GitHub repositories found | Get code examples, projects |
| `fetchCsdnArticle` | Chinese tech articles | CSDN blog posts |
| `fetchJuejinArticle` | Chinese dev content | Juejin technical articles |
| `fetchLinuxDoArticle` | Community discussions | Linux.do posts |

### Search Execution Rules

1. **Never repeat same engine twice** in a row (rate limit protection)
2. **Use `fetchGithubReadme`** when GitHub repos appear - high priority for code examples
3. **Use `fetchCsdnArticle`/`fetchJuejinArticle`** when Chinese resources found
4. **Use `fetchWeb`** for specific URLs that need detailed fetching
5. **Track all sources** - they may be used later
6. **Stop early** if saturation reached (no new relevant results)

---

## PHASE 2: DOCUMENT PROCESSING

For each document type found during search:

| Document Type | Tool | Action |
|---------------|------|--------|
| PDF | `markitdown` | Convert to markdown |
| DOCX | `markitdown` | Convert to markdown |
| PPTX | `markitdown` | Convert to markdown |
| HTML/Web | `fetchWeb` | Convert to markdown |
| GitHub README | `fetchGithubReadme` | Fetch as markdown |
| CSDN article | `fetchCsdnArticle` | Convert to markdown |
| Juejin article | `fetchJuejinArticle` | Convert to markdown |
| Linux.do article | `fetchLinuxDoArticle` | Convert to markdown |

**Important:** Process documents during search phase, not after. This gives better context for query refinement.

---

## PHASE 3: SOURCE SELECTION

### Deduplication
- Combine all sources from all 10 searches
- Remove exact duplicates
- Merge near-duplicates (same content, different URLs)

### Scoring & Ranking
- Score each source by relevance to topic
- Consider: authority, recency, depth, uniqueness
- Rank all sources

### Final Selection
- Select **top 3-5 sources** for deep analysis
- Prioritize sources with:
  - Comprehensive content
  - Authoritative authorship
  - Recent publication
  - Unique insights

---

## PHASE 4: DEEP CONTENT FETCHING (Steps 11-15)

**For EACH selected source:**
1. Fetch full content using appropriate tool
2. Assign unique SOURCE_ID (e.g., OpenAI2024, Microsoft2025)
3. Extract key information
4. Create detailed note with:
   - Main points
   - Data/statistics (with SOURCE_ID)
   - Quotes (with SOURCE_ID and page number)
   - Unique insights
   - Analysis

---

## PHASE 5: SYNTHESIS (Step 16)
- Compare findings across sources
- Identify patterns and consensus (with SOURCE_IDs)
- Note conflicts and gaps
- Use academic citation format

---

## PHASE 6: FINAL REPORT (Step 17)
- Generate comprehensive report
- Include all findings with in-text citations
- Provide References section
- Academic writing style

---

## Session Structure

Research is saved to: `sessions/[research-topic]/`

```
sessions/
└── [topic]/
    ├── 01-search-results.md      # All 10 searches with sources
    ├── 02-document-processing.md # Converted docs from markitdown
    ├── 03-source-selection.md   # Deduplicated & ranked sources
    ├── 04-source-1.md           # Deep analysis with SOURCE_ID
    ├── 05-source-2.md           # Deep analysis with SOURCE_ID
    ├── 06-source-3.md           # Deep analysis with SOURCE_ID
    ├── 07-source-4.md           # Deep analysis with SOURCE_ID
    ├── 08-source-5.md           # Deep analysis with SOURCE_ID
    ├── 09-synthesis.md          # Cross-reference with citations
    └── 10-final-report.md       # Final report with References
```

---

## Source Note Format (Academic Style)

```markdown
---
title: "[Source Name] - Deep Analysis"
source: "[Full URL]"
source-id: "[SOURCE_ID]"
research-step: [step number]
source-type: [article/documentation/blog/paper/github]
author: [Author/Organization]
publication-date: [Date]
relevance: [High/Medium/Low]
---

# [Source Title]

## Source Information
- **URL:** [full URL]
- **Source ID:** [SOURCE_ID]
- **Type:** [type]
- **Author/Organization:** [Author]
- **Publication Date:** [Date]
- **Relevance:** High/Medium/Low
- **Why selected:** [explanation]

## Key Findings

### Main Points
- [Point 1 - detailed]
- [Point 2 - detailed]
- [Point 3 - detailed]

### Data & Statistics
- [Stat 1]: [value and context] [SOURCE_ID]
- [Stat 2]: [value and context] [SOURCE_ID]
- [Stat 3]: [value and context] [SOURCE_ID]

### Unique Insights
- [Insight 1]
- [Insight 2]

### Direct Quotes (Academic Style)

> "[Important quote 1]"
> 
> — [SOURCE_ID], p. [page number]
> 
> **Context:** [why this matters]

> "[Important quote 2]"
> 
> — [SOURCE_ID], p. [page number]
> 
> **Context:** [why this matters]

## Source Analysis
**Reliability:** High/Medium/Low - Why
**Bias:** [Any potential bias]
**Value:** [What it contributes]

## Key Takeaways
- [Takeaway 1]
- [Takeaway 2]
```

---

## Citation System (Academic Style)

### SOURCE_ID Format
- Format: `[Author/Organization][Year]`
- Examples: `OpenAI2024`, `Microsoft2025`, `ArXiv2024`, `LangChain2024`

### Citation Examples

**Quote:**
```
> "This is an important quote about the topic."
> 
> — OpenAI2024, p. 15
```

**Statistic:**
```
- Key finding: 85% of researchers agree [LangChain2024]
- Market growth: 300% in 2024 [Microsoft2025]
```

**In-text:**
```
According to OpenAI2024, "the future of AI is..." (p. 23). 
This aligns with Microsoft2025's findings.
```

---

## Final Report Format

```markdown
# [Topic] - Comprehensive Research Report

## Research Overview
- **Topic:** [topic]
- **Sources Analyzed:** [number]
- **Search Iterations:** [number]
- **Date:** [date]
- **Research Method:** Multi-engine iterative search with deep analysis

## Executive Summary
[2-3 sentences summarizing key findings]

## Background
[Context needed to understand the topic]

## Key Findings

### Finding 1: [Title]
[Detailed explanation]

According to [SOURCE_ID], "[quote]" (p. [page]). 

### Finding 2: [Title]
[Detailed explanation]

## Cross-Source Analysis

### Consensus Points
- [Point 1] ([SOURCE_ID1], [SOURCE_ID2], [SOURCE_ID3])
- [Point 2] ([SOURCE_ID1], [SOURCE_ID2])

### Conflicting Viewpoints
- [Viewpoint 1]: [SOURCE_ID1] argues "[quote]" while [SOURCE_ID2] contends "[quote]"

## Source Comparison
| Source ID | Type | Key Contribution | Reliability |
|-----------|------|------------------|-------------|
| [SOURCE_ID] | [type] | [contribution] | High/Med/Low |

## Gaps & Limitations
- [Information not found]
- [Potential biases]
- [Areas needing more research]

## Conclusions

## References
1. [SOURCE_ID1]: [Full citation]
2. [SOURCE_ID2]: [Full citation]
```

---

## Workflow Checklist

- [ ] Phase 1: Execute up to 10 searches with different engines
- [ ] Phase 1: Use all 6 web-search operations appropriately
- [ ] Phase 1: Use markitdown for PDF/DOCX/PPTX
- [ ] Phase 2: Process documents during search phase
- [ ] Phase 3: Deduplicate all sources
- [ ] Phase 3: Select top 3-5 for deep analysis
- [ ] Phase 4: Assign SOURCE_ID to each deep-fetched source
- [ ] Phase 4: All quotes include SOURCE_ID and page number
- [ ] Phase 4: All statistics include SOURCE_ID
- [ ] Phase 5: Synthesis uses SOURCE_IDs for citations
- [ ] Phase 6: Final report has in-text citations
- [ ] Phase 6: References section includes all SOURCE_IDs

---


## Notes

- **Gap analysis is critical** - use it to refine queries
- **Use all 6 operations** - each has specific purpose
- **Process docs early** - better context for refinement
- **Deduplicate** - avoid analyzing same source twice
- **SOURCE_ID is essential** - use consistently throughout
