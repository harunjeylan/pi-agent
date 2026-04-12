---
name: brainstormer
description: Structured brainstorming agent for building business plans, project plans, and strategic documents through guided exploration, idea development, and organized decision-making.
---

# Brainstormer Skill - Complete Reference

Transform ideas into comprehensive documents through systematic exploration, idea generation, and structured documentation.

## Quick Start

```
@brainstormer Help me create a business plan for my SaaS startup
```

The agent will:
1. Ask targeted questions
2. Generate and explore options
3. Document decisions in notes
4. Produce the final document

---

## Document Types Supported

### 1. Business Plan
**Use for:** Startups, new ventures, expansions

**Key sections:**
- Executive Summary
- Problem & Solution
- Market Analysis
- Business Model
- Go-to-Market Strategy
- Team
- Financials

### 2. Project Plan
**Use for:** New initiatives, product launches, events

**Key sections:**
- Project Overview
- Objectives & Scope
- Timeline & Milestones
- Resources & Budget
- Risks & Mitigation
- Communication Plan

### 3. Product Plan
**Use for:** Product strategy, feature roadmaps

**Key sections:**
- Product Vision
- Target Users
- Problems & Solutions
- Features & Roadmap
- Success Metrics
- Competitive Position

### 4. Marketing Plan
**Use for:** Go-to-market, campaign strategies

**Key sections:**
- Market Overview
- Target Audience
- Value Proposition
- Channels & Tactics
- Budget & Timeline
- Measurement

### 5. Strategic Plan
**Use for:** Long-term organizational strategy

**Key sections:**
- Vision & Mission
- SWOT Analysis
- Strategic Objectives
- Initiatives
- Resource Allocation
- KPIs

### 6. Proposal
**Use for:** Client pitches, project bids

**Key sections:**
- Understanding
- Proposed Solution
- Approach
- Team
- Pricing
- Timeline
- Terms

---

## Discovery Questions Framework

### Universal Questions (All Document Types)

| Question | Purpose | Follow-up |
|----------|---------|-----------|
| What is the main goal? | Define objective | Why is this important? |
| Who is the audience? | Tailor content | What do they need? |
| What's the scope? | Set boundaries | What's excluded? |
| Any constraints? | Understand limits | Budget, time, resources |
| Success criteria? | Define metrics | How measured? |

### Business Plan Questions

**About the Business:**
- What business or idea is this?
- What problem does it solve?
- Who are target customers?
- What's the revenue model?
- What makes you unique?
- Stage: idea / MVP / scaling?

**About the Market:**
- How big is the market?
- Who are competitors?
- What's the trend?
- What's your advantage?

**About Operations:**
- How will you deliver?
- Key partners needed?
- Regulatory concerns?

### Project Plan Questions

**About the Project:**
- What's the project goal?
- Why now?
- What's the scope?
- What are deliverables?

**About Resources:**
- What's the budget?
- Who's on the team?
- What skills needed?
- Timeline expectations?

**About Stakeholders:**
- Who's sponsoring?
- Who approves?
- Who affected?

### Product Plan Questions

**About the Product:**
- What product/service?
- Stage: concept/beta/live?
- Core features?

**About Users:**
- Who are users?
- What problems to solve?
- User personas?

**About Competition:**
- Who competes?
- Your differentiation?
- Competitive advantages?

---

## Idea Generation Framework

### The CRAFT Method

**C**reate options - Generate 3-5 alternatives
**R**ank options - Evaluate against criteria
**A**nalyze trade-offs - Consider pros/cons
**F**reeze decision - Select approach
**T**rack rationale - Document reasoning

### Decision Matrix

| Criteria | Weight | Option A | Option B | Option C |
|----------|--------|----------|----------|----------|
| Cost | 30% | 8 | 6 | 7 |
| Speed | 20% | 7 | 9 | 5 |
| Quality | 30% | 8 | 7 | 9 |
| Risk | 20% | 6 | 8 | 5 |
| **Total** | 100% | **7.4** | **7.3** | **6.8** |

### Idea Exploration Prompts

**For generating options:**
- "What are different ways to approach this?"
- "What would X company do?"
- "What's the unconventional approach?"
- "What's the safest option? The boldest?"

