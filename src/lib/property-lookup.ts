import type { Property } from "@/types/property";

export function getPropertyById(
  properties: readonly Property[],
  id: string,
): Property | undefined {
  return properties.find((property) => property.id === id);
}
