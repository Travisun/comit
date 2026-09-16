import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/primitives";
import { routes } from "@/core/routes";
import { getT } from "@/lib/i18n";
import { getSetting, type SettingsKey } from "@/lib/settings";
import { oauthEnabled } from "@/lib/auth/oauth";

/**
 * Federated-login button block for the login page. Rendered server-side so
 * provider availability (env + admin settings) stays off the client.
 */
export async function OAuthButtons() {
  const { t } = await getT();

  const entries: { provider: string; key: SettingsKey; label: string; href: string }[] = [
    { provider: "github", key: "sso.github", label: t("auth.oauth.github"), href: routes.oauthStart("github") },
    { provider: "google", key: "sso.google", label: t("auth.oauth.google"), href: routes.oauthStart("google") },
    { provider: "x", key: "sso.x", label: t("auth.oauth.x"), href: routes.oauthStart("x") },
    { provider: "discourse", key: "sso.discourse", label: t("auth.oauth.discourse"), href: routes.discourseSso },
    { provider: "cfaccess", key: "sso.cfaccess", label: t("auth.oauth.cf"), href: "/api/auth/cf-access" },
  ];

  const enabled = [];
  for (const e of entries) {
    if (oauthEnabled(e.provider) && (await getSetting(e.key))) enabled.push(e);
  }
  if (enabled.length === 0) return null;

  return (
    <div>
      <div className="my-1 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">{t("auth.orContinue")}</span>
        <Separator className="flex-1" />
      </div>
      <div className="flex flex-col gap-2">
        {enabled.map((e) => (
          <Button key={e.provider} variant="outline" asChild className="w-full">
            <a href={e.href}>{e.label}</a>
          </Button>
        ))}
      </div>
    </div>
  );
}
