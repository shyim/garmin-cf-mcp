// Mirrors GARMIN_ENABLED_TOOLS / GARMIN_DISABLED_TOOLS from the original server.
export function toolAllowed(
  name: string,
  env: { GARMIN_ENABLED_TOOLS?: string; GARMIN_DISABLED_TOOLS?: string },
): boolean {
  const norm = (v?: string) =>
    new Set(
      (v ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  const enabled = norm(env.GARMIN_ENABLED_TOOLS);
  const disabled = norm(env.GARMIN_DISABLED_TOOLS);
  if (enabled.size > 0) return enabled.has(name.toLowerCase());
  return !disabled.has(name.toLowerCase());
}
