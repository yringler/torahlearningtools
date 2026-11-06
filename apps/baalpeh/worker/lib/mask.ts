/** "yosef@gmail.com" → "y•••@gmail.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${Array.from(email.slice(0, at))[0] ?? ""}•••${email.slice(at)}`;
}
