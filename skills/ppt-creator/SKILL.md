---
name: ppt-creator
description: "Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill."
version: "1.0.0"
---

# PPT Creator Skill

Create professional PowerPoint presentations using PptxGenJS and @run-script tool.

---

## Workflow

**Important:** Use absolute path to workspace root. The run-script tool provides `context.directory` - build path dynamically or use resolved path at runtime.

### Step 1: Ask Questions (One at a Time)

**Q1:** "What is the presentation about?" (topic/purpose)

**Q2:** "Who is the audience?"

**Q3:** "What theme do you prefer?" (modern/professional/minimal/vibrant/golden/executive/ocean/forest/sunset)

### Step 2: Check for Sources
Scan workspace for relevant content in:
- `docs/` - existing documents
- `notes/` - notes and summaries
- `research/` - research files

Options: Use existing source / Provide new source / Research online

### Step 3: Create Outline
1. Define slide structure and types
2. Map each slide to appropriate layout
3. Get user confirmation

### Step 4: Write PptxGenJS Script
Use multi-file approach for better debugging and maintenance:

```
.pi/sandbox/[topic]/
├── main.ts              # Main entry point - creates presentation
└── slides/
    ├── slide-1.ts       # Title slide
    ├── slide-2.ts      # Content slide
    └── slide-N.ts      # Additional slides
```

**main.ts**: Creates presentation, imports and calls each slide function

**slides/slide-[index].ts**: Each file exports a function that adds ONE slide to presentation

Use this approach so agent can update specific slides without breaking others.

**Important:** Always use ABSOLUTE paths for output files:

1. Use @run-script tool to execute
2. **DO NOT install any packages with npm - pptxgenjs is already available globally**

### Step 5: Generate PPT
1. Run: `@run-script .pi/sandbox/[topic]/main.ts`

---

## Tool

```
@run-script .pi/sandbox/[topic]/main.ts
```

### Multi-File Structure

Use this structure for maintainability:

```
.pi/sandbox/[topic]/
├── main.ts              # Entry point
└── slides/
    ├── slide-1.ts       # Title slide
    ├── slide-2.ts       # Content slides
    └── slide-N.ts
```

### main.ts Format

Define base configuration in one place and pass to each slide with optional overrides:

```typescript
import { slide1 } from "./slides/slide-1";
import { slide2 } from "./slides/slide-2";

const pres: any = new (require("pptxgenjs"))();
pres.layout = 'LAYOUT_16x9';
pres.author = 'Author Name';
pres.title = 'Presentation Title';

const config = {
  colors: {
    primary: "1E3A5F",
    secondary: "4A90D9",
    accent: "F5A623",
    background: "FFFFFF",
    text: "333333",
    lightBg: "F5F7FA"
  },
  fonts: {
    header: "Arial",
    body: "Calibri"
  }
};

slide1(pres, config);
slide2(pres, config, { colors: { primary: "FF5733" } });  // override for specific slide
slide3(pres, config);

// Use path.resolve to build absolute path from script location
// Script is at .pi/sandbox/[topic]/main.ts
const path = require("path");
const outputPath = path.resolve(__dirname, "../../../[output folder based on workpace location]/topic.pptx");
pres.writeFile({ fileName: outputPath });
```

### Slide Function Format

Each slide receives presentation + config + optional override:

```typescript
export function slide1(pres: any, config: any, override?: any) {
  const slide = pres.addSlide();
  const colors = { ...config.colors, ...override?.colors };
  const fonts = { ...config.fonts, ...override?.fonts };
  
  slide.addText("Title", {
    x: 0.5, y: 0.5, fontSize: 36, 
    color: colors.primary,
    fontFace: fonts.header
  });
}
```
```

### Key API

| Method | Use |
|--------|-----|
| `pres.addSlide()` | New slide |
| `slide.addText()` | Text, bullets, rich text |
| `slide.addShape()` | Rectangle, oval, line |
| `slide.addImage()` | Images (path, URL, base64) |
| `slide.addChart()` | Bar, line, pie charts |
| `slide.addTable()` | Tables |

### Common Options

```javascript
// Text
{ x: 0.5, y: 0.5, w: 8, h: 1, fontSize: 24, color: "363636", bold: true, align: "center" }

// Shapes
{ x: 1, y: 1, w: 3, h: 2, fill: { color: "FFFFFF" }, shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 } }

// Colors: NO "#" prefix (use "FF0000" not "#FF0000")
// Shadows: Create fresh object each time (don't reuse option objects)
```

Read `./pptxgenjs.md` for more details

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone. Consider ideas from this list for each slide.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic. If swapping your colors into a completely different presentation would still "work," you haven't made specific enough choices.
- **Dominance over equality**: One color should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles, thick single-side borders. Carry it across every slide.

### Color Palettes

Choose colors that match your topic — don't default to generic blue. Use these palettes as inspiration:

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration on right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image on one side, grid of content blocks on other)
- Half-bleed image (full left or right side) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

**Choose an interesting font pairing** — don't default to Arial. Pick a header font with personality and pair it with a clean body font.

| Header Font | Body Font |
|-------------|-----------|
| Georgia | Calibri |
| Arial Black | Arial |
| Calibri | Calibri Light |
| Cambria | Calibri |
| Trebuchet MS | Calibri |
| Impact | Arial |
| Palatino | Garamond |
| Consolas | Calibri |

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Spacing

- 0.5" minimum margins
- 0.3-0.5" between content blocks
- Leave breathing room—don't fill every inch

### Avoid (Common Mistakes)

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin: 0` on the text box or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background; avoid light text on light backgrounds or dark text on dark backgrounds
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead
