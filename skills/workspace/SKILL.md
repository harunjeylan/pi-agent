---
name: workspace
description: Comprehensive workspace management with folder structures, templates, and organization for any use case
version: "1.0.0"
---

# Workspace Skill

Create organized, purpose-built folder structures for any type of work.

## Question Rule

**When setting up a workspace, ask ONE question at a time. Each question MUST depend on the previous answer.**

Never ask multiple questions at once.

## What It Does

Provides 25+ pre-built folder structure templates:
- Consulting & Professional Services (6 templates)
- Content Creation (4 templates)
- Data & Research (3 templates)
- Operations & Business (3 templates)
- Creative & Design (3 templates)
- Education & Learning (3 templates)
- Personal & Life (3 templates)

All templates are fully customizable.

**Note:** For software development projects, use `/init` command instead.

## When to Use

- Starting a new project
- Reorganizing an existing folder
- Setting up a team workspace
- Creating a template for repeated work

## Usage

```
@workspace Set up a [template name] workspace
@workspace Create custom workspace with: folder1, folder2, folder3
@workspace Use [template] but add [custom folder]
```

## Setup Workflow

### Step 1: Ask One Question at a Time

**Q1:** "What's your name?" (for personalization)

Wait for answer, then ask Q2.

**Q2:** "What should I call you?" (nickname for future conversations)

**Q3:** "What's the primary purpose of this workspace?" (research/writing/projects/business)

Based on Q3 answer, ask follow-up questions:
- If business → "What type of business?"
- If research → "What kind of research?"
- If writing → "What type of content?"

**Q4:** "Do you have any specific folders you need?" (custom requirements)

Continue asking one question at a time based on their answers.

### Step 2: Propose Structure
1. Show proposed folder structure
2. Ask for confirmation

### Step 3: Create
1. Create folders in current directory
2. Create AGENTS.md with user profile

## Templates

See `templates/` directory for all available templates.

### Consulting & Professional Services
| Template | Description |
|----------|-------------|
| management-consulting.md | Client engagements, proposals, methodologies |
| legal-practice.md | Cases, clients, contracts, research |
| accounting.md | Clients, tax, audit, bookkeeping |
| marketing-agency.md | Clients, campaigns, creative, media |
| real-estate.md | Listings, clients, transactions, marketing |
| hr-recruitment.md | Clients, candidates, jobs, screening |

### Content Creation
| Template | Description |
|----------|-------------|
| blog-writing.md | Posts, templates, media, research, SEO, audio |
| social-media.md | Content by platform, campaigns, assets, analytics |
| documentation.md | Source docs, assets, locales, build, audio |
| video-production.md | Projects, assets, templates, scripts, audio |

### Data & Research
| Template | Description |
|----------|-------------|
| data-science.md | Data, notebooks, models, experiments |
| academic-research.md | Literature, data, analysis, findings, manuscripts |
| business-intelligence.md | Data sources, reports, metrics, dashboards |

### Operations & Business
| Template | Description |
|----------|-------------|
| project-management.md | Projects, resources, templates, processes |
| business-operations.md | Finance, legal, operations, HR, sales, marketing |
| customer-support.md | Customers, tickets, knowledge base, feedback |

### Creative & Design
| Template | Description |
|----------|-------------|
| graphic-design.md | Projects, assets, branding, inspiration |
| photography.md | Sessions, portfolios, clients, presets |
| music-production.md | Projects, samples, plugins, recordings, releases |

### Education & Learning
| Template | Description |
|----------|-------------|
| online-course.md | Courses, modules, students, resources, marketing, voiceovers |
| knowledge-management.md | Areas, notes, sources, templates, reviews |
| teaching.md | Classes, students, planning, professional, admin |

### TTS & Audio Production
| Template | Description |
|----------|-------------|
| tts-production.md | Scripts, processed scripts, audio, voices, exports |

### Personal & Life
| Template | Description |
|----------|-------------|
| personal-para.md | Projects, areas, resources, archive, inbox |
| travel-planning.md | Trips, wishlist, guides, documents |
| event-planning.md | Events, resources, inspiration |

## Custom Structure

Create custom folder structures:

```yaml
workspace_name: "My Workspace"
purpose: "Description"
folders:
  - name: "main"
    subfolders:
      - "sub1"
      - "sub2"
  - name: "archive"
```

## Workspace Management

### Setting Up New Project
1. Identify project type
2. Choose template
3. Customize as needed
4. Create structure
5. Add AGENTS.md

### Ongoing Management
- Add folder: Create in appropriate location
- Move content: Use logical structure, update references
- Archive: Move to archive/ or archive/[year]/
- Review: Quarterly check

### AGENTS.md Structure
```markdown
# Workspace: [Name]

## Purpose
[Brief description]

## Structure
- folder/ - [Description]

## Workflows
- [How to use]
```
