# Chat modes

Log Mode is the default for new and legacy conversations. Casual Mode is a
separate conversation: switching asks for confirmation when there are messages,
and does not replay them. Saved conversations remain available in the list;
failed/unsaved messages are not retained if the user confirms a switch. During
an active request, mode switching is disabled. Corrections still fork a
conversation and retain the original receipts and messages.

Casual Mode sends no tools to BYOK providers; the tool runner also rejects any
unsolicited tool call before execution. The default relay validates the mode,
omits tools and rejects tool-call history and provider tool calls. It does not
execute tracker tools itself. The client checks the relay's capability before
using default-AI Casual Mode, so an older deployed function cannot silently
receive a casual request with log tools. A locally built version of the Edge
Function alone is not a deployed function.

When the current question mentions weight, nutrition/progress or budget, a
small read-only aggregate from the existing dashboard summary is included in
context for that topic; unrelated records, account identity, keys, and standing
notes are not included. The summary reports dates, missing readings, unknown
nutrition and estimates. The UI informs the user that relevant summaries may be
sent to the chosen AI provider. This is keyword-based, so indirect follow-up
questions may not include a relevant summary. No workout/Health Connect or
calendar context is supplied. The local built-in rule assistant is not a general
language model; Casual Mode tells the user to configure an AI provider rather
than pretending to have a conversation.

## Cloud deployment prerequisites

`supabase/migrations/20261110000000_chat_modes.sql` adds a non-null `chat_mode`
column with `log` as the default and validates the two allowed values. Existing
messages and sessions are not deleted or rewritten. Review and test the migration
on a separate environment, back up data, then apply it to the intended Supabase
project **before releasing clients that sync casual sessions**. Until applied,
casual session sync fails and remains pending locally; existing log session
writes omit the new column. Older app versions do not understand the mode and
should not be used to continue casual conversations. Test mixed-version behavior
before rollout.

Review and deploy the updated `ai-chat` Edge Function with JWT verification
using the established deployment procedure in `docs/DEFAULT_AI_SETUP.md`.
Until then, default AI Casual Mode displays an update-needed error; BYOK is
independent. Neither this migration nor function has been applied/deployed by
this change. Verify two-user isolation, session sync, provider behavior, retries,
and Android runtime with test accounts before production release. Do not share
credentials or place secrets in the client.
