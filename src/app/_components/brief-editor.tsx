"use client";

import { api } from "@/trpc/react";
import { readableError } from "@/lib/trpc-error";
import { BriefExtrasModal } from "@/components/molecules";

/** Opens the optional brief questions for the active session and saves the answers. */
export function BriefEditor({ onClose }: { onClose: () => void }) {
  const utils = api.useUtils();
  const { data: company } = api.settings.getCompany.useQuery();
  const update = api.settings.updateBrief.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.settings.getCompany.invalidate(),
        utils.post.getFilterQuality.invalidate(),
        utils.session.invalidate(),
      ]);
      onClose();
    },
  });

  if (!company) return null;

  return (
    <BriefExtrasModal
      companyName={company.name}
      initial={{ buyer: company.buyer, notAbout: company.notAbout }}
      confirmLabel="Save"
      dismissLabel="Cancel"
      saving={update.isPending}
      error={readableError(update.error)}
      onSave={(extras) => update.mutate(extras)}
      onDismiss={onClose}
    />
  );
}
