import { DesignIcon } from "../icons";
import { categoryIconName } from "./categoryIcons";

/** Service and expense glyphs share the same category mapping everywhere. */
export function CareGlyph({ kind, size = 24 }: { kind: string; size?: number }) {
  return <DesignIcon name={categoryIconName(kind)} size={size} />;
}
