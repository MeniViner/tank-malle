import { createContext } from "react";
import type { DataContextValue } from "./DataContext";

export const DataContext = createContext<DataContextValue | null>(null);
