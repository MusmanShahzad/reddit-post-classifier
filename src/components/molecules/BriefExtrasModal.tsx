"use client";

import { useState } from "react";

/** The skip answer saved when the user says there is nothing to skip. */
export const NOTHING_TO_SKIP = "nothing in particular";

export interface BriefExtras {
  buyer: string;
  notAbout: string;
}

export interface BriefExtrasModalProps {
  companyName: string;
  initial?: Partial<BriefExtras>;
  /** Text for the main button, such as "Continue" or "Save". */
  confirmLabel?: string;
  /** Text for the secondary button, such as "Skip for now" or "Cancel". */
  dismissLabel?: string;
  saving?: boolean;
  error?: string | null;
  onSave: (extras: BriefExtras) => void;
  onDismiss: () => void;
}

/**
 * The two optional brief questions: who buys it, and what to skip. Both make
 * filtering sharper. Either can be left for later.
 */
export function BriefExtrasModal({
  companyName,
  initial,
  confirmLabel = "Continue",
  dismissLabel = "Skip for now",
  saving = false,
  error,
  onSave,
  onDismiss,
}: BriefExtrasModalProps) {
  const [buyer, setBuyer] = useState(initial?.buyer ?? "");
  const startsEmpty = initial?.notAbout === NOTHING_TO_SKIP;
  const [notAbout, setNotAbout] = useState(startsEmpty ? "" : (initial?.notAbout ?? ""));
  const [nothingToSkip, setNothingToSkip] = useState(startsEmpty);

  const submit = () => {
    onSave({
      buyer: buyer.trim(),
      notAbout: nothingToSkip ? NOTHING_TO_SKIP : notAbout.trim(),
    });
  };

  return (
    <dialog className="modal modal-open" open aria-labelledby="brief-extras-title">
      <div className="modal-box max-w-lg">
        <h3 id="brief-extras-title" className="text-lg font-bold">
          Two more answers
        </h3>
        <p className="py-2 text-sm text-base-content/70">
          These make the filter sharper for {companyName}. You can leave them for later.
        </p>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Who buys it?</legend>
          <textarea
            className="textarea w-full"
            rows={2}
            value={buyer}
            placeholder="The people or businesses that buy from you"
            aria-label="Who buys it?"
            onChange={(event) => setBuyer(event.target.value)}
          />
          <p className="label">Posts from these people are kept first.</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">What should be skipped?</legend>
          <textarea
            className="textarea w-full"
            rows={2}
            value={notAbout}
            disabled={nothingToSkip}
            placeholder="Posts that share your words but are not about you"
            aria-label="What should be skipped?"
            onChange={(event) => setNotAbout(event.target.value)}
          />
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={nothingToSkip}
              onChange={(event) => setNothingToSkip(event.target.checked)}
            />
            Nothing to skip
          </label>
        </fieldset>

        {error && (
          <div role="alert" className="alert alert-error alert-soft mt-2">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onDismiss} disabled={saving}>
            {dismissLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving && <span className="loading loading-spinner loading-xs" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
