"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/FormControls";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { todayISODate } from "@/lib/formatting";

export function WeighInForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createWeighIn } = useTrackerStore();
  const { showToast } = useToast();
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0 || value > 400) {
      setError("Enter a realistic weight in kilograms.");
      return;
    }
    setSubmitting(true);
    try {
      await createWeighIn({ weightKg: value, date });
      showToast({ title: "Weight check-in saved", variant: "success" });
      setWeight("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this check-in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Weight check-in" description="Log today's body weight.">
      <div className="flex flex-col gap-4">
        <Field label="Weight (kg)" required>
          <Input
            type="number"
            step="0.1"
            min={0}
            placeholder="e.g. 48.2"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Date" required>
          <Input type="date" value={date} max={todayISODate()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {error && <p className="text-sm font-medium text-danger-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
