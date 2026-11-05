"use client";

import { useState } from "react";

/**
 * One question in a modal. The user types an answer and continues.
 *
 * @param question - The question to answer.
 * @param onAnswer - Called with the trimmed answer.
 * @param onCancel - Closes the setup.
 *
 * @example
 * ```tsx
 * <QuestionModal question="What does Acme sell?" onAnswer={send} onCancel={close} />
 * ```
 */
export interface QuestionModalProps {
  question: string;
  onAnswer: (answer: string) => void;
  onCancel?: () => void;
}

export function QuestionModal({ question, onAnswer, onCancel }: QuestionModalProps) {
  const [answer, setAnswer] = useState("");
  const trimmed = answer.trim();

  const submit = () => {
    if (!trimmed) return;
    onAnswer(trimmed);
    setAnswer("");
  };

  return (
    <dialog className="modal modal-open" open aria-labelledby="question-title">
      <div className="modal-box max-w-lg">
        <h3 id="question-title" className="text-lg font-bold">
          One more thing
        </h3>
        <p className="py-2 text-sm text-base-content/80">{question}</p>
        <textarea
          className="textarea w-full"
          rows={3}
          value={answer}
          placeholder="Your answer"
          aria-label="Your answer"
          autoFocus
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="modal-action">
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn" onClick={submit} disabled={!trimmed}>
            Continue
          </button>
        </div>
      </div>
    </dialog>
  );
}
