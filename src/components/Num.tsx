import { NumRun, type NumRunProps } from "./Fmt";

/** Compatibility alias: every numeric/Latin run uses the same isolated LTR primitive. */
export function Num(props: NumRunProps) {
  return <NumRun {...props} />;
}
