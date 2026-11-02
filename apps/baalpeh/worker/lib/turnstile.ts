import type { Env } from "../env";

export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip !== "unknown") form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!r.ok) return false;
    const j = await r.json<{ success?: boolean }>();
    return j.success === true;
  } catch (err) {
    console.error("turnstile siteverify failed", err);
    return false;
  }
}
