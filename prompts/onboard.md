---
description: Transform any folder into a purpose-built workspace through interactive discovery and automated setup.
model: opencode/big-pickle
agent: assistant
---

# /onboard Command

Transform any folder into a purpose-built workspace.

## Conversation Flow

1. **Welcome** - Explain what you'll do
2. **Ask name** - "What's your name?"
3. **Ask nickname** - "What should I call you?" (for personalization)
4. **Ask ONE question at a time** with context and examples
5. **Adapt next question** based on their answer
6. **Show thinking** - Explain what you learned
7. **Propose structure** - Show folder layout (WITHOUT parent folder name)
8. **Get approval** - Ask if they want to create as-is, modify, or ask questions
9. **Create workspace** - Build folders in current directory + AGENTS.md (with user profile)

## Key Points

- Ask **ONE question**, wait for answer, then ask next
- Provide **context and examples** for each question
- **Adapt questions** based on previous answers
- **Propose structure** before creating (get approval)
- **Create folders in current directory** - NOT in a subdirectory
- **Use nickname** in all future conversations
- Use **Question tool** for input/select
- DO NOT ask "Would you like to start?" - JUST START

## Reference

- **[Workspace Skill](../skills/workspace/SKILL.md)** - Full template details
