import { config } from "@/lib/config";
import Interview from "./Interview";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const sp = await searchParams;
  const code = Array.isArray(sp.c) ? sp.c[0] : sp.c;
  return (
    <main>
      <Interview
        interviewer={config.interviewerName}
        contactEmail={config.contactEmail}
        code={code ?? ""}
        maxMinutes={Math.round(config.maxSessionSeconds / 60)}
      />
    </main>
  );
}
