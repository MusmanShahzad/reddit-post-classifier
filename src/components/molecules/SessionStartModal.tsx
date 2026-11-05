"use client";

import { type ChangeEvent, useState } from "react";
import { starterIssue } from "@/lib/relevance";

export interface SessionStart {
  companyName: string;
  description: string;
  want: string;
}

export interface SessionStartModalProps {
  onStart: (start: SessionStart) => void;
  onCancel?: () => void;
}

const FIELDS = [
  {
    key: "companyName" as const,
    legend: "Company name",
    hint: "The brand the search is for.",
    placeholder: "Company name",
  },
  {
    key: "description" as const,
    legend: "What do you sell?",
    hint: "One sentence, in your words.",
    placeholder: "What the company sells",
    long: true,
  },
  {
    key: "want" as const,
    legend: "What should I find?",
    hint: "One kind of post is enough, such as bad reviews or people who might buy.",
    placeholder: "The posts you want found",
    long: true,
  },
];

/**
 * The first step of a new session. Company, what they sell, and what to find
 * are collected here. A question is asked only if one of them is still unclear.
 */
export function SessionStartModal({ onStart, onCancel }: SessionStartModalProps) {
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [want, setWant] = useState("");
  const [tried, setTried] = useState(false);

  const values = { companyName, description, want };
  const issues = {
    companyName: starterIssue(companyName),
    description: starterIssue(description),
    want: starterIssue(want),
  };
  const ready = !issues.companyName && !issues.description && !issues.want;

  const submit = () => {
    setTried(true);
    if (!ready) return;
    onStart({ companyName: companyName.trim(), description: description.trim(), want: want.trim() });
  };

  return (
    <dialog className="modal modal-open" open aria-labelledby="session-start-title">
      <div className="modal-box max-w-lg">
        <h3 id="session-start-title" className="text-lg font-bold">
          New session
        </h3>
        <p className="py-2 text-sm text-base-content/70">
          Add the company, what it sells, and what to find. Competitors, topics, and subreddits are suggested for you to check.
        </p>
        <div className="flex flex-col gap-3">
          {FIELDS.map((field) => {
            const issue = tried ? issues[field.key] : null;
            const shared = {
              className: `w-full ${field.long ? "textarea" : "input"}`,
              value: values[field.key],
              placeholder: field.placeholder,
              "aria-label": field.legend,
              onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                const next = event.target.value;
                if (field.key === "companyName") setCompanyName(next);
                if (field.key === "description") setDescription(next);
                if (field.key === "want") setWant(next);
              },
            };
            return (
              <fieldset key={field.key} className="fieldset">
                <legend className="fieldset-legend">{field.legend}</legend>
                {field.long ? <textarea {...shared} rows={2} /> : <input {...shared} type="text" />}
                <p className={`label ${issue ? "text-error" : ""}`}>{issue ?? field.hint}</p>
              </fieldset>
            );
          })}
        </div>
        <div className="modal-action">
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn" onClick={submit}>
            Continue
          </button>
        </div>
      </div>
      {onCancel && (
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </form>
      )}
    </dialog>
  );
}