**For evaluating:**
- "What would success look like for each option?"
- "What's the biggest risk of each?"
- "What resources does each need?"
- "Which aligns best with [stated goal]?"

---

## Creative Idea Generation Techniques

### 1. SCAMPER
**Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse**

| Technique | Question |
|-----------|----------|
| **S**ubstitute | What if we replaced X with Y? |
| **C**ombine | What if we merged X and Y? |
| **A**dapt | How does someone else solve this? |
| **M**odify | What if we changed X? |
| **P**ut to other use | What else could X be? |
| **E**liminate | What if we removed X? |
| **R**everse | What if we did the opposite? |

### 2. Six Thinking Hats
Different perspectives on the same idea:

| Hat | Focus | Questions |
|-----|-------|-----------|
| 🔴 White | Facts | What data do we have? |
| 🔴 Red | Emotions | How do people feel? |
| ⚫ Black | Caution | What could go wrong? |
| 🟡 Yellow | Optimism | What are the benefits? |
| 🟢 Green | Creativity | What new ideas emerge? |
| 🔵 Blue | Process | How should we think? |

### 3. Worst Idea First
1. Generate the **worst** possible version
2. Laugh about it
3. Ask: "What makes this terrible?"
4. The good idea often emerges by contrast

### 4. Time Travel
- **1920 thinking**: How would they solve this?
- **Present day**: How are others solving it?
- **2050 vision**: How might someone solve it?
- **Opposite industry**: How would Disney/Apple/Netflix?

### 5. Random Combination
1. Pick 2 random unrelated things
2. Force a connection
3. Ask: "What would this create?"

### 6. Domain Transfer
Borrow from other industries:

| Problem | Healthcare | Gaming | Aviation |
|---------|-----------|--------|----------|
| Engagement | Patient follow-up | Achievements | Crew comms |
| Training | Simulation | Tutorials | Checklists |
| Errors | Second opinions | Undo features | Black boxes |

### 7. What If...?
- What if money was no object?
- What if you had 10x the time?
- What if you couldn't fail?
- What if the opposite was true?
- What if you had no team?
- What if you had 100 people?

---

## Idea Generation Techniques Resources

Detailed guides for each technique:

- `techniques/business-ideas.md` - Business models & startups
- `techniques/product-ideas.md` - Product features & improvements
- `techniques/marketing-ideas.md` - Campaigns & promotions
- `techniques/problem-solving.md` - Tackling challenges
- `techniques/feature-ideation.md` - Deep dive features
- `techniques/domain-transfer.md` - Cross-industry innovation

---

## Notes Organization

### Folder Structure

```
{project-name}/
├── notes/
│   ├── 00-project-info.md
│   ├── 01-discovery.md
│   ├── 02-exploration/
│   │   ├── option-a.md
│   │   ├── option-b.md
│   │   └── option-c.md
│   ├── 03-decisions.md
│   ├── 04-outline.md
│   └── 05-sections/
│       ├── section-01.md
│       ├── section-02.md
│       └── ...
└── [final-document].md
```

### Note Templates

#### Project Info (00-project-info.md)
```markdown
# Project: [Name]

**Document Type:** Business Plan
**Created:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD

## Purpose
[Brief description of the document goal]

## Audience
[Who will read this]

## Key Contacts
- [Name]: [Role]
- [Name]: [Role]

## Success Criteria
[How we'll know it's successful]
```

#### Discovery Notes (01-discovery.md)
```markdown
# Discovery Session

## Answers to Core Questions

**Q: What is the main goal?**
A: [Answer]

**Q: Who is the audience?**
A: [Answer]

## Topic-Specific Answers

[Based on document type]

## Key Insights
- [Insight 1]
- [Insight 2]
- [Insight 3]

## Open Questions
- [Question to resolve]
- [Question to resolve]
```

#### Decision Log (03-decisions.md)
```markdown
# Decision Log

## Decision 1: [Topic]
**Date:** YYYY-MM-DD
**Status:** ✅ Decided

### Context
[Why this decision was needed]

### Options Considered
1. **Option A**: [Description]
2. **Option B**: [Description]

### Decision
[What was chosen]

### Rationale
[Why this choice]

### Implications
[What it means going forward]

---

## Decision 2: [Topic]
[Same structure]
```

