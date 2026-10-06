/**
 * The registration form is always the compact step-by-step layout with a vertical stepper: only 4–5 fields are
 * rendered at a time (fast on slow devices) and every step fits the viewport without scrolling.
 */
export function useWizardMode(): boolean {
  return true;
}
