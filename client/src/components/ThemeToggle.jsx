/* Theme toggle is intentionally a no-op render — the app is single-theme
   (white surface, black accent). Kept as an exported component so existing
   call sites continue to compile. */
export default function ThemeToggle() {
  return null;
}
