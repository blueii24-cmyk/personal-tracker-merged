# Water tracking

Water quick-add entries are ordinary meal records containing a plain `Water` item in `ml`.
They use the existing meal storage, sync/RLS, edit, delete/undo and JSON backup paths.
Totals count only explicit `Water` items with ml or litre units, not water inferred from
other drinks or foods. Older records without water continue to total zero. The selected
Bulking date determines the day of a quick add; the profile timezone determines today.

The optional daily target is stored with the other settings. Before releasing the app to
connected users, apply the additive `20261115000000_water_target.sql` migration and refresh
Supabase's schema cache using the standard deployment process. It adds a nullable column
and leaves existing targets and records unchanged. Until the migration is applied, settings without a water target can still sync; a non-null water target cannot sync and stays queued on the device. This repository
change does not apply the migration to production.

Older app versions do not understand the new target; update all devices before changing it
and verify sync. Normal conflict rules still apply; this is not a multi-device sync or data
integrity certification.