---

## Document Templates

### Business Plan Template

```markdown
---
title: [Business Name] Business Plan
type: business-plan
author: [Author]
date: YYYY-MM-DD
---

# [Business Name]

## Executive Summary

### The Problem
[1-2 paragraphs]

### The Solution
[1-2 paragraphs]

### Market Opportunity
[1 paragraph with key metrics]

### Business Model
[How you make money]

### The Ask
[For funding: how much, what for]

---

## 1. Problem Statement

### The Pain
[Describe the problem your customers face]

### Current Alternatives
[How people solve it today]

### The Impact
[Why this matters - quantify if possible]

---

## 2. Solution

### Product/Service Description
[What you're offering]

### How It Works
[Step-by-step or process]

### Unique Value Proposition
[Why customers should choose you]

### Development Status
[Current stage]

---

## 3. Market Analysis

### Market Size
- **TAM:** [Total Addressable Market]
- **SAM:** [Serviceable Addressable Market]
- **SOM:** [Serviceable Obtainable Market]

### Target Customer
[Describe your ideal customer]

### Market Trends
[Relevant trends affecting market]

### Competitive Landscape
[List competitors and your differentiation]

---

## 4. Business Model

### Revenue Model
[How you make money]

### Pricing
[Price points]

### Unit Economics
- **CAC:** [Customer Acquisition Cost]
- **LTV:** [Lifetime Value]
- **LTV:CAC Ratio:** [X:1]

---

## 5. Go-to-Market Strategy

### Launch Plan
[How you'll launch]

### Channels
[Customer acquisition channels]

### Sales Process
[How you'll sell]

---

## 6. Operations

### Key Activities
[Core business activities]

### Key Partners
[Strategic partnerships]

### Key Resources
[Resources needed]

---

## 7. Team

### Leadership
[Key team members and backgrounds]

### Advisors
[Advisory board]

### Hiring Plan
[Key hires needed]

---

## 8. Financials

### Assumptions
[Key assumptions]

### Revenue Projections
[Year 1-3 projections]

### Key Metrics
[Monthly recurring revenue, customers, etc.]

### Funding Needs
[Current ask]

---

## 9. Appendix

[Supporting documents, data, contracts]
```

### Project Plan Template

```markdown
---
title: [Project Name] Project Plan
type: project-plan
author: [Author]
date: YYYY-MM-DD
---

# [Project Name] Project Plan

## Executive Summary

### Project Goal
[One sentence describing the goal]

### Expected Outcomes
- [Outcome 1]
- [Outcome 2]
- [Outcome 3]

### Timeline
[High-level timeline]

### Budget
[Total budget]

---

## 1. Project Overview

### Background
[Why this project is being initiated]

### Objectives
| Objective | Metric | Target |
|-----------|--------|--------|
| [Obj 1] | [Metric] | [Target] |
| [Obj 2] | [Metric] | [Target] |

---

## 2. Scope

### In Scope
- [Item 1]
- [Item 2]

### Out of Scope
- [Item 1]
- [Item 2]

---

## 3. Deliverables

| Deliverable | Description | Due Date |
|-------------|-------------|----------|
| [D1] | [Description] | [Date] |
| [D2] | [Description] | [Date] |

---

## 4. Timeline

### Milestones
| Milestone | Date | Dependencies |
|-----------|------|--------------|
| [M1] | [Date] | [Deps] |
| [M2] | [Date] | [Deps] |

### Detailed Schedule
[Phase-by-phase breakdown]

---

## 5. Resources

### Team
| Role | Person | Allocation |
|------|--------|------------|
| [Role] | [Name] | [%] |

### Budget
| Category | Amount |
|----------|--------|
| [Cat 1] | $[Amount] |
| [Cat 2] | $[Amount] |
| **Total** | **$[Total]** |

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [R1] | High/Med/Low | High/Med/Low | [Plan] |

---

## 7. Communication

### Stakeholders
| Stakeholder | Interest | Communication |
|-------------|----------|---------------|
| [S1] | High | [Weekly/monthly] |

### Reporting
- **Status Reports:** [Frequency]
- **Steering Committee:** [Frequency]

---

## 8. Acceptance Criteria

[How project success will be measured]

---

## Appendix

[Supporting documents]
```

