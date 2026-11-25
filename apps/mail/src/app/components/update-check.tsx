import { setUpdateCheckAction } from "@/app/actions/updates";
import { ActionSwitch } from "@/app/components/action-form";
import { Section } from "@/app/components/section";
import { t } from "@lingui/core/macro";

/** On the Admin page: whether GentleMail looks for new versions. */
export function UpdateCheck({ on }: { on: boolean }) {
  return (
    <Section title={t({ id: "updates.title", message: "New versions" })}>
      <label className="flex items-start gap-3 rounded-md border px-4 py-3">
        <ActionSwitch action={setUpdateCheckAction} id="update_check" checked={on} label={t({ id: "updates.check", message: "Check for new versions" })} />
        <span className="text-sm">
          <span className="block font-medium">{t({ id: "updates.check", message: "Check for new versions" })}</span>
          <span className="block text-muted-foreground">
            {on
              ? t({ id: "updates.check_on", message: "On: once a day, GentleMail reads the list of releases on gentlemail.dev and tells admins about a newer one. Nothing is installed by itself." })
              : t({ id: "updates.check_off", message: "Off: GentleMail doesn't contact gentlemail.dev, and admins aren't told about new versions, security fixes included." })}
          </span>
        </span>
      </label>
    </Section>
  );
}
