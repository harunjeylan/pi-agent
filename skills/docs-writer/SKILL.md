---
name: docs-writer
description: Professional document writing skill with templates and structured workflow
version: "1.0.0"
---

# Docs Writer Skill

Transform any input into professional documents through structured questioning.

---

## Workflow

### Step 1: Ask Questions (One at a Time)

**Q1:** "What type of document do you need?" (report, proposal, guide, etc.)

**Q2:** "What is the purpose?" (inform, persuade, instruct)

**Q3:** "Who is the audience?"

**Q4:** "How long should it be?" (brief/standard/comprehensive)

### Step 2: Check for Sources
Scan workspace for relevant content in:
- `docs/` - existing documents
- `notes/` - notes and summaries
- `research/` - research files

Options: Use existing source / Provide new source / Research online

### Step 3: Create Outline
1. Create markdown outline with structure
2. Get user confirmation (MUST approve before writing)

### Step 4: Write Content
1. Write content based on outline and sources
2. Get user confirmation

### Step 5: Finalize
1. Review and polish
2. Save to project's docs/ folder

---

## Document Templates

See `templates/` folder:

| Template | Use Case |
|----------|----------|
| business-plan.md | Startups |
| project-plan.md | Initiatives |
| marketing-plan.md | Campaigns |
| product-spec.md | Features |
| technical-doc.md | Tech docs |
| proposal.md | Pitches |
| report.md | Research |
| guide.md | How-tos |
| sop.md | Procedures |
| brief.md | Executive |
| email.md | Professional emails |

See `examples/` for complete document examples.

---

## Template Creation

When no template fits:

1. **Draft structure** based on questions
2. **Get approval** from user
3. **Save to** `templates/[name].md`

### Template Frontmatter
```yaml
---
title: [Name]
description: [What it's for]
created: YYYY-MM-DD
use-case: [When to use]
---
```

---

## Writing Tips

### Clarity
❌ "The report was written by the team"
✅ "The team wrote the report"

### Specificity
❌ "Many customers prefer our product"
✅ "73% of surveyed customers prefer our product"

### Structure
- H1: Document title
- H2: Major sections
- H3: Subsections
- Lists for items
- Tables for data

### Transitions
- "However..."
- "Additionally..."
- "As a result..."
- "For example..."