---

## Writing Style Guide

### Language Principles

1. **Be specific** - Use real data, not "many customers"
2. **Be active** - "We will do X" not "X will be done"
3. **Be clear** - Short sentences, no jargon
4. **Be confident** - Avoid "might", "could", "possibly"
5. **Be realistic** - Acknowledge risks and challenges

### Tone by Document Type

| Document | Tone | Example |
|----------|------|---------|
| Business Plan | Confident, persuasive | "We will achieve..." |
| Project Plan | Clear, detailed | "The project will deliver..." |
| Proposal | Consultative, solution-focused | "We recommend..." |
| Strategy | Visionary, long-term | "By 2030, we will..." |

### Formatting Guidelines

- **Headings:** Use H1 for title, H2 for sections, H3 for subsections
- **Lists:** Use bullet points for items, numbered for sequences
- **Tables:** Use for comparisons and structured data
- **Emphasis:** Bold for key terms, italics for emphasis

---

## Idea Exploration Examples

### Example 1: Revenue Model Exploration

```
**For your revenue model, consider:**

**Option A: Subscription**
- Fixed monthly/annual fee
- Pros: Predictable revenue, customer retention
- Cons: Requires ongoing value, customer acquisition cost
- Best for: SaaS, services, content

**Option B: Transaction/Usage-based**
- Pay per use or per transaction
- Pros: Scale with usage, no commitment
- Cons: Variable income, no guaranteed base
- Best for: Platforms, marketplaces, utilities

**Option C: Hybrid**
- Base subscription + usage fees
- Pros: Stable base + upside potential
- Cons: More complex to price and manage
- Best for: Platforms with multiple value tiers

**Recommendation:** Start with A, add B for enterprise tier.
Which resonates with your vision?
```

### Example 2: Market Entry Strategy

```
**To reach your target market, options:**

**Option A: Direct Sales**
- Sell directly to customers
- Pros: Full control, higher margins, customer relationships
- Cons: Slower to scale, requires sales team
- Best if: High-value, complex sales

**Option B: Content Marketing**
- Attract through valuable content
- Pros: Low cost, builds authority, scalable
- Cons: Slow results, requires consistent effort
- Best if: SEO-friendly, educational product

**Option C: Partnerships**
- Leverage partner channels
- Pros: Fast distribution, partner credibility
- Cons: Revenue share, less control
- Best if: Complementary products

**Option D: Hybrid**
- Combine approaches by segment
- Pros: Best of all worlds
- Cons: Complex to manage
- Best if: Multiple customer segments

Which approach fits your resources and timeline?
```

---

## Troubleshooting

### User Gives Vague Answers

**Problem:** "I want to be successful"
**Response:** "Help me understand - what does success look like specifically? Is it hitting $X revenue, acquiring Y customers, or something else?"

### User Can't Decide Between Options

**Problem:** User likes multiple options
**Response:** "What if we combine them? Start with A for the MVP, add B for phase 2?"

### User Changes Direction Mid-Way

**Problem:** User wants to pivot after exploration
**Response:** "No problem! This is exactly what the exploration phase is for. Let's update our notes and see how this affects our earlier decisions."

### User Provides Too Much Information

**Problem:** Overwhelmed with details
**Response:** "Great details! Let me organize this. Can you highlight the 3 most important points?"

### User Provides Too Little Information

**Problem:** "I don't know yet"
**Response:** "That's okay - let's make a reasonable assumption for now and we can revisit if needed. Default is [X] unless you think otherwise."

---

## Best Practices Summary

1. **Ask before assuming** - Never guess, always ask
2. **Document everything** - Write decisions as they're made
3. **Explore multiple paths** - Don't settle on first idea
4. **Use frameworks** - Apply proven structures
5. **Stay flexible** - Plans can change
6. **Focus on decisions** - Not information, outcomes
7. **Keep user in control** - Guide, don't dictate
8. **Be patient** - Good documents take time

---

**Last Updated:** March 31, 2026
**Version:** 1.0.0
