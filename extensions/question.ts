/**
 * Question Tool - Unified tool for asking single or multiple questions
 *
 * Single question: simple options list
 * Multiple questions: tab bar navigation between questions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
  multiSelect: boolean;
}

interface Answer {
  id: string;
  values: string[];
  labels: string[];
  wasCustom: boolean;
  indices?: number[];
}

interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

// Schema
const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, {
    description: "Available options to choose from",
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Allow 'Type something' option (default: true)",
    }),
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      description:
        "Allow multiple selections (checkbox UI). Default: false (single select)",
    }),
  ),
});

const QuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "Questions to ask the user",
  }),
});

function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

export default function question(pi: ExtensionAPI) {
  pi.registerTool({
    name: "question",
    label: "Question",
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    parameters: QuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult(
          "Error: UI not available (running in non-interactive mode)",
        );
      }
      if (params.questions.length === 0) {
        return errorResult("Error: No questions provided");
      }

      // Normalize questions with defaults
      const questions: Question[] = params.questions.map((q, i) => ({
        ...q,
        label: q.label || `Q${i + 1}`,
        allowOther: q.allowOther !== false,
        multiSelect: q.multiSelect === true,
      }));

      const isMulti = questions.length > 1;
      const totalTabs = questions.length + 1; // questions + Submit

      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _kb, done) => {
          // State
          let currentTab = 0;
          let optionIndex = 0;
          let inputMode = false;
          let inputQuestionId: string | null = null;
          let cachedLines: string[] | undefined;
          const answers = new Map<string, Answer>();
          // For multi-select: track selected option values for current question
          const selectedOptions = new Set<string>();
          // Store custom input values per question for multi-select
          const customInputs = new Map<string, string>();

          // Editor for "Type something" option
          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          // Helpers
          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function submit(cancelled: boolean) {
            done({
              questions,
              answers: Array.from(answers.values()),
              cancelled,
            });
          }

          function currentQuestion(): Question | undefined {
            return questions[currentTab];
          }

          function currentOptions(): RenderOption[] {
            const q = currentQuestion();
            if (!q) return [];
            const opts: RenderOption[] = [...q.options];
            if (q.allowOther) {
              opts.push({
                value: "__other__",
                label: "Type something.",
                isOther: true,
              });
            }
            return opts;
          }

          function allAnswered(): boolean {
            return questions.every((q) => {
              // Has submitted answer
              if (answers.has(q.id)) return true;
              // Has pending custom input (for multi-select that's not yet submitted)
              if (q.multiSelect && customInputs.has(q.id)) return true;
              return false;
            });
          }

          // Save any pending custom inputs to answers before final submit
          function flushPendingInputs() {
            for (const q of questions) {
              if (
                q.multiSelect &&
                customInputs.has(q.id) &&
                !answers.has(q.id)
              ) {
                const customValue = customInputs.get(q.id)!;
                saveAnswer(q.id, [customValue], [customValue], true, [0]);
              }
            }
          }

          function advanceAfterAnswer() {
            if (!isMulti) {
              submit(false);
              return;
            }
            if (currentTab < questions.length - 1) {
              currentTab++;
            } else {
              currentTab = questions.length; // Submit tab
            }
            optionIndex = 0;
            refresh();
          }

          function saveAnswer(
            questionId: string,
            values: string[],
            labels: string[],
            wasCustom: boolean,
            indices?: number[],
          ) {
            answers.set(questionId, {
              id: questionId,
              values,
              labels,
              wasCustom,
              indices,
            });
          }

          // Clear selections when cancelling
          function clearSelections() {
            selectedOptions.clear();
            // Clear current question's custom input if any
            const q = currentQuestion();
            if (q) {
              customInputs.delete(q.id);
            }
          }

          // Save multi-select answer and advance
          function submitMultiSelect() {
            const q = currentQuestion();
            if (!q || selectedOptions.size === 0) return;

            const values: string[] = [];
            const labels: string[] = [];
            const indices: number[] = [];

            const opts = currentOptions();
            const customValue = customInputs.get(q.id) || "";

            for (let i = 0; i < opts.length; i++) {
              const opt = opts[i];
              if (opt.isOther) {
                // "Type something." option - check if custom value was entered
                if (customValue) {
                  values.push(customValue);
                  labels.push(customValue);
                }
              } else if (selectedOptions.has(opt.value)) {
                // Regular option is selected
                values.push(opt.value);
                labels.push(opt.label);
                indices.push(i + 1);
              }
            }

            // If there are selections, save and advance
            if (values.length > 0) {
              const wasCustom = customValue ? true : false;
              saveAnswer(q.id, values, labels, wasCustom, indices);
              selectedOptions.clear();
              // Don't clear customInputs - keep it for when user comes back
              editor.setText("");
              advanceAfterAnswer();
            }
          }

          // Editor submit callback - handles custom input for both single and multi
          editor.onSubmit = (value) => {
            if (!inputQuestionId) return;
            const q = currentQuestion();
            const trimmed = value.trim() || "(no response)";

            if (q?.multiSelect) {
              // Store custom value in map (per question)
              customInputs.set(q.id, trimmed);
              selectedOptions.add("__other__");
              inputMode = false;
              inputQuestionId = null;
              editor.setText("");
              refresh();
            } else {
              // Single select: save immediately and advance
              saveAnswer(q!.id, [trimmed], [trimmed], true);
              inputMode = false;
              inputQuestionId = null;
              editor.setText("");
              advanceAfterAnswer();
            }
          };

          function handleInput(data: string) {
            // Input mode: route to editor
            if (inputMode) {
              if (matchesKey(data, Key.escape)) {
                inputMode = false;
                inputQuestionId = null;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            const q = currentQuestion();
            const opts = currentOptions();

            // Backspace on "Type something." in multi-select: clear custom input
            if (matchesKey(data, Key.backspace) && q?.multiSelect) {
              const opt = opts[optionIndex];
              if (opt.isOther && selectedOptions.has("__other__")) {
                selectedOptions.delete("__other__");
                customInputs.delete(q.id);
                refresh();
                return;
              }
            }

            // Tab navigation (multi-question only)
            if (isMulti) {
              if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
                currentTab = (currentTab + 1) % totalTabs;
                optionIndex = 0;
                // Restore previous selections if question was answered
                const nextQ = currentQuestion();
                if (nextQ) {
                  const prevAnswer = answers.get(nextQ.id);
                  if (prevAnswer) {
                    selectedOptions.clear();
                    const nextOpts = currentOptions();
                    prevAnswer.values.forEach((val) => {
                      // Check if value matches an option or is custom input
                      const opt = nextOpts.find((o) => o.value === val);
                      if (opt) {
                        selectedOptions.add(opt.value);
                      } else {
                        // It's a custom value - mark "Type something" option and store in map
                        selectedOptions.add("__other__");
                        customInputs.set(nextQ.id, val);
                      }
                    });
                  }
                }
                refresh();
                return;
              }
              if (
                matchesKey(data, Key.shift("tab")) ||
                matchesKey(data, Key.left)
              ) {
                currentTab = (currentTab - 1 + totalTabs) % totalTabs;
                optionIndex = 0;
                // Restore previous selections if question was answered
                const prevQ = currentQuestion();
                if (prevQ) {
                  const prevAnswer = answers.get(prevQ.id);
                  if (prevAnswer) {
                    selectedOptions.clear();
                    const prevOpts = currentOptions();
                    prevAnswer.values.forEach((val) => {
                      const opt = prevOpts.find((o) => o.value === val);
                      if (opt) {
                        selectedOptions.add(opt.value);
                      } else {
                        selectedOptions.add("__other__");
                        customInputs.set(prevQ.id, val);
                      }
                    });
                  }
                }
                refresh();
                return;
              }
            }

            // Submit tab
            if (currentTab === questions.length) {
              if (matchesKey(data, Key.enter) && allAnswered()) {
                flushPendingInputs();
                submit(false);
              } else if (matchesKey(data, Key.escape)) {
                submit(true);
              }
              return;
            }

            // Option navigation
            if (matchesKey(data, Key.up)) {
              optionIndex = Math.max(0, optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = Math.min(opts.length - 1, optionIndex + 1);
              refresh();
              return;
            }

            // Space key: toggle selection for multi-select
            if (matchesKey(data, Key.space) && q?.multiSelect) {
              const opt = opts[optionIndex];
              if (opt.isOther) {
                // If custom value already exists in map, toggle it off
                const customValue = customInputs.get(q.id);
                if (customValue && selectedOptions.has("__other__")) {
                  selectedOptions.delete("__other__");
                  customInputs.delete(q.id);
                  refresh();
                  return;
                }
                // Otherwise enter custom input mode
                inputMode = true;
                inputQuestionId = q.id;
                editor.setText("");
                refresh();
                return;
              }
              // Toggle selection
              if (selectedOptions.has(opt.value)) {
                selectedOptions.delete(opt.value);
              } else {
                selectedOptions.add(opt.value);
              }
              refresh();
              return;
            }

            // Select option (single select)
            if (matchesKey(data, Key.enter) && q && !q.multiSelect) {
              const opt = opts[optionIndex];
              if (opt.isOther) {
                inputMode = true;
                inputQuestionId = q.id;
                editor.setText("");
                refresh();
                return;
              }
              saveAnswer(q.id, [opt.value], [opt.label], false, [
                optionIndex + 1,
              ]);
              advanceAfterAnswer();
              return;
            }

            // Enter on multi-select: submit selections
            if (matchesKey(data, Key.enter) && q?.multiSelect) {
              if (selectedOptions.size > 0 || inputMode) {
                submitMultiSelect();
              }
              return;
            }

            // Cancel
            if (matchesKey(data, Key.escape)) {
              clearSelections();
              submit(true);
            }
          }

          function render(width: number): string[] {
            if (cachedLines) return cachedLines;

            const lines: string[] = [];
            const q = currentQuestion();
            const opts = currentOptions();

            // Helper to add truncated line
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            add(theme.fg("accent", "─".repeat(width)));

            // Tab bar (multi-question only)
            if (isMulti) {
              const tabs: string[] = ["← "];
              for (let i = 0; i < questions.length; i++) {
                const isActive = i === currentTab;
                const isAnswered = answers.has(questions[i].id);
                const lbl = questions[i].label;
                const box = isAnswered ? "■" : "□";
                const color = isAnswered ? "success" : "muted";
                const text = ` ${box} ${lbl} `;
                const styled = isActive
                  ? theme.bg("selectedBg", theme.fg("text", text))
                  : theme.fg(color, text);
                tabs.push(`${styled} `);
              }
              const canSubmit = allAnswered();
              const isSubmitTab = currentTab === questions.length;
              const submitText = " ✓ Submit ";
              const submitStyled = isSubmitTab
                ? theme.bg("selectedBg", theme.fg("text", submitText))
                : theme.fg(canSubmit ? "success" : "dim", submitText);
              tabs.push(`${submitStyled} →`);
              add(` ${tabs.join("")}`);
              lines.push("");
            }

            // Helper to render options list
            function renderOptions() {
              if (!q) return;

              const isMultiSelect = q.multiSelect || false;
              const customValue = isMultiSelect
                ? customInputs.get(q.id) || ""
                : "";

              for (let i = 0; i < opts.length; i++) {
                const opt = opts[i];
                const selected = i === optionIndex;
                const isOther = opt.isOther === true;

                let prefix: string;
                let color: string;

                if (isMultiSelect) {
                  // Checkbox UI for multi-select
                  const isChecked = selectedOptions.has(opt.value);
                  const box = isChecked ? "[✓]" : "[ ]";
                  prefix = selected
                    ? theme.fg("accent", `${box} `)
                    : theme.fg("dim", `${box} `);
                  color = selected ? "accent" : "text";
                } else {
                  // Single select UI
                  prefix = selected ? theme.fg("accent", "> ") : "  ";
                  color = selected ? "accent" : "text";
                }

                // Mark "Type something" differently when in input mode
                if (isOther && inputMode) {
                  add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`));
                } else {
                  add(
                    prefix +
                      theme.fg(color as "accent", `${i + 1}. ${opt.label}`),
                  );
                }

                // Show custom value next to "Type something" if entered
                if (isOther && customValue) {
                  add(`     ${theme.fg("muted", `(custom: ${customValue})`)}`);
                }

                if (opt.description) {
                  add(`     ${theme.fg("muted", opt.description)}`);
                }
              }
            }

            // Content
            if (inputMode && q) {
              add(theme.fg("text", ` ${q.prompt}`));
              lines.push("");
              // Show options for reference
              renderOptions();
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
              lines.push("");
              add(theme.fg("dim", " Enter to submit • Esc to cancel"));
            } else if (currentTab === questions.length) {
              add(theme.fg("accent", theme.bold(" Ready to submit")));
              lines.push("");
              // Show all questions with their answers (submitted or pending)
              for (const question of questions) {
                const answer = answers.get(question.id);
                const pendingCustom = customInputs.get(question.id);

                if (answer && answer.values.length > 0) {
                  const prefix = answer.wasCustom ? "(wrote) " : "";
                  const labelStr = answer.labels.join(", ");
                  add(
                    `${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", prefix + labelStr)}`,
                  );
                } else if (pendingCustom) {
                  // Show pending custom input (not yet submitted)
                  add(
                    `${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", pendingCustom)}`,
                  );
                }
              }
              lines.push("");
              if (allAnswered()) {
                add(theme.fg("success", " Press Enter to submit"));
              } else {
                const missing = questions
                  .filter((q) => !answers.has(q.id))
                  .map((q) => q.label)
                  .join(", ");
                add(theme.fg("warning", ` Unanswered: ${missing}`));
              }
            } else if (q) {
              add(theme.fg("text", ` ${q.prompt}`));
              lines.push("");
              renderOptions();
            }

            lines.push("");
            if (!inputMode) {
              let help: string;
              if (isMulti && q?.multiSelect) {
                help =
                  " Tab/←→ navigate • ↑↓ select • Space toggle • Enter submit • Esc cancel";
              } else if (isMulti) {
                help =
                  " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel";
              } else if (q?.multiSelect) {
                help =
                  " ↑↓ navigate • Space toggle • Enter submit • Esc cancel";
              } else {
                help = " ↑↓ navigate • Enter select • Esc cancel";
              }
              add(theme.fg("dim", help));
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        },
      );

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire" }],
          details: result,
        };
      }

      const answerLines = result.answers.map((a) => {
        const qLabel = questions.find((q) => q.id === a.id)?.label || a.id;
        if (a.wasCustom) {
          return `${qLabel}: user wrote: ${a.labels.join(", ")}`;
        }
        const indices = a.indices?.map((idx) => `${idx}`).join(", ");
        return `${qLabel}: user selected: ${indices}. ${a.labels.join(", ")}`;
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      const qs = (args.questions as Question[]) || [];
      const count = qs.length;
      const labels = qs.map((q) => q.label || q.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("question "));
      text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
      if (labels) {
        text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }
      const lines = details.answers.map((a) => {
        if (a.wasCustom) {
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${theme.fg("muted", "(wrote) ")}${a.labels.join(", ")}`;
        }
        const indices = a.indices?.map((idx) => `${idx}`).join(", ");
        const display = indices
          ? `${indices}. ${a.labels.join(", ")}`
          : a.labels.join(", ");
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
