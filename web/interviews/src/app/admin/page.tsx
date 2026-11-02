import { headers } from "next/headers";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { listInterviews } from "@/lib/interviews";
import { mmss } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function Admin() {
  // the proxy already gates /admin; re-check so a matcher change can't silently expose it
  if (!isAdmin((await headers()).get("authorization"))) return <main>Authentication required.</main>;
  const items = await listInterviews();
  const yes = items.filter((i) => i.outcome?.commitment === "yes").length;
  return (
    <main className="wide">
      <h1>Interviews</h1>
      <p className="muted">
        {items.length} total · {items.filter((i) => i.status !== "active").length} finished · {yes} said yes to the TestFlight ask
      </p>
      <table>
        <thead>
          <tr>
            <th>Date (UTC)</th>
            <th>Duration</th>
            <th>Lang</th>
            <th>Pilot</th>
            <th>Commitment</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const p = i.outcome?.profile;
            const who = [p?.certificate, p?.aircraft, p?.owner_or_rental].filter(Boolean).join(" · ");
            const c = i.outcome?.commitment;
            return (
              <tr key={i.id}>
                <td>{i.startedAt.slice(0, 16).replace("T", " ")}</td>
                <td>{i.durationSec != null ? mmss(i.durationSec * 1000) : "live"}</td>
                <td>
                  <span className="tag">{i.lang === "he" ? "עברית (he)" : "en"}</span>
                </td>
                <td>{who || <span className="muted">-</span>}</td>
                <td>{c ? <span className={`tag ${c}`}>{c}</span> : <span className="muted">-</span>}</td>
                <td>
                  <span className="tag">{i.status}</span>
                  {i.audio ? " 🔊" : ""}
                </td>
                <td>
                  <Link href={`/admin/${i.id}`}>Open</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && <p className="muted">No interviews yet.</p>}
    </main>
  );
}
