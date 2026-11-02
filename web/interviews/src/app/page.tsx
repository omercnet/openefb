import { config } from "@/lib/config";
import { parseLang } from "@/lib/lang";
import Interview from "./Interview";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string | string[]; lang?: string | string[] }> }) {
  const sp = await searchParams;
  const code = Array.isArray(sp.c) ? sp.c[0] : sp.c;
  return (
    <main>
      <Interview
        contactEmail={config.contactEmail}
        code={code ?? ""}
        maxMinutes={Math.round(config.maxSessionSeconds / 60)}
        initialLang={parseLang(sp.lang)}
        langExplicit={sp.lang !== undefined}
      />
    </main>
  );
}
