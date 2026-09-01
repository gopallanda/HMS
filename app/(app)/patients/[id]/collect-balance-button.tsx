'use client';

import { IndianRupeeIcon } from 'lucide-react';
import { useState } from 'react';

import {
  CollectBalanceDialog,
  type CollectBalanceTarget,
} from '@/components/shared/collect-balance-dialog';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/utils/money';

/**
 * The one interactive control on the patient money panel.
 *
 * A client island rather than a client panel: the rest of that table is a
 * Server Component and has no reason to stop being one (CLAUDE.md 7). This
 * button carries its own open state and nothing else.
 */
export function CollectBalanceButton({ target }: { target: CollectBalanceTarget }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={`Collect the ${formatAmount(target.balance)} still owing on ${target.invoiceNo}`}
        onClick={() => setOpen(true)}
      >
        <IndianRupeeIcon className="text-success" />
        <span className="sr-only">Collect balance on {target.invoiceNo}</span>
      </Button>

      {open ? (
        <CollectBalanceDialog target={target} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
