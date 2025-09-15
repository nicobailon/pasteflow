export function isRiskyCommand(txt: string): boolean {
  const s = (txt || "").trim().toLowerCase();
  return /rm\s+-rf\s+\/.*/.test(s) || s.includes(":(){ :|:& };:") || /mkfs|fdisk|diskpart|format\s+c:/.test(s);
}
