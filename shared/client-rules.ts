import { z } from "zod";

export const clientCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const clientNameSchema = z.string().trim().min(1).max(50);
export const clientSearchSchema = z.string().trim().max(100);

export function clientNameKey(name: string): string {
  return name.trim().toLowerCase();
}
